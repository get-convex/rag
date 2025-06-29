import { assert, omit } from "convex-helpers";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { EntryId, NamespaceId } from "../shared.js";
import {
  statuses,
  vCreateChunkArgs,
  vEntry,
  vPaginationResult,
  vStatus,
  type Entry,
} from "../shared.js";
import { api } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx } from "./_generated/server.js";
import { deleteChunksPage, insertChunks } from "./chunks.js";
import schema, { type StatusWithOnComplete } from "./schema.js";
import { mergedStream } from "convex-helpers/server/stream";
import { stream } from "convex-helpers/server/stream";
import {
  getCompatibleNamespaceHandler,
  vNamespaceLookupArgs,
} from "./namespaces.js";
import type { OnComplete } from "../client/types.js";

export const addAsync = mutation({
  args: {
    entry: v.object({
      ...omit(schema.tables.entries.validator.fields, ["version", "status"]),
    }),
    onComplete: v.optional(v.string()),
    chunker: v.string(),
  },
  returns: v.object({
    entryId: v.id("entries"),
    status: vStatus,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { namespaceId, key } = args.entry;
    const namespace = await ctx.db.get(namespaceId);
    assert(namespace, `Namespace ${namespaceId} not found`);
    // iterate through the latest versions of the entry
    const existing = await findExistingEntry(ctx, namespaceId, key);
    if (
      existing?.status.kind === "ready" &&
      entryIsSame(existing, args.entry)
    ) {
      if (args.onComplete) {
        await enqueueOnComplete(
          ctx,
          args.onComplete,
          namespace,
          existing,
          // Note: we pass the existing entry as the previous entry too.
          existing,
          true
        );
      }
      return {
        entryId: existing._id,
        status: existing.status.kind,
        created: false,
      };
    }
    const version = existing ? existing.version + 1 : 0;
    const status: StatusWithOnComplete = {
      kind: "pending",
      onComplete: args.onComplete,
    };
    const entryId = await ctx.db.insert("entries", {
      ...args.entry,
      version,
      status,
    });
    await enqueueAdd(ctx, {
      entryId,
      chunker: args.chunker,
    });
    return { entryId, status: status.kind, created: true };
  },
});

async function enqueueAdd(
  _ctx: MutationCtx,
  _args: {
    entryId: Id<"entries">;
    chunker: string;
  }
) {
  // TODO: enqueue into workpool
}

type AddEntryArgs = Pick<
  Doc<"entries">,
  "key" | "contentHash" | "importance" | "filterValues"
>;

async function findExistingEntry(
  ctx: MutationCtx,
  namespaceId: Id<"namespaces">,
  key: string
) {
  const existing = await mergedStream(
    statuses.map((status) =>
      stream(ctx.db, schema)
        .query("entries")
        .withIndex("namespaceId_status_key_version", (q) =>
          q
            .eq("namespaceId", namespaceId)
            .eq("status.kind", status)
            .eq("key", key)
        )
        .order("desc")
    ),
    ["version"]
  ).first();
  return existing;
}

export const add = mutation({
  args: {
    entry: v.object({
      ...omit(schema.tables.entries.validator.fields, ["version", "status"]),
    }),
    onComplete: v.optional(v.string()),
    // If we can commit all chunks at the same time, the status is "ready"
    allChunks: v.optional(v.array(vCreateChunkArgs)),
  },
  returns: v.object({
    entryId: v.id("entries"),
    status: vStatus,
    created: v.boolean(),
    replacedVersion: v.union(vEntry, v.null()),
  }),
  handler: async (ctx, args) => {
    const { namespaceId, key } = args.entry;
    const namespace = await ctx.db.get(namespaceId);
    assert(namespace, `Namespace ${namespaceId} not found`);
    // iterate through the latest versions of the entry
    const existing = await findExistingEntry(ctx, namespaceId, key);
    if (
      existing?.status.kind === "ready" &&
      entryIsSame(existing, args.entry)
    ) {
      if (args.onComplete) {
        await enqueueOnComplete(
          ctx,
          args.onComplete,
          namespace,
          existing,
          // Note: we pass the existing entry as the previous entry too.
          existing,
          true
        );
      }
      return {
        entryId: existing._id,
        status: existing.status.kind,
        created: false,
        replacedVersion: null,
      };
    }
    const version = existing ? existing.version + 1 : 0;
    const entryId = await ctx.db.insert("entries", {
      ...args.entry,
      version,
      status: args.allChunks
        ? { kind: "ready" }
        : { kind: "pending", onComplete: args.onComplete },
    });
    if (args.allChunks) {
      await insertChunks(ctx, {
        entryId,
        startOrder: 0,
        chunks: args.allChunks,
      });
      const { replacedVersion } = await promoteToReadyHandler(ctx, {
        entryId,
      });
      return {
        entryId,
        status: "ready" as const,
        created: true,
        replacedVersion,
      };
    }
    return {
      entryId,
      status: "pending" as const,
      created: true,
      replacedVersion: null,
    };
  },
});

async function enqueueOnComplete(
  ctx: MutationCtx,
  onComplete: string,
  namespace: Doc<"namespaces">,
  entry: Doc<"entries">,
  previousEntry: Doc<"entries"> | null,
  success: boolean
) {
  // TODO: use a workpool
  await ctx.scheduler.runAfter(0, onComplete as unknown as OnComplete, {
    namespace: namespace.namespace,
    namespaceId: namespace._id as unknown as NamespaceId,
    key: entry.key,
    entryId: entry._id as unknown as EntryId,
    previousEntryId: previousEntry?._id as unknown as EntryId | null,
    success,
  });
  throw new Error("Not implemented");
}

function entryIsSame(existing: Doc<"entries">, newEntry: AddEntryArgs) {
  if (!existing.contentHash || !newEntry.contentHash) {
    return false;
  }
  if (existing.contentHash !== newEntry.contentHash) {
    return false;
  }
  if (existing.importance !== newEntry.importance) {
    return false;
  }
  if (newEntry.filterValues.length !== existing.filterValues.length) {
    return false;
  }
  if (
    !existing.filterValues.every((filter) =>
      newEntry.filterValues.some(
        (f) => f.name === filter.name && f.value === filter.value
      )
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Lists entries in order of their most recent change
 */
export const list = query({
  args: {
    namespaceId: v.id("namespaces"),
    order: v.optional(v.union(v.literal("desc"), v.literal("asc"))),
    status: vStatus,
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginationResult(vEntry),
  handler: async (ctx, args) => {
    const results = await stream(ctx.db, schema)
      .query("entries")
      .withIndex("status_namespaceId", (q) =>
        q
          .eq("status.kind", args.status ?? "ready")
          .eq("namespaceId", args.namespaceId)
      )
      .order(args.order ?? "asc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map(publicEntry),
    };
  },
});

/**
 * Gets a entry by its id.
 */
export const get = query({
  args: {
    entryId: v.id("entries"),
  },
  returns: v.union(vEntry, v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) {
      return null;
    }
    return publicEntry(entry);
  },
});

/**
 * Finds a entry by its key and content hash.
 */
export const findByContentHash = query({
  args: {
    ...vNamespaceLookupArgs,
    key: v.string(),
    contentHash: v.string(),
  },
  returns: v.union(vEntry, v.null()),
  handler: async (ctx, args) => {
    const namespace = await getCompatibleNamespaceHandler(ctx, args);
    if (!namespace) {
      return null;
    }
    let attempts = 0;
    for await (const doc of mergedStream(
      statuses.map((status) =>
        stream(ctx.db, schema)
          .query("entries")
          .withIndex("namespaceId_status_key_version", (q) =>
            q
              .eq("namespaceId", namespace._id)
              .eq("status.kind", status)
              .eq("key", args.key)
          )
          .order("desc")
      ),
      ["version"]
    )) {
      attempts++;
      if (attempts > 20) {
        console.debug(
          `Giving up after checking ${attempts} entries for ${args.key} content hash ${args.contentHash}, returning null`
        );
        return null;
      }
      if (
        entryIsSame(doc, {
          key: args.key,
          contentHash: args.contentHash,
          filterValues: doc.filterValues,
          importance: doc.importance,
        })
      ) {
        return publicEntry(doc);
      }
    }
    return null;
  },
});

/**
 * Promotes a entry to ready, replacing any existing ready entry by key.
 * It will also call the associated onComplete function if it was pending.
 * Note: this will not replace the chunks automatically, so you should first
 * call `replaceChunksPage` on all its chunks.
 * Edge case: if the entry has already been replaced, it will return the
 * same entry (replacedVersion.entryId === args.entryId).
 */
export const promoteToReady = mutation({
  args: v.object({
    entryId: v.id("entries"),
  }),
  returns: v.object({
    replacedVersion: v.union(vEntry, v.null()),
  }),
  handler: promoteToReadyHandler,
});

async function promoteToReadyHandler(
  ctx: MutationCtx,
  args: { entryId: Id<"entries"> }
) {
  const entry = await ctx.db.get(args.entryId);
  assert(entry, `Entry ${args.entryId} not found`);
  if (entry.status.kind === "ready") {
    console.debug(`Entry ${args.entryId} is already ready, skipping...`);
    return { replacedVersion: null };
  } else if (entry.status.kind === "replaced") {
    console.debug(
      `Entry ${args.entryId} is already replaced, returning the current version...`
    );
    return { replacedVersion: publicEntry(entry) };
  }
  const previousEntry = await ctx.db
    .query("entries")
    .withIndex("namespaceId_status_key_version", (q) =>
      q
        .eq("namespaceId", entry.namespaceId)
        .eq("status.kind", "ready")
        .eq("key", entry.key)
    )
    .order("desc")
    .unique();
  if (previousEntry) {
    await ctx.db.patch(previousEntry._id, {
      status: { kind: "replaced", replacedAt: Date.now() },
    });
  }
  await ctx.db.patch(args.entryId, {
    status: { kind: "ready" },
  });
  if (entry.status.kind === "pending" && entry.status.onComplete) {
    const namespace = await ctx.db.get(entry.namespaceId);
    assert(namespace, `Namespace for ${entry.namespaceId} not found`);
    await enqueueOnComplete(
      ctx,
      entry.status.onComplete,
      namespace,
      entry,
      previousEntry,
      true
    );
  }
  return {
    replacedVersion: previousEntry ? publicEntry(previousEntry) : null,
  };
}

export function publicEntry(entry: Doc<"entries">): Entry {
  const { key, importance, filterValues, contentHash, title } = entry;

  return {
    entryId: entry._id as unknown as EntryId,
    key,
    title,
    importance,
    filterValues,
    contentHash,
    status: entry.status.kind,
  };
}

export const deleteAsync = mutation({
  args: v.object({
    entryId: v.id("entries"),
    startOrder: v.number(),
  }),
  returns: v.null(),
  handler: async (ctx, args) => {
    const { entryId, startOrder } = args;
    const entry = await ctx.db.get(entryId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }
    const status = await deleteChunksPage(ctx, { entryId, startOrder });
    if (status.isDone) {
      await ctx.db.delete(entryId);
    } else {
      // TODO: schedule follow-up - workpool?
      await ctx.scheduler.runAfter(0, api.entries.deleteAsync, {
        entryId,
        startOrder: status.nextStartOrder,
      });
    }
  },
});
