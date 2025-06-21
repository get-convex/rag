import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import embeddingsTables from "./embeddings/tables.js";
import { typedV } from "convex-helpers/validators";

const schema = defineSchema({
  namespaces: defineTable({
    // user-specified id, eg. userId or "documentation"
    namespace: v.string(),
    version: v.number(),
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("ready")),
  }).index("namespace_version", ["namespace", "version"]),
  documents: defineTable({
    // user-specified id, eg. storage ID or "myfile.txt". Used for upserting.
    id: v.string(),
    namespaceId: v.id("namespaces"),
    version: v.number(),
    importance: v.number(),
    // conveneient metadata
    source: v.union(
      v.object({
        kind: v.literal("_storage"),
        storageId: v.string(),
      }),
      v.object({
        kind: v.literal("inline"),
        // We get the contents from the content table
      }),
      v.object({
        kind: v.literal("url"),
        url: v.string(),
      })
    ),
    mimeType: v.string(),
    metadata: v.optional(v.record(v.string(), v.any())),
    status: v.union(v.literal("pending"), v.literal("ready")),
  }).index("namespaceId_id_version", ["namespaceId", "id", "version"]),
  chunks: defineTable({
    documentId: v.id("documents"),
    order: v.number(),
    embeddingId: v.id("embeddings"),
    contentId: v.id("content"),
    importance: v.number(),
  })
    .index("documentId_order", ["documentId", "order"])
    .index("embeddingId", ["embeddingId"]),
  content: defineTable({
    text: v.string(),
    // convenient metadata
    metadata: v.optional(v.record(v.string(), v.any())),
  }),
  // TODO: text search

  ...embeddingsTables,
});

export const vv = typedV(schema);
export { vv as v };

export default schema;
