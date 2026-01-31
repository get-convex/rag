import { v, type Infer } from "convex/values";
import { action, internalQuery } from "./_generated/server.js";
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
import type { vRangeResult } from "./chunks.js";
import { hybridRank } from "../client/hybridRank.js";

export const search = action({
  args: {
    namespace: v.string(),
    embedding: v.array(v.number()),
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
    const namespace = await ctx.runQuery(
      internal.namespaces.getCompatibleNamespace,
      {
        namespace: args.namespace,
        modelId,
        dimension: embedding.length,
        filterNames: filters.map((f) => f.name),
      },
    );
    if (!namespace) {
      console.debug(
        `No compatible namespace found for ${args.namespace} with model ${args.modelId} and dimension ${embedding.length} and filters ${filters.map((f) => f.name).join(", ")}.`,
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

    // Vector-only path: return results with cosine similarity scores.
    if (!args.textQuery) {
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

    // Hybrid path: combine vector and text search results.
    const vectorChunkIds = await ctx.runQuery(
      internal.chunks.getChunkIdsByEmbeddingIds,
      { embeddingIds: aboveThreshold.map((r) => r._id) },
    );
    const vectorChunkIdList: Id<"chunks">[] = vectorChunkIds.filter(
      (id) => id !== null,
    );

    const textResults = await ctx.runQuery(internal.search.textSearch, {
      query: args.textQuery,
      namespaceId: namespace._id,
      filters: numberedFilters,
      limit,
    });
    const textChunkIds: Id<"chunks">[] = textResults.map((r) => r.chunkId);

    // Merge using Reciprocal Rank Fusion.
    const vectorWeight = args.vectorWeight ?? 1;
    const textWeight = args.textWeight ?? 1;
    const mergedChunkIds = hybridRank<Id<"chunks">>(
      [vectorChunkIdList, textChunkIds],
      { k: 10, weights: [vectorWeight, textWeight] },
    ).slice(0, limit);

    if (mergedChunkIds.length === 0) {
      return { results: [], entries: [] };
    }

    const { ranges, entries } = await ctx.runQuery(
      internal.chunks.getRangesOfChunkIds,
      {
        chunkIds: mergedChunkIds,
        chunkContext,
      },
    );

    // Position-based scores (1.0 for first, decreasing linearly).
    return {
      results: ranges
        .map((r, i) =>
          publicSearchResult(
            r,
            (mergedChunkIds.length - i) / mergedChunkIds.length,
          ),
        )
        .filter((r) => r !== null),
      entries: entries as Infer<typeof vEntry>[],
    };
  },
});

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
    type TextSearchResult = {
      chunkId: Id<"chunks">;
      entryId: Id<"entries">;
      order: number;
    };

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
    for (const filter of args.filters as NumberedFilter[]) {
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
