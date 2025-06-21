import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { omit } from "convex-helpers";
import schema from "./schema.js";

export const upsert = mutation({
  args: {
    ...omit(schema.tables.documents.validator.fields, ["version", "status"]),
  },
  handler: async (ctx, args) => {
    const namespace = await ctx.db.get(args.namespaceId);
    if (!namespace) {
      throw new Error(`Namespace ${args.namespaceId} not found`);
    }
    // iterate through the latest versions of the document
    const existing = await ctx.db
      .query("documents")
      .withIndex("namespaceId_key_version", (q) =>
        q.eq("namespaceId", args.namespaceId).eq("key", args.key)
      )
      .order("desc")
      .first();
    if (existing && existing.status === "pending") {
      console.warn(
        `Existing document ${args.key} version ${existing.version} is still pending. Skipping...`
      );
    } else if (existing && existing.status === "ready") {
      // Check if the content is the same
      if (existing && existing.contentHash === args.contentHash) {
        console.debug(`Document ${args.key} content is the same, skipping...`);
        return {
          documentId: existing._id,
          version: existing.version,
          status: existing.status,
        };
      }
    }
    const version = existing ? existing.version + 1 : 0;
    return ctx.db.insert("documents", { ...args, version, status: "pending" });
  },
});
