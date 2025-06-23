import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx } from "./_generated/server.js";
import { omit } from "convex-helpers";
import schema, { type Source } from "./schema.js";
import { insertChunks, vCreateChunkArgs } from "./chunks.js";
import { vDocument, vPaginationResult, type Document } from "../shared.js";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import type { DocumentId } from "../client/index.js";

export const upsert = mutation({
  args: {
    document: v.object({
      ...omit(schema.tables.documents.validator.fields, ["version", "status"]),
    }),
    onComplete: v.optional(v.string()),
    // If we can commit all chunks at the same time, the status is "ready"
    allChunks: v.optional(v.array(vCreateChunkArgs)),
  },
  returns: v.object({
    documentId: v.id("documents"),
    chunkIds: v.union(v.array(v.id("chunks")), v.null()),
  }),
  handler: async (ctx, args) => {
    const { namespaceId, key } = args.document;
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
    if (existing && existing.status.kind === "pending") {
      console.warn(
        `Existing document ${key} version ${existing.version} is still pending. Skipping...`
      );
    } else if (existing && existing.status.kind === "ready") {
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
      ...args.document,
      version,
      status: args.allChunks
        ? { kind: "ready" }
        : { kind: "pending", onComplete: args.onComplete },
    });
    if (args.allChunks) {
      const chunkIds = await insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks: args.allChunks,
      });
      return { documentId, chunkIds };
    }
    return { documentId, chunkIds: null };
  },
});

async function enqueueOnComplete(ctx: MutationCtx, onComplete: string) {
  throw new Error("Not implemented");
}

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
