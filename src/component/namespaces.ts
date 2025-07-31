import type { Doc, Id } from "./_generated/dataModel.js";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { schema, v } from "./schema.js";
import {
  vNamespace,
  vPaginationResult,
  vActiveStatus,
  type Namespace,
  type NamespaceId,
  type OnCompleteNamespace,
  vStatus,
  statuses,
  filterNamesContain,
} from "../shared.js";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import type { ObjectType } from "convex/values";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { assert } from "convex-helpers";

function namespaceIsCompatible(
  existing: Doc<"namespaces">,
  args: {
    modelId: string;
    dimension: number;
    filterNames: string[];
  }
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

export const vNamespaceLookupArgs = {
  namespace: v.string(),
  modelId: v.string(),
  dimension: v.number(),
  filterNames: v.array(v.string()),
};

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

export async function getCompatibleNamespaceHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof vNamespaceLookupArgs>
) {
  const iter = ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q.eq("status.kind", "ready").eq("namespace", args.namespace)
    )
    .order("desc");
  for await (const existing of iter) {
    if (namespaceIsCompatible(existing, args)) {
      return existing;
    }
  }
  return null;
}

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
            q.eq("status.kind", status).eq("namespace", args.namespace)
          )
          .order("desc")
      ),
      ["version"]
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
  replacedNamespace: Doc<"namespaces"> | null
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
  args: { namespaceId: Id<"namespaces"> }
) {
  const namespace = await ctx.db.get(args.namespaceId);
  assert(namespace, `Namespace ${args.namespaceId} not found`);
  if (namespace.status.kind === "ready") {
    console.debug(
      `Namespace ${args.namespaceId} is already ready, not promoting`
    );
    return { replacedNamespace: null };
  } else if (namespace.status.kind === "replaced") {
    console.debug(
      `Namespace ${args.namespaceId} is already replaced, not promoting and returning itself`
    );
    return { replacedNamespace: publicNamespace(namespace) };
  }
  const previousNamespace = await ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q.eq("status.kind", "ready").eq("namespace", namespace.namespace)
    )
    .order("desc")
    .unique();
  if (previousNamespace) {
    // First mark the previous namespace as replaced,
    // so there are never two "ready" namespaces.
    previousNamespace.status = { kind: "replaced", replacedAt: Date.now() };
    await ctx.db.replace(previousNamespace._id, previousNamespace);
  }
  // Only then mark the current namespace as ready,
  // so there are never two "ready" namespaces.
  const previousStatus = namespace.status;
  namespace.status = { kind: "ready" };
  await ctx.db.replace(args.namespaceId, namespace);
  // Then run the onComplete function where it can observe itself as "ready".
  if (previousStatus.kind === "pending" && previousStatus.onComplete) {
    await runOnComplete(
      ctx,
      previousStatus.onComplete,
      namespace,
      previousNamespace
    );
  }
  const previousPendingNamespaces = await ctx.db
    .query("namespaces")
    .withIndex("status_namespace_version", (q) =>
      q
        .eq("status.kind", "pending")
        .eq("namespace", namespace.namespace)
        .lt("version", namespace.version)
    )
    .collect();
  // Then mark all previous pending namespaces as replaced,
  // so they can observe the new namespace and onComplete side-effects.
  await Promise.all(
    previousPendingNamespaces.map(async (namespace) => {
      const previousStatus = namespace.status;
      namespace.status = { kind: "replaced", replacedAt: Date.now() };
      await ctx.db.replace(namespace._id, namespace);
      if (previousStatus.kind === "pending" && previousStatus.onComplete) {
        await runOnComplete(ctx, previousStatus.onComplete, namespace, null);
      }
    })
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
        q.eq("status.kind", args.status ?? "ready")
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
            q.eq("status.kind", status).eq("namespace", args.namespace)
          )
          .order("desc")
      ),
      ["version"]
    ).paginate(args.paginationOpts);

    return {
      ...namespaces,
      page: namespaces.page.map(publicNamespace),
    };
  },
});


export function publicNamespace(namespace: Doc<"namespaces">): Namespace {
  const { _id, _creationTime, status, ...rest } = namespace;
  return {
    namespaceId: _id as unknown as NamespaceId,
    createdAt: _creationTime,
    ...rest,
    status: status.kind,
  };
}

// TODO: deletion
