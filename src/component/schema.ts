import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";
import embeddingsTables, { vVectorId } from "./embeddings/tables.js";
import { typedV } from "convex-helpers/validators";
import {
  allFilterFieldNames,
  vAllFilterFields,
  vNamedFilter,
} from "./filters.js";

export const vSource = v.union(
  v.object({
    kind: v.literal("_storage"),
    storageId: v.id("_storage"),
  }),
  v.object({
    kind: v.literal("url"),
    url: v.string(),
  })
);
export type Source = Infer<typeof vSource>;

export const vStatusWithOnComplete = v.union(
  v.object({
    kind: v.literal("pending"),
    // Callback function handle for when the namespace/document is ready/failed.
    onComplete: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("ready"),
  }),
  v.object({
    kind: v.literal("replaced"),
    replacedAt: v.number(),
  })
);

export type StatusWithOnComplete = Infer<typeof vStatusWithOnComplete>;

export const schema = defineSchema({
  namespaces: defineTable({
    // user-specified id, eg. userId or "documentation"
    namespace: v.string(),
    version: v.number(),
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
    status: vStatusWithOnComplete,
  }).index("status_namespace_version", ["status.kind", "namespace", "version"]),
  documents: defineTable({
    // user-specified id, eg. storage ID or "myfile.txt". Used for upserting.
    key: v.string(),
    namespaceId: v.id("namespaces"),
    version: v.number(),
    importance: v.number(),
    filterValues: v.array(vNamedFilter),
    // To avoid re-creating/ updating the same document
    // This is a hash that ideally encompasses the content AND chunking strategy
    // e.g. a hash of the list of chunk content hashes.
    contentHash: v.string(),
    // conveneient metadata
    title: v.optional(v.string()),
    source: vSource,
    // mimeType: v.string(),
    // metadata: v.optional(v.record(v.string(), v.any())),
    status: vStatusWithOnComplete,
  })
    .index("namespaceId_status_key_version", [
      "namespaceId",
      "status.kind",
      "key",
      "version",
    ])
    // To look up most recently changed documents
    .index("status_namespaceId", ["status.kind", "namespaceId"]),
  chunks: defineTable({
    documentId: v.id("documents"),
    order: v.number(),
    state: v.union(
      v.object({
        kind: v.literal("pending"),
        embedding: v.array(v.number()),
        importance: v.number(),
        pendingSearchableText: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("ready"),
        embeddingId: vVectorId,
        // TODO: text search
        searchableText: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("replaced"),
        embeddingId: vVectorId,
        vector: v.array(v.number()),
        pendingSearchableText: v.optional(v.string()),
      })
    ),
    // TODO: should content be inline?
    contentId: v.id("content"),
    ...vAllFilterFields,
  })
    .index("documentId_order", ["documentId", "order"])
    .index("embeddingId", ["state.embeddingId"])
    .searchIndex("searchableText", {
      searchField: "state.searchableText",
      filterFields: allFilterFieldNames,
    }),
  content: defineTable({
    text: v.string(),
    // convenient metadata
    metadata: v.optional(v.record(v.string(), v.any())),
  }),

  ...embeddingsTables,
});

export const vv = typedV(schema);
export { vv as v };

export default schema;
