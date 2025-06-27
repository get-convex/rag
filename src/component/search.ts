import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { action } from "./_generated/server.js";
import { searchEmbeddings } from "./embeddings/index.js";
import {
  vNamedFilter,
  type NamedFilter,
  type NumberedFilter,
} from "./filters.js";
import { internal } from "./_generated/api.js";
import {
  vDocument,
  type Document,
  vSearchResultInner as vSearchResult,
  type SearchResultInner as SearchResult,
} from "../shared.js";

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
    documents: v.array(vDocument),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    results: SearchResult[];
    documents: Document[];
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
        documents: [],
      };
    }
    const results = await searchEmbeddings(ctx, {
      embedding,
      namespaceId: namespace._id,
      filters: numberedFiltersFromNamedFilters(namespace, filters),
      limit,
    });

    const threshold = args.vectorScoreThreshold ?? -1;
    const aboveThreshold = results.filter((r) => r._score >= threshold);
    const chunkContext = args.chunkContext ?? { before: 0, after: 0 };
    // TODO: break this up if there are too many results
    const { ranges, documents } = await ctx.runQuery(
      internal.chunks.getRangesOfChunks,
      {
        embeddingIds: aboveThreshold.map((r) => r._id),
        chunkContext,
      }
    );
    return {
      results: ranges
        .map((r, i) =>
          r !== null ? { ...r, score: aboveThreshold[i]._score } : null
        )
        .filter((r) => r !== null),
      documents,
    };
  },
});

// This makes a list of filters with values into a list with their indices.
// This is used for search, not inserting embeddings.
function numberedFiltersFromNamedFilters(
  namespace: Doc<"namespaces">,
  filters: NamedFilter[]
): Array<NumberedFilter> {
  const filterFields: Array<NumberedFilter> = [];
  for (const filter of filters) {
    const index = namespace.filterNames.indexOf(filter.name);
    if (index === -1) {
      throw new Error(
        `Unknown filter name: ${filter.name} for namespace ${namespace._id} (${namespace.namespace} version ${namespace.version})`
      );
    }
    filterFields.push({ [index]: filter.value });
  }
  return filterFields;
}
