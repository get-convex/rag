import { v } from "convex/values";
import type { Infer, Validator, Value } from "convex/values";
import { vNamedFilter, vSource, type Source } from "./component/schema.js";
import { vDocumentId, type DocumentId } from "./client/index.js";
import type { NamedFilter } from "./component/embeddings/index.js";

export const KB = 1_024;
export const MB = 1_024 * KB;
export const BANDWIDTH_PER_TRANSACTION_HARD_LIMIT = 8 * MB;
export const BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT = 4 * MB;

export const vStatus = v.union(v.literal("pending"), v.literal("ready"));
export type Status = Infer<typeof vStatus>;

export const vNamespace = v.object({
  namespaceId: v.id("namespaces"),
  createdAt: v.number(),
  namespace: v.string(),
  status: vStatus,
  filterNames: v.array(v.string()),
  dimension: v.number(),
  modelId: v.string(),
  version: v.number(),
});

export type Namespace = Infer<typeof vNamespace>;

export const vDocument = v.object({
  key: v.string(),
  documentId: vDocumentId,
  importance: v.number(),
  filterValues: v.array(vNamedFilter),
  contentHash: v.optional(v.string()),
  source: vSource,
  status: vStatus,
});

// Type assertion to keep us honest
const _1: Document = {} as Infer<typeof vDocument>;
const _2: Infer<typeof vDocument> = {} as Document;

export type Document = {
  // User-defined key. You can re-use a key to replace it with new contents.
  key: string;
  // The document's id, uniquely identifying the key + contents + namespace etc.
  documentId: DocumentId;
  // How important this document is. Defaults to 1.
  // Think of it as multiplying by the vector search score.
  importance: number;
  // Filters that can be used to search for this document.
  // Up to 4 filters are supported, of any type.
  filterValues: NamedFilter[];
  // Hash of the document contents.
  // If supplied, it will avoid upserting if the hash is the same.
  contentHash?: string | undefined;
  // Where this document came from.
  source: Source;
  // Whether this document's contents have all been inserted and indexed.
  status: Status;
};

export const vChunk = v.object({
  order: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("deleted")
  ),
  text: v.string(),
  metadata: v.optional(v.record(v.string(), v.any())),
});

export type Chunk = Infer<typeof vChunk>;

export const vCreateChunkArgs = v.object({
  content: v.object({
    text: v.string(),
    metadata: v.optional(v.record(v.string(), v.any())),
  }),
  embedding: v.array(v.number()),
});
export type CreateChunkArgs = Infer<typeof vCreateChunkArgs>;

export function estimateCreateChunkSize(chunk: CreateChunkArgs) {
  const embeddingDataSize = chunk.embedding.length * 8;
  const textDataSize = chunk.content.text.length;
  const metadataDataSize = JSON.stringify(chunk.content.metadata).length;
  return embeddingDataSize + textDataSize + metadataDataSize;
}

export function vPaginationResult<
  T extends Validator<Value, "required", string>,
>(itemValidator: T) {
  return v.object({
    page: v.array(itemValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null()
      )
    ),
  });
}
