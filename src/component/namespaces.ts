import { api, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import {
  v,
  vStatusWithOnComplete,
  type StatusWithOnComplete,
} from "./schema.js";
import { vStatus } from "../shared.js";

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
  return (
    existing.modelId === args.modelId &&
    existing.dimension === args.dimension &&
    existing.filterNames.length === args.filterNames.length &&
    existing.filterNames.every((name, i) => name === args.filterNames[i])
  );
}

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
    const iter = ctx.db
      .query("namespaces")
      .withIndex("namespace_version", (q) => q.eq("namespace", args.namespace))
      .order("desc");

    for await (const existing of iter) {
      if (existing.status.kind !== args.status.kind) {
        console.debug(
          `Namespace ${args.namespace} has status ${existing.status.kind}, skipping...`
        );
        continue;
      }
      // see if it's compatible
      if (namespaceIsCompatible(existing, args)) {
        console.debug(
          `Namespace ${args.namespace} is compatible, returning existing version ${existing.version}`,
          existing
        );
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
      const version = existing.version + 1;
      return {
        namespaceId: await ctx.db.insert("namespaces", { ...args, version }),
        status: args.status.kind,
      };
    }
    const version = 0;
    const namespaceId = await ctx.db.insert("namespaces", { ...args, version });
    return {
      namespaceId,
      status: args.status.kind,
    };
  },
});
