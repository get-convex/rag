import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { action } from "./_generated/server.js";
import { searchEmbeddings, type NamedFilter } from "./embeddings/index.js";
import type { NumberedFilter } from "./embeddings/tables.js";
import { vNamedFilter } from "./schema.js";
import { internal } from "./_generated/api.js";
import {
  vDocument,
  vSearchResult,
  type Document,
  type SearchResult,
} from "../shared.js";
import type { DocumentId } from "../client/index.js";
import { vRangeResult } from "./chunks.js";

export const search = action({
  args: {
    namespace: v.string(),
    embedding: v.array(v.number()),
    modelId: v.string(),
    filters: v.array(vNamedFilter),
    limit: v.number(),
    vectorScoreThreshold: v.optional(v.number()),
    messageRange: v.optional(
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  returns: v.object({
    results: v.array(
      v.object({
        documentId: v.id("documents"),
        order: v.number(),
        content: v.array(
          v.object({
            text: v.string(),
            metadata: v.optional(v.record(v.string(), v.any())),
          })
        ),
        startOrder: v.number(),
        score: v.number(),
      })
    ),
    documents: v.array(vDocument),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    results: {
      documentId: Id<"documents">;
      order: number;
      content: { metadata?: Record<string, any> | undefined; text: string }[];
      startOrder: number;
      score: number;
    }[];
    documents: Document[];
  }> => {
    const { modelId, embedding, filters, limit } = args;
    const namespace = await ctx.runQuery(
      internal.namespaces.getCompatibleNamespaceOrThrow,
      {
        namespace: args.namespace,
        modelId,
        dimension: embedding.length,
        filterNames: filters.map((f) => f.name),
      }
    );
    const results = await searchEmbeddings(ctx, {
      embedding,
      namespaceId: namespace._id,
      filters: numberedFilterFromNamedFilter(namespace, filters),
      limit,
    });
    const threshold = args.vectorScoreThreshold ?? -1;
    const aboveThreshold = results.filter((r) => r._score >= threshold);
    const messageRange = args.messageRange ?? { before: 0, after: 0 };
    // TODO: break this up if there are too many results
    const { ranges, documents } = await ctx.runQuery(
      internal.chunks.getRangesOfChunks,
      {
        embeddingIds: aboveThreshold.map((r) => r._id),
        messageRange,
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

function numberedFilterFromNamedFilter(
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
