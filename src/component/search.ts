import { v, type Infer } from "convex/values";
import { action, internalQuery } from "./_generated/server.js";
import { searchEmbeddings } from "./embeddings/index.js";
import { numberedFiltersFromNamedFilters, vNamedFilter } from "./filters.js";
import { internal } from "./_generated/api.js";
import {
  vEntry,
  vSearchResult,
  type SearchResult,
  type EntryId,
} from "../shared.js";
import type { Id } from "./_generated/dataModel.js";
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

    // When textQuery is not provided, use the existing vector-only path.
    if (!args.textQuery) {
      const results = await searchEmbeddings(ctx, {
        embedding,
        namespaceId: namespace._id,
        filters: numberedFiltersFromNamedFilters(
          filters,
          namespace.filterNames,
        ),
        limit,
      });
      const threshold = args.vectorScoreThreshold ?? -1;
      const aboveThreshold = results.filter((r) => r._score >= threshold);
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

    // Hybrid search: combine vector and text search results.
    const vectorResults = await searchEmbeddings(ctx, {
      embedding,
      namespaceId: namespace._id,
      filters: numberedFiltersFromNamedFilters(filters, namespace.filterNames),
      limit,
    });

    const threshold = args.vectorScoreThreshold ?? -1;
    const aboveThreshold = vectorResults.filter(
      (r) => r._score >= threshold,
    );

    // Map vector embedding IDs to chunk IDs.
    const vectorChunkIds = await ctx.runQuery(
      internal.chunks.getChunkIdsByEmbeddingIds,
      { embeddingIds: aboveThreshold.map((r) => r._id) },
    );
    const vectorChunkIdStrings: string[] = vectorChunkIds.filter(
      (id) => id !== null,
    );

    // Run text search.
    const textResults = await ctx.runQuery(internal.search.textSearch, {
      query: args.textQuery,
      namespaceId: namespace._id,
      limit,
    });
    const textChunkIdStrings: string[] = textResults.map((r) => r.chunkId);

    // Merge using Reciprocal Rank Fusion.
    const vectorWeight = args.vectorWeight ?? 1;
    const textWeight = args.textWeight ?? 1;
    const mergedChunkIds = hybridRank(
      [vectorChunkIdStrings, textChunkIdStrings],
      { k: 10, weights: [vectorWeight, textWeight] },
    ).slice(0, limit);

    // Fetch ranges for the merged chunk IDs.
    const { ranges, entries } = await ctx.runQuery(
      internal.chunks.getRangesOfChunkIds,
      {
        chunkIds: mergedChunkIds as Id<"chunks">[],
        chunkContext,
      },
    );

    // Assign position-based scores (1.0 for first, decreasing).
    return {
      results: ranges
        .map((r, i) =>
          publicSearchResult(r, (mergedChunkIds.length - i) / mergedChunkIds.length),
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
    const results = await ctx.db
      .query("chunks")
      .withSearchIndex("searchableText", (q) =>
        q
          .search("state.searchableText", args.query)
          .eq("namespaceId", args.namespaceId),
      )
      .take(args.limit);
    return results
      .filter((chunk) => chunk.state.kind === "ready")
      .map((chunk) => ({
        chunkId: chunk._id,
        entryId: chunk.entryId,
        order: chunk.order,
      }));
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
