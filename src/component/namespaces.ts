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
import { v } from "./schema.js";

async function getNamespace(
  ctx: QueryCtx,
  namespace: string,
  namespaceVersion?: number
) {}

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

export const upsert = mutation({
  args: {
    namespace: v.string(),
    status: v.union(v.literal("pending"), v.literal("ready")),
    modelId: v.string(),
    dimension: v.number(),
    filterNames: v.array(v.string()),
  },
  returns: v.object({
    namespaceId: v.id("namespaces"),
    status: v.union(v.literal("pending"), v.literal("ready")),
  }),
  handler: async (ctx, args) => {
    const iter = ctx.db
      .query("namespaces")
      .withIndex("namespace_version", (q) => q.eq("namespace", args.namespace))
      .order("desc");

    for await (const existing of iter) {
      if (existing.status === "pending") {
        console.error(
          `Namespace ${args.namespace} has a pending version ${existing.version}, overriding...`
        );
        continue;
      }
      if (existing.status !== "ready") {
        console.warn(`Namespace ${args.namespace} is not ready, skipping...`);
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
          status: existing.status,
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
        status: args.status,
      };
    }
    const version = 0;
    const namespaceId = await ctx.db.insert("namespaces", { ...args, version });
    return {
      namespaceId,
      status: args.status,
    };
  },
});
