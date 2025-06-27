import type { Doc } from "./_generated/dataModel.js";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import { schema, v, vStatusWithOnComplete } from "./schema.js";
import {
  statuses,
  vNamespace,
  vPaginationResult,
  vStatus,
  type Namespace,
} from "../shared.js";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import type { ObjectType } from "convex/values";
import { mergedStream, stream } from "convex-helpers/server/stream";

export const get = query({
  args: {
    namespaceId: v.id("namespaces"),
  },
  returns: v.object({
    namespace: v.string(),
    status: vStatus,
  }),
  handler: async (ctx, args) => {
    const namespace = await ctx.db.get(args.namespaceId);
    if (!namespace) {
      throw new Error(`Namespace ${args.namespaceId} not found`);
    }
    return {
      namespace: namespace.namespace,
      status: namespace.status.kind,
    };
  },
});

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
  for (const requestedFilterName of args.filterNames) {
    if (!existing.filterNames.includes(requestedFilterName)) {
      return false;
    }
  }

  return true;
}

export const vNamespaceLookupArgs = {
  namespace: v.string(),
  modelId: v.string(),
  dimension: v.number(),
  filterNames: v.array(v.string()),
};

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
  let first: Doc<"namespaces"> | null = null;
  for await (const existing of iter) {
    if (!first) first = existing;
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
    status: vStatusWithOnComplete,
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
  },
  returns: v.object({
    namespaceId: v.id("namespaces"),
    status: vStatus,
  }),
  handler: async (ctx, args) => {
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
      if (existing.status.kind !== args.status.kind) {
        console.debug(
          `Namespace ${args.namespace} has status ${existing.status.kind}, skipping...`
        );
        continue;
      }
      // see if it's compatible
      if (namespaceIsCompatible(existing, args)) {
        return {
          namespaceId: existing._id,
          status: existing.status.kind,
        };
      }
      console.debug(
        `Namespace ${args.namespace} is incompatible, creating new version ${existing.version + 1}`,
        existing,
        args
      );
      return {
        namespaceId: await ctx.db.insert("namespaces", { ...args, version }),
        status: args.status.kind,
      };
    }
    const namespaceId = await ctx.db.insert("namespaces", { ...args, version });
    return {
      namespaceId,
      status: args.status.kind,
    };
  },
});

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

function publicNamespace(namespace: Doc<"namespaces">): Namespace {
  const { _id, _creationTime, status, ...rest } = namespace;
  return {
    namespaceId: _id,
    createdAt: _creationTime,
    ...rest,
    status: status.kind,
  };
}

// TODO: deletion
