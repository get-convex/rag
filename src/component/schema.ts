import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import embeddingsTables from "./embeddings/tables.js";
import { typedV } from "convex-helpers/validators";

export const vNamedFilter = v.object({
  name: v.string(),
  value: v.any(),
});

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
    key: v.string(),
    namespaceId: v.id("namespaces"),
    version: v.number(),
    importance: v.number(),
    // To avoid re-creating/ updating the same document
    // This is a hash that ideally encompasses the content AND chunking strategy
    // e.g. a hash of the list of chunk content hashes.
    contentHash: v.string(),
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
  }).index("namespaceId_key_version", ["namespaceId", "key", "version"]),
  chunks: defineTable({
    documentId: v.id("documents"),
    order: v.number(),
    state: v.union(
      v.object({
        kind: v.literal("pending"),
        embedding: v.array(v.number()),
        filters: v.array(vNamedFilter),
      }),
      v.object({
        kind: v.literal("ready"),
        embeddingId: v.id("embeddings"),
      })
      // We could store the deleted state in a soft delete way in the future.
      // v.object({
      //   kind: v.literal("deleted"),
      //   embeddingId: v.id("embeddings"),
      //   embedding: v.array(v.number()),
      //   filters: v.array(vNamedFilter),
      // })
    ),
    contentId: v.id("content"),
    importance: v.number(),
  })
    .index("documentId_order", ["documentId", "order"])
    .index("embeddingId", ["state.embeddingId"]),
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
