import { v } from "convex/values";
import type { Infer, Validator, Value, VObject } from "convex/values";
import { vNamedFilter, type NamedFilter } from "./component/filters.js";
import { brandedString } from "convex-helpers/validators";
import type { FunctionReference } from "convex/server";

// A good middle-ground that has up to ~3MB if embeddings are 4096 (max).
// Also a reasonable number of writes to the DB.
export const CHUNK_BATCH_SIZE = 100;

// Branded types for IDs, as components don't expose the internal ID types.
export const vNamespaceId = brandedString("NamespaceId");
export const vEntryId = brandedString("EntryId");
export type NamespaceId = Infer<typeof vNamespaceId>;
export type EntryId = Infer<typeof vEntryId>;

export const vSearchResult = v.object({
  entryId: vEntryId,
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
export const vActiveStatus = v.union(v.literal("pending"), v.literal("ready"));
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

export const vEntry = v.object({
  key: v.optional(v.string()),
  title: v.optional(v.string()),
  entryId: vEntryId,
  importance: v.number(),
  filterValues: v.array(vNamedFilter),
  contentHash: v.optional(v.string()),
  status: vStatus,
});

export type VEntry<Filters extends Record<string, Value>> = VObject<
  Entry<Filters>,
  typeof vEntry.fields,
  "required",
  typeof vEntry.fieldPaths
>;

// Type assertion to keep us honest
const _1: Entry = {} as Infer<typeof vEntry>;
const _2: Infer<typeof vEntry> = {} as Entry;

export type EntryFilterValues<
  Filters extends Record<string, Value> = Record<string, Value>,
> = {
  [K in keyof Filters & string]: NamedFilter<K, Filters[K]>;
}[keyof Filters & string];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Entry<Filters extends Record<string, Value> = any> = {
  /** The entry's id, uniquely identifying the key + contents + namespace etc. */
  entryId: EntryId;
  /** User-defined key. You can re-use a key to replace it with new contents. */
  key?: string | undefined;
  /** User-defined title. */
  title?: string | undefined;
  /** How important this entry is. Defaults to 1.
   * Think of it as multiplying by the vector search score.
   */
  importance: number;
  /** Filters that can be used to search for this entry.
   * Up to 4 filters are supported, of any type.
   */
  filterValues: EntryFilterValues<Filters>[];
  /** Hash of the entry contents.
   * If supplied, it will avoid adding if the hash is the same.
   */
  contentHash?: string | undefined;
  /** Whether this entry's contents have all been inserted and indexed. */
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

export type OnCompleteNamespace = FunctionReference<
  "mutation",
  "internal",
  {
    namespace: string;
    namespaceId: NamespaceId;
    previousNamespaceId: NamespaceId | null;
    success: boolean;
  },
  null,
  string
>;

export type OnComplete = FunctionReference<
  "mutation",
  "internal",
  {
    namespace: string;
    namespaceId: NamespaceId;
    key?: string | undefined;
    entryId: EntryId;
    previousEntryId: EntryId | null;
    success: boolean;
  },
  null,
  string
>;

export const vChunkerArgs = v.object({
  namespace: vNamespace,
  entry: vEntry,
  insertChunks: v.string(),
});

export type ChunkerAction = FunctionReference<
  "action",
  "internal",
  Infer<typeof vChunkerArgs>,
  null
>;
