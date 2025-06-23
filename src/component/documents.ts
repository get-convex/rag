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
import schema, { vNamedFilter } from "./schema.js";
import { insertChunks, vCreateChunkArgs } from "./chunks.js";

export const upsert = mutation({
  args: {
    document: v.object(
      omit(schema.tables.documents.validator.fields, ["version", "status"])
    ),
    // If we can commit all chunks at the same time, the status is "ready"
    allChunks: v.array(vCreateChunkArgs),
  },
  returns: v.object({
    documentId: v.id("documents"),
    chunkIds: v.union(v.array(v.id("chunks")), v.null()),
  }),
  handler: async (ctx, { document, allChunks }) => {
    const { namespaceId, key } = document;
    const namespace = await ctx.db.get(namespaceId);
    if (!namespace) {
      throw new Error(`Namespace ${namespaceId} not found`);
    }
    // iterate through the latest versions of the document
    const existing = await ctx.db
      .query("documents")
      .withIndex("namespaceId_key_version", (q) =>
        q.eq("namespaceId", namespaceId).eq("key", key)
      )
      .order("desc")
      .first();
    if (existing && existing.status === "pending") {
      console.warn(
        `Existing document ${key} version ${existing.version} is still pending. Skipping...`
      );
    } else if (existing && existing.status === "ready") {
      // Check if the content is the same
      if (existing && existing.contentHash === args.document.contentHash) {
        // Check if the filter values are the same
        if (
          args.document.filterValues.every((filter) =>
            existing.filterValues.some(
              (f) => f.name === filter.name && f.value === filter.value
            )
          )
        ) {
          if (existing.importance === args.document.importance) {
            console.debug(`Document ${key} is the same, skipping...`);
            if (!sourceMatches(existing.source, args.document.source)) {
              console.debug(
                `Document ${key} is the same but source is different, patching...`
              );
              await ctx.db.patch(existing._id, {
                source: args.document.source,
              });
            }
            return {
              documentId: existing._id,
              chunkIds: null,
            };
          } else {
            // We could be clever here and copy over the values and update just
            // the importance, but it's not worth the complexity for now.
            console.debug(
              `Document ${key} is the same but importance is different, updating...`
            );
          }
        } else {
          // We could be clever here and copy over the values and update just
          // the filter values, but it's not worth the complexity for now.
          console.debug(
            `Document ${key} hash matches but filter values are different, updating...`
          );
        }
      }
    }
    const version = existing ? existing.version + 1 : 0;
    const documentId = await ctx.db.insert("documents", {
      ...document,
      version,
      status: allChunks ? "ready" : "pending",
    });
    const chunkIds = await insertChunks(ctx, {
      documentId,
      startOrder: 0,
      chunks: allChunks,
    });
    return { documentId, chunkIds };
  },
});
