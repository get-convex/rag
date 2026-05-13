import { assert } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator, PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import {
  statuses,
  vActiveStatus,
  vEntry,
  vNamespace,
  vPaginationResult,
  vStatus,
  type OnCompleteNamespace,
} from "../shared.js";
import { api } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { deleteEntrySync } from "./entries.js";
import {
  getCompatibleNamespaceHandler,
  namespaceIsCompatible,
  publicNamespace,
  vNamespaceLookupArgs,
} from "./helpers.js";
import { schema, v } from "./schema.js";

export const get = query({
  args: vNamespaceLookupArgs,
  returns: v.union(v.null(), vNamespace),
  handler: async (ctx, args) => {
    const namespace = await getCompatibleNamespaceHandler(ctx, args);
    if (!namespace) {
      return null;
    }
    return publicNamespace(namespace);
  },
});

export const getCompatibleNamespace = internalQuery({
  args: vNamespaceLookupArgs,
  returns: v.union(v.null(), v.doc("namespaces")),
  handler: getCompatibleNamespaceHandler,
});

export const lookup = query({
  args: {
    namespace: v.string(),
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
  },
  returns: v.union(v.null(), v.id("namespaces")),
  handler: async (ctx, args) => {
    const namespace = await getCompatibleNamespaceHandler(ctx, args);
    if (!namespace) {
      return null;
    }
    return namespace._id;
  },
});

export const getOrCreate = mutation({
  args: {
    namespace: v.string(),
    status: vActiveStatus,
    onComplete: v.optional(v.string()),
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
  },
  returns: v.object({
    namespaceId: v.id("namespaces"),
    status: vActiveStatus,
  }),
  handler: async (ctx, args) => {
    const { status, onComplete, ...rest } = args;
    const iter = mergedStream(
      statuses.map((status) =>
        stream(ctx.db, schema)
          .query("namespaces")
          .withIndex("status_namespace_version", (q) =>
            q.eq("status.kind", status).eq("namespace", args.namespace),
          )
          .order("desc"),
      ),
      ["version"],
    );

    let version: number = 0;
    for await (const existing of iter) {
      if (!version) version = existing.version + 1;
      if (existing.status.kind !== args.status) {
        continue;
      }
      // see if it's compatible
      if (namespaceIsCompatible(existing, args)) {
        return {
          namespaceId: existing._id,
          status: existing.status.kind,
        };
      }
    }
    const namespaceId = await ctx.db.insert("namespaces", {
      status: { kind: "pending", onComplete },
      version,
      ...rest,
    });
    if (status === "ready") {
      await promoteToReadyHandler(ctx, { namespaceId });
    }
    return {
      namespaceId,
      status,
    };
  },
});

async function runOnComplete(
  ctx: MutationCtx,
  onComplete: string | undefined,
  namespace: Doc<"namespaces">,
  replacedNamespace: Doc<"namespaces"> | null,
) {
  const onCompleteFn = onComplete as unknown as OnCompleteNamespace;
  if (!onCompleteFn) {
    throw new Error(`On complete function ${onComplete} not found`);
  }
  await ctx.runMutation(onCompleteFn, {
    namespace: publicNamespace(namespace),
    replacedNamespace: replacedNamespace
      ? publicNamespace(replacedNamespace)
      : null,
  });
}

export const promoteToReady = mutation({
  args: {
    namespaceId: v.id("namespaces"),
  },
  returns: v.object({
    replacedNamespace: v.union(v.null(), vNamespace),
  }),
  handler: promoteToReadyHandler,
});

