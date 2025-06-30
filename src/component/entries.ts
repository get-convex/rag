import { assert, omit } from "convex-helpers";
import { createFunctionHandle, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type {
  ChunkerAction,
  EntryFilterValues,
  EntryId,
  NamespaceId,
} from "../shared.js";
import {
  statuses,
  vCreateChunkArgs,
  vEntry,
  vPaginationResult,
  vStatus,
  type Entry,
} from "../shared.js";
import { api, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { deleteChunksPage, insertChunks } from "./chunks.js";
import schema, { type StatusWithOnComplete } from "./schema.js";
import { mergedStream } from "convex-helpers/server/stream";
import { stream } from "convex-helpers/server/stream";
import {
  getCompatibleNamespaceHandler,
  publicNamespace,
  vNamespaceLookupArgs,
} from "./namespaces.js";
import type { OnComplete } from "../shared.js";
import {
  vResultValidator,
  vWorkIdValidator,
  Workpool,
} from "@convex-dev/workpool";
import { components } from "./_generated/api.js";

const workpool = new Workpool(components.workpool, {
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    base: 2,
  },
  maxParallelism: 10,
});

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
        await runOnComplete(
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
    const chunkerAction = args.chunker as unknown as ChunkerAction;
    // TODO: Cancel any existing chunker actions for this entry?
    await workpool.enqueueAction(
      ctx,
      chunkerAction,
      {
        namespace: publicNamespace(namespace),
        entry: publicEntry({
          ...args.entry,
          _id: entryId,
          status: status,
        }),
        insertChunks: await createFunctionHandle(api.chunks.insert),
      },
      {
        name: workpoolName(namespace.namespace, args.entry.key, entryId),
        onComplete: internal.entries.addAsyncOnComplete,
        context: entryId,
      }
    );
    return { entryId, status: status.kind, created: true };
  },
});

function workpoolName(
  namespace: string,
  key: string | undefined,
  entryId: Id<"entries">
) {
  return `async-chunker-${namespace}-${key ? key + "-" + entryId : entryId}`;
}

export const addAsyncOnComplete = internalMutation({
  args: {
    workId: vWorkIdValidator,
    context: v.id("entries"),
    result: vResultValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entryId = args.context;
    const entry = await ctx.db.get(args.context);
    if (!entry) {
      console.error(
        `Entry ${args.context} not found when trying to complete chunker for async add`
      );
      return;
    }
    if (args.result.kind === "success") {
      await promoteToReadyHandler(ctx, { entryId });
    } else {
      // await deleteAsyncHandler(ctx, { entryId, startOrder: 0 });
      await ctx.db.patch(entryId, {
        status: { kind: "replaced", replacedAt: Date.now() },
      });
      const namespace = await ctx.db.get(entry.namespaceId);
      assert(namespace, `Namespace ${entry.namespaceId} not found`);
      if (entry.status.kind === "pending" && entry.status.onComplete) {
        await runOnComplete(
          ctx,
          entry.status.onComplete,
          namespace,
          entry,
          null,
          false
        );
      }
    }
  },
});

type AddEntryArgs = Pick<
  Doc<"entries">,
  "key" | "contentHash" | "importance" | "filterValues"
>;

async function findExistingEntry(
  ctx: MutationCtx,
  namespaceId: Id<"namespaces">,
  key: string | undefined
) {
  if (!key) {
    return null;
  }
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
        await runOnComplete(
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

async function runOnComplete(
  ctx: MutationCtx,
  onComplete: string,
  namespace: Doc<"namespaces">,
  entry: Doc<"entries">,
  previousEntry: Doc<"entries"> | null,
  success: boolean
) {
  await ctx.runMutation(onComplete as unknown as OnComplete, {
    namespace: namespace.namespace,
    namespaceId: namespace._id as unknown as NamespaceId,
    key: entry.key,
    entryId: entry._id as unknown as EntryId,
    previousEntryId: previousEntry?._id as unknown as EntryId | null,
    success,
  });
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
  args: { entryId: v.id("entries") },
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
    for await (const entry of mergedStream(
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
        entryIsSame(entry, {
          key: args.key,
          contentHash: args.contentHash,
          filterValues: entry.filterValues,
          importance: entry.importance,
        })
      ) {
        return publicEntry(entry);
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
  const namespace = await ctx.db.get(entry.namespaceId);
  assert(namespace, `Namespace for ${entry.namespaceId} not found`);
  if (entry.status.kind === "ready") {
    console.debug(`Entry ${args.entryId} is already ready, skipping...`);
    return { replacedVersion: null };
  } else if (entry.status.kind === "replaced") {
    console.debug(
      `Entry ${args.entryId} is already replaced, returning the current version...`
    );
    return { replacedVersion: publicEntry(entry) };
  }
  const previousEntry = await getPreviousEntry(ctx, entry);
  // First mark the previous entry as replaced,
  // so there are never two "ready" entries.
  if (previousEntry) {
    await ctx.db.patch(previousEntry._id, {
      status: { kind: "replaced", replacedAt: Date.now() },
    });
  }
  // Only then mark the current entry as ready,
  // so there are never two "ready" entries.
  await ctx.db.patch(args.entryId, { status: { kind: "ready" } });
  // Then run the onComplete function where it can observe itself as "ready".
  if (entry.status.kind === "pending" && entry.status.onComplete) {
    await runOnComplete(
      ctx,
      entry.status.onComplete,
      namespace,
      entry,
      previousEntry,
      true
    );
  }
  // Then mark all previous pending entries as replaced,
  // so they can observe the new entry and onComplete side-effects.
  if (entry.key) {
    const previousPendingEntries = await ctx.db
      .query("entries")
      .withIndex("namespaceId_status_key_version", (q) =>
        q
          .eq("namespaceId", entry.namespaceId)
          .eq("status.kind", "pending")
          .eq("key", entry.key)
          .lt("version", entry.version)
      )
      .collect();
    await Promise.all(
      previousPendingEntries.map(async (entry) => {
        await ctx.db.patch(entry._id, {
          status: { kind: "replaced", replacedAt: Date.now() },
        });
        if (entry.status.kind === "pending" && entry.status.onComplete) {
          await runOnComplete(
            ctx,
            entry.status.onComplete,
            namespace,
            entry,
            previousEntry,
            false
          );
        }
      })
    );
  }
  return {
    replacedVersion: previousEntry ? publicEntry(previousEntry) : null,
  };
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
        .eq("key", entry.key)
    )
    .unique();
  if (previousEntry?._id === entry._id) return null;
  return previousEntry;
}

export function publicEntry(entry: {
  _id: Id<"entries">;
  key?: string | undefined;
  importance: number;
  filterValues: EntryFilterValues[];
  contentHash?: string | undefined;
  title?: string | undefined;
  status: StatusWithOnComplete;
}): Entry {
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
  handler: deleteAsyncHandler,
});

async function deleteAsyncHandler(
  ctx: MutationCtx,
  args: { entryId: Id<"entries">; startOrder: number }
) {
  const { entryId, startOrder } = args;
  const entry = await ctx.db.get(entryId);
  if (!entry) {
    throw new Error(`Entry ${entryId} not found`);
  }
  const status = await deleteChunksPage(ctx, { entryId, startOrder });
  if (status.isDone) {
    await ctx.db.delete(entryId);
  } else {
    await workpool.enqueueMutation(ctx, api.entries.deleteAsync, {
      entryId,
      startOrder: status.nextStartOrder,
    });
  }
}
