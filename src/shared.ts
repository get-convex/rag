import { v } from "convex/values";
import type { Infer, Validator, Value, VObject } from "convex/values";
import { vNamedFilter, type NamedFilter } from "./component/filters.js";
import { brandedString } from "convex-helpers/validators";

// A good middle-ground that has up to ~3MB if embeddings are 4096 (max).
// Also a reasonable number of writes to the DB.
export const CHUNK_BATCH_SIZE = 100;

// Branded types for IDs, as components don't expose the internal ID types.
export const vNamespaceId = brandedString("NamespaceId");
export const vDocumentId = brandedString("DocumentId");
export type NamespaceId = Infer<typeof vNamespaceId>;
export type DocumentId = Infer<typeof vDocumentId>;

export const vSearchResult = v.object({
  documentId: vDocumentId,
  order: v.number(),
  content: v.array(
    v.object({
      text: v.string(),
      metadata: v.optional(v.record(v.string(), v.any())),
    })
  ),
  startOrder: v.number(),
  score: v.number(),
});

export type SearchResult = Infer<typeof vSearchResult>;

export const vStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("replaced")
);
export type Status = Infer<typeof vStatus>;
export const statuses = vStatus.members.map((s) => s.value);

export const vNamespace = v.object({
  namespaceId: vNamespaceId,
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
  title: v.optional(v.string()),
  documentId: vDocumentId,
  importance: v.number(),
  filterValues: v.array(vNamedFilter),
  contentHash: v.optional(v.string()),
  status: vStatus,
});

export type VDocument<Filters extends Record<string, Value>> = VObject<
  Document<Filters>,
  typeof vDocument.fields,
  "required",
  typeof vDocument.fieldPaths
>;

// Type assertion to keep us honest
const _1: Document = {} as Infer<typeof vDocument>;
const _2: Infer<typeof vDocument> = {} as Document;

export type DocumentFilterValues<
  Filters extends Record<string, Value> = Record<string, Value>,
> = {
  [K in keyof Filters & string]: NamedFilter<K, Filters[K]>;
}[keyof Filters & string];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Document<Filters extends Record<string, Value> = any> = {
  // User-defined key. You can re-use a key to replace it with new contents.
  key: string;
  // User-defined title
  title?: string | undefined;
  // The document's id, uniquely identifying the key + contents + namespace etc.
  documentId: DocumentId;
  // How important this document is. Defaults to 1.
  // Think of it as multiplying by the vector search score.
  importance: number;
  // Filters that can be used to search for this document.
  // Up to 4 filters are supported, of any type.
  filterValues: DocumentFilterValues<Filters>[];
  // Hash of the document contents.
  // If supplied, it will avoid upserting if the hash is the same.
  contentHash?: string | undefined;
  // Whether this document's contents have all been inserted and indexed.
  status: Status;
};

export const vChunk = v.object({
  order: v.number(),
  state: vStatus,
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
  searchableText: v.optional(v.string()),
});
export type CreateChunkArgs = Infer<typeof vCreateChunkArgs>;

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

/**
 * Make a contentHash of a Blob that matches the File Storage metadata, allowing
 * identifying when content is identical.
 * @param blob The contents to hash
 * @returns sha256 hash of the contents
 */
export async function contentHashFromBlob(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
    )
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
