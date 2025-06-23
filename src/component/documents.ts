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
      if (documentIsSame(existing, args.document)) {
        if (args.onComplete) {
          await enqueueOnComplete(ctx, args.onComplete);
        }
        return {
          documentId: existing._id,
          chunkIds: null,
        };
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

function documentIsSame(
  existing: Doc<"documents">,
  newDocument: Pick<
    Doc<"documents">,
    "key" | "contentHash" | "importance" | "source" | "filterValues"
  >
) {
  if (existing.contentHash !== newDocument.contentHash) {
    return false;
  }
  if (existing.importance !== newDocument.importance) {
    console.debug(
      `Document ${newDocument.key} importance is different, skipping...`
    );
    return false;
  }
  if (newDocument.filterValues.length !== existing.filterValues.length) {
    console.debug(
      `Document ${newDocument.key} has a different number of filter values, skipping...`
    );
    return false;
  }
  if (
    existing.filterValues.every((filter) =>
      newDocument.filterValues.some(
        (f) => f.name === filter.name && f.value === filter.value
      )
    )
  ) {
    console.debug(
      `Document ${newDocument.key} filter values are different, skipping...`
    );
    return false;
  }
  if (!sourceMatches(existing.source, newDocument.source)) {
    console.debug(
      `Document ${newDocument.key} source is different, skipping...`
    );
    return false;
  }
  return true;
}

function sourceMatches(existing: Source, newSource: Source) {
  switch (existing.kind) {
    case "custom":
      return newSource.kind === "custom" && existing.text === newSource.text;
    case "url":
      return newSource.kind === "url" && existing.url === newSource.url;
    case "_storage":
      return (
        newSource.kind === "_storage" &&
        existing.storageId === newSource.storageId
      );
    default:
      throw new Error(`Unknown source kind: ${existing}`);
  }
}
