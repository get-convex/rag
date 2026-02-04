import { v, type Infer } from "convex/values";
import { action, internalQuery, type QueryCtx } from "./_generated/server.js";
import { searchEmbeddings } from "./embeddings/index.js";
import {
  filterFieldsFromNumbers,
  numberedFiltersFromNamedFilters,
  vNamedFilter,
  type NumberedFilter,
} from "./filters.js";
import { internal } from "./_generated/api.js";
import {
  vEntry,
  vSearchResult,
  type SearchResult,
  type EntryId,
} from "../shared.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { buildRanges, type vRangeResult } from "./chunks.js";
import { hybridRank } from "../client/hybridRank.js";
import { vVectorId, type VectorTableId } from "./embeddings/tables.js";

export const search = action({
  args: {
    namespace: v.string(),
    embedding: v.optional(v.array(v.number())),
    dimension: v.optional(v.number()),
    modelId: v.string(),
    // These are all OR'd together
    filters: v.array(vNamedFilter),
    limit: v.number(),
    vectorScoreThreshold: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({ before: v.number(), after: v.number() }),
    ),
    textQuery: v.optional(v.string()),
    textWeight: v.optional(v.number()),
    vectorWeight: v.optional(v.number()),
  },
  returns: v.object({
    results: v.array(vSearchResult),
    entries: v.array(vEntry),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    results: SearchResult[];
    entries: Infer<typeof vEntry>[];
  }> => {
    const { modelId, embedding, filters, limit } = args;
    const dimension = embedding?.length ?? args.dimension;
    if (!dimension) {
      throw new Error(
        "Either embedding or dimension must be provided to search.",
      );
    }

    const namespace = await ctx.runQuery(
      internal.namespaces.getCompatibleNamespace,
      {
        namespace: args.namespace,
        modelId,
        dimension,
        filterNames: filters.map((f) => f.name),
      },
    );
    if (!namespace) {
      console.debug(
        `No compatible namespace found for ${args.namespace} with model ${args.modelId} and dimension ${dimension} and filters ${filters.map((f) => f.name).join(", ")}.`,
      );
      return {
        results: [],
        entries: [],
      };
    }

    const chunkContext = args.chunkContext ?? { before: 0, after: 0 };
    const numberedFilters = numberedFiltersFromNamedFilters(
      filters,
      namespace.filterNames,
    );

    const hasEmbedding = !!embedding;
    const hasTextQuery = !!args.textQuery;

    // Vector-only path: return results with cosine similarity scores.
    if (hasEmbedding && !hasTextQuery) {
      const vectorResults = await searchEmbeddings(ctx, {
        embedding,
        namespaceId: namespace._id,
        filters: numberedFilters,
        limit,
      });
      const threshold = args.vectorScoreThreshold ?? -1;
      const aboveThreshold = vectorResults.filter(
        (r) => r._score >= threshold,
      );
      // TODO: break this up if there are too many results
      const { ranges, entries } = await ctx.runQuery(
        internal.chunks.getRangesOfChunks,
        {
          embeddingIds: aboveThreshold.map((r) => r._id),
          chunkContext,
        },
      );
      return {
        results: ranges
          .map((r, i) => publicSearchResult(r, aboveThreshold[i]._score))
          .filter((r) => r !== null),
        entries: entries as Infer<typeof vEntry>[],
      };
    }

    // Hybrid or text-only path: combine vector and text results with RRF.
    let embeddingIds: VectorTableId[] = [];
    if (hasEmbedding) {
      const vectorResults = await searchEmbeddings(ctx, {
        embedding: embedding!,
        namespaceId: namespace._id,
        filters: numberedFilters,
        limit,
      });
      const threshold = args.vectorScoreThreshold ?? -1;
      embeddingIds = vectorResults
        .filter((r) => r._score >= threshold)
        .map((r) => r._id);
    }

    if (!hasTextQuery) {
      return { results: [], entries: [] };
    }

    const { ranges, entries, resultCount } = await ctx.runQuery(
      internal.search.textAndRanges,
      {
        embeddingIds,
        textQuery: args.textQuery!,
        namespaceId: namespace._id,
        filters: numberedFilters,
        limit,
        vectorWeight: args.vectorWeight ?? 1,
        textWeight: args.textWeight ?? 1,
        chunkContext,
      },
    );

    // Position-based scores (1.0 for first, decreasing linearly).
    return {
      results: ranges
        .map((r, i) =>
          publicSearchResult(r, (resultCount - i) / resultCount),
        )
        .filter((r) => r !== null),
      entries: entries as Infer<typeof vEntry>[],
    };
  },
});

type TextSearchResult = {
  chunkId: Id<"chunks">;
  entryId: Id<"entries">;
  order: number;
};