async function promoteToReadyHandler(
  ctx: MutationCtx,
  args: { namespaceId: Id<"namespaces"> },
) {
  const namespace = await ctx.db.get("namespaces", args.namespaceId);
  assert(namespace, `Namespace ${args.namespaceId} not found`);
  if (namespace.status.kind === "ready") {
    console.debug(
      `Namespace ${args.namespaceId} is already ready, not promoting`,
    );
    return { replacedNamespace: null };
  } else if (namespace.status.kind === "replaced") {
    console.debug(
      `Namespace ${args.namespaceId} is already replaced, not promoting and returning itself`,
    );
    return { replacedNamespace: publicNamespace(namespace) };
  }
  const previousNamespace = await ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q.eq("status.kind", "ready").eq("namespace", namespace.namespace),
    )
    .order("desc")
    .unique();
  if (previousNamespace) {
    // First mark the previous namespace as replaced,
    // so there are never two "ready" namespaces.
    previousNamespace.status = { kind: "replaced", replacedAt: Date.now() };
    await ctx.db.replace("namespaces", previousNamespace._id, previousNamespace);
  }
  // Only then mark the current namespace as ready,
  // so there are never two "ready" namespaces.
  const previousStatus = namespace.status;
  namespace.status = { kind: "ready" };
  await ctx.db.replace("namespaces", args.namespaceId, namespace);
  // Then run the onComplete function where it can observe itself as "ready".
  if (previousStatus.kind === "pending" && previousStatus.onComplete) {
    await runOnComplete(
      ctx,
      previousStatus.onComplete,
      namespace,
      previousNamespace,
    );
  }
  const previousPendingNamespaces = await ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q
        .eq("status.kind", "pending")
        .eq("namespace", namespace.namespace)
        .lt("version", namespace.version),
    )
    .collect();
  // Then mark all previous pending namespaces as replaced,
  // so they can observe the new namespace and onComplete side-effects.
  await Promise.all(
    previousPendingNamespaces.map(async (namespace) => {
      const previousStatus = namespace.status;
      namespace.status = { kind: "replaced", replacedAt: Date.now() };
      await ctx.db.replace("namespaces", namespace._id, namespace);
      if (previousStatus.kind === "pending" && previousStatus.onComplete) {
        await runOnComplete(ctx, previousStatus.onComplete, namespace, null);
      }
    }),
  );
  return {
    replacedNamespace: previousNamespace
      ? publicNamespace(previousNamespace)
      : null,
  };
}

export const list = query({
  args: v.object({
    paginationOpts: paginationOptsValidator,
    status: vStatus,
  }),
  returns: vPaginationResult(vNamespace),
  handler: async (ctx, args) => {
    const namespaces = await paginator(ctx.db, schema)
      .query("namespaces")
      .withIndex("status_namespace_version", (q) =>
        q.eq("status.kind", args.status ?? "ready"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...namespaces,
      page: namespaces.page.map(publicNamespace),
    };
  },
});

export const listNamespaceVersions = query({
  args: { namespace: v.string(), paginationOpts: paginationOptsValidator },
  returns: vPaginationResult(vNamespace),
  handler: async (ctx, args) => {
    const namespaces = await mergedStream(
      statuses.map((status) =>
        stream(ctx.db, schema)
          .query("namespaces")
          .withIndex("status_namespace_version", (q) =>
            q.eq("status.kind", status).eq("namespace", args.namespace),
          )
          .order("desc"),
      ),
      ["version"],
    ).paginate(args.paginationOpts);

    return {
      ...namespaces,
      page: namespaces.page.map(publicNamespace),
    };
  },
});

export const deleteNamespace = mutation({
  args: { namespaceId: v.id("namespaces") },
  returns: v.object({
    deletedNamespace: v.union(v.null(), vNamespace),
  }),
  handler: deleteHandler,
});

async function deleteHandler(
  ctx: MutationCtx,
  args: { namespaceId: Id<"namespaces"> },
) {
  const namespace = await ctx.db.get("namespaces", args.namespaceId);
  assert(namespace, `Namespace ${args.namespaceId} not found`);
  const anyEntry = await ctx.db
    .query("entries")
    .withIndex("namespaceId_status_key_version", (q) =>
      q.eq("namespaceId", args.namespaceId),
    )
    .first();
  if (anyEntry) {
    throw new Error(
      `Namespace ${args.namespaceId} cannot delete, has entries` +
        "First delete all entries." +
        `Entry: ${anyEntry.key} id ${anyEntry._id} (${anyEntry.status.kind})`,
    );
  }
  await ctx.db.delete("namespaces", args.namespaceId);
  return { deletedNamespace: publicNamespace(namespace) };
}

export const deleteNamespaceSync = action({
  args: { namespaceId: v.id("namespaces") },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const status of statuses) {
      let cursor: string | null = null;
      while (true) {
        const entries = (await ctx.runQuery(api.entries.list, {
          namespaceId: args.namespaceId,
          status: status,
          paginationOpts: {
            numItems: 100,
            cursor,
          },
        })) as PaginationResult<Infer<typeof vEntry>>;
        for (const entry of entries.page) {
          await deleteEntrySync(ctx, entry.entryId as unknown as Id<"entries">);
        }
        if (entries.isDone) {
          break;
        }
        cursor = entries.continueCursor;
      }
    }
    await ctx.runMutation(api.namespaces.deleteNamespace, {
      namespaceId: args.namespaceId,
    });
  },
});
