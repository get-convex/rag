import type { ObjectType, Value } from "convex/values";
import {
  Entry,
  EntryFilter,
  EntryId,
  filterNamesContain,
  type Namespace,
  type NamespaceId,
} from "../shared.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { type QueryCtx } from "./_generated/server.js";
import { StatusWithOnComplete, v } from "./schema.js";

export function publicNamespace(namespace: Doc<"namespaces">): Namespace {
  const { _id, _creationTime, status, ...rest } = namespace;
  return {
    namespaceId: _id as unknown as NamespaceId,
    createdAt: _creationTime,
    ...rest,
    status: status.kind,
  };
}

export function publicEntry(entry: {
  _id: Id<"entries">;
  key?: string | undefined;
  importance: number;
  filterValues: EntryFilter[];
  contentHash?: string | undefined;
  title?: string | undefined;
  metadata?: Record<string, Value> | undefined;
  status: StatusWithOnComplete;
}): Entry {
  const { key, importance, filterValues, contentHash, title, metadata } = entry;

  const fields = {
    entryId: entry._id as unknown as EntryId,
    key,
    title,
    metadata,
    importance,
    filterValues,
    contentHash,
  };
  if (entry.status.kind === "replaced") {
    return {
      ...fields,
      status: "replaced" as const,
      replacedAt: entry.status.replacedAt,
    };
  } else {
    return {
      ...fields,
      status: entry.status.kind,
    };
  }
}

export const vNamespaceLookupArgs = {
  namespace: v.string(),
  modelId: v.string(),
  dimension: v.number(),
  filterNames: v.array(v.string()),
};

export async function getCompatibleNamespaceHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof vNamespaceLookupArgs>,
) {
  const iter = ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q.eq("status.kind", "ready").eq("namespace", args.namespace),
    )
    .order("desc");
  for await (const existing of iter) {
    if (namespaceIsCompatible(existing, args)) {
      return existing;
    }
  }
  return null;
}

export function namespaceIsCompatible(
  existing: Doc<"namespaces">,
  args: {
    modelId: string;
    dimension: number;
    filterNames: string[];
  },
) {
  // Check basic compatibility
  if (
    existing.modelId !== args.modelId ||
    existing.dimension !== args.dimension
  ) {
    return false;
  }

  // For filter names, the namespace must support all requested filters
  // but can support additional filters (superset is OK)
  if (!filterNamesContain(existing.filterNames, args.filterNames)) {
    return false;
  }

  return true;
}

export async function getPreviousEntry(ctx: QueryCtx, entry: Doc<"entries">) {
  if (!entry.key) {
    return null;
  }
  const previousEntry = await ctx.db
    .query("entries")
    .withIndex("namespaceId_status_key_version", (q) =>
      q
        .eq("namespaceId", entry.namespaceId)
        .eq("status.kind", "ready")
        .eq("key", entry.key),
    )
    .unique();
  if (previousEntry?._id === entry._id) return null;
  return previousEntry;
}
