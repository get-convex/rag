import { v, type Infer } from "convex/values";
import { action } from "./_generated/server.js";
import { searchEmbeddings } from "./embeddings/index.js";
import { numberedFiltersFromNamedFilters, vNamedFilter } from "./filters.js";
import { internal } from "./_generated/api.js";
import {
  vEntry,
  type Entry,
  vSearchResult,
  type SearchResult,
  type EntryId,
} from "../shared.js";
import type { vRangeResult } from "./chunks.js";

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
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  returns: v.object({
    results: v.array(vSearchResult),
    entries: v.array(vEntry),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    results: SearchResult[];
    entries: Entry[];
  }> => {
    const { modelId, embedding, filters, limit } = args;
    const namespace = await ctx.runQuery(
      internal.namespaces.getCompatibleNamespace,
      {
        namespace: args.namespace,
        modelId,
        dimension: embedding.length,
        filterNames: filters.map((f) => f.name),
      }
    );
    if (!namespace) {
      console.debug(
        `No compatible namespace found for ${args.namespace} with model ${args.modelId} and dimension ${embedding.length} and filters ${filters.map((f) => f.name).join(", ")}.`
      );
      return {
        results: [],
        entries: [],
      };
    }
    const results = await searchEmbeddings(ctx, {
      embedding,
      namespaceId: namespace._id,
      filters: numberedFiltersFromNamedFilters(filters, namespace.filterNames),
      limit,
    });

    const threshold = args.vectorScoreThreshold ?? -1;
    const aboveThreshold = results.filter((r) => r._score >= threshold);
    const chunkContext = args.chunkContext ?? { before: 0, after: 0 };
    // TODO: break this up if there are too many results
    const { ranges, entries } = await ctx.runQuery(
      internal.chunks.getRangesOfChunks,
      {
        embeddingIds: aboveThreshold.map((r) => r._id),
        chunkContext,
      }
    );
    return {
      results: ranges
        .map((r, i) => publicSearchResult(r, aboveThreshold[i]._score))
        .filter((r) => r !== null),
      entries,
    };
  },
});

function publicSearchResult(
  r: Infer<typeof vRangeResult> | null,
  score: number
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
