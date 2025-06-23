import { v } from "convex/values";
import type { Infer, Validator, Value } from "convex/values";
import { vNamedFilter, vSource, type Source } from "./component/schema.js";
import { vDocumentId, type DocumentId } from "./client/index.js";
import type { NamedFilter } from "./component/embeddings/index.js";

export const vStatus = v.union(v.literal("pending"), v.literal("ready"));
export type Status = Infer<typeof vStatus>;

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