async function textSearchImpl(
  ctx: QueryCtx,
  args: {
    query: string;
    namespaceId: Id<"namespaces">;
    filters: NumberedFilter[];
    limit: number;
  },
): Promise<TextSearchResult[]> {
  const toResults = (chunks: Doc<"chunks">[]): TextSearchResult[] =>
    chunks
      .filter((chunk) => chunk.state.kind === "ready")
      .map((chunk) => ({
        chunkId: chunk._id,
        entryId: chunk.entryId,
        order: chunk.order,
      }));

  // No user filters — just filter by namespaceId.
  if (args.filters.length === 0) {
    const results = await ctx.db
      .query("chunks")
      .withSearchIndex("searchableText", (q) =>
        q
          .search("state.searchableText", args.query)
          .eq("namespaceId", args.namespaceId),
      )
      .take(args.limit);
    return toResults(results);
  }

  // OR across filter conditions: run one text search per filter and dedupe.
  const seen = new Set<Id<"chunks">>();
  const merged: TextSearchResult[] = [];
  for (const filter of args.filters) {
    const fields = filterFieldsFromNumbers(args.namespaceId, filter);
    const results = await ctx.db
      .query("chunks")
      .withSearchIndex("searchableText", (q) => {
        let query = q
          .search("state.searchableText", args.query)
          .eq("namespaceId", args.namespaceId);
        for (const [field, value] of Object.entries(fields)) {
          query = query.eq(
            field as "filter0" | "filter1" | "filter2" | "filter3",
            value,
          );
        }
        return query;
      })
      .take(args.limit);
    for (const r of toResults(results)) {
      if (!seen.has(r.chunkId)) {
        seen.add(r.chunkId);
        merged.push(r);
      }
    }
  }
  return merged.slice(0, args.limit);
}

export const textSearch = internalQuery({
  args: {
    query: v.string(),
    namespaceId: v.id("namespaces"),
    // Numbered filters, OR'd together (same semantics as vector search).
    filters: v.array(v.any()),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      chunkId: v.id("chunks"),
      entryId: v.id("entries"),
      order: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    return textSearchImpl(ctx, {
      query: args.query,
      namespaceId: args.namespaceId,
      filters: args.filters as NumberedFilter[],
      limit: args.limit,
    });
  },
});

export const textAndRanges = internalQuery({
  args: {
    embeddingIds: v.array(vVectorId),
    textQuery: v.string(),
    namespaceId: v.id("namespaces"),
    filters: v.array(v.any()),
    limit: v.number(),
    vectorWeight: v.number(),
    textWeight: v.number(),
    chunkContext: v.object({ before: v.number(), after: v.number() }),
  },
  returns: v.object({
    ranges: v.array(v.union(v.null(), v.object({
      entryId: v.id("entries"),
      order: v.number(),
      startOrder: v.number(),
      content: v.array(
        v.object({
          text: v.string(),
          metadata: v.optional(v.record(v.string(), v.any())),
        }),
      ),
    }))),
    entries: v.array(vEntry),
    resultCount: v.number(),
  }),
  handler: async (ctx, args) => {
    // 1. Map embedding IDs to chunk IDs.
    const vectorChunkIds: Id<"chunks">[] = (
      await Promise.all(
        args.embeddingIds.map(async (embeddingId) => {
          const chunk = await ctx.db
            .query("chunks")
            .withIndex("embeddingId", (q) =>
              q.eq("state.embeddingId", embeddingId),
            )
            .order("desc")
            .first();
          return chunk?._id ?? null;
        }),
      )
    ).filter((id) => id !== null);

    // 2. Run text search.
    const textResults = await textSearchImpl(ctx, {
      query: args.textQuery,
      namespaceId: args.namespaceId,
      filters: args.filters as NumberedFilter[],
      limit: args.limit,
    });
    const textChunkIds: Id<"chunks">[] = textResults.map((r) => r.chunkId);

    // 3. Merge using Reciprocal Rank Fusion.
    const mergedChunkIds = hybridRank<Id<"chunks">>(
      [vectorChunkIds, textChunkIds],
      { k: 10, weights: [args.vectorWeight, args.textWeight] },
    ).slice(0, args.limit);

    if (mergedChunkIds.length === 0) {
      return { ranges: [], entries: [], resultCount: 0 };
    }

    // 4. Build ranges from merged chunk IDs.
    const chunks = await Promise.all(
      mergedChunkIds.map((id) => ctx.db.get(id)),
    );
    const { ranges, entries } = await buildRanges(
      ctx,
      chunks,
      args.chunkContext,
    );
    return { ranges, entries, resultCount: mergedChunkIds.length };
  },
});

function publicSearchResult(
  r: Infer<typeof vRangeResult> | null,
  score: number,
): SearchResult | null {
  if (r === null) {
    return null;
  }
  return {
    ...r,
    score,
    entryId: r.entryId as unknown as EntryId,
  };
}
