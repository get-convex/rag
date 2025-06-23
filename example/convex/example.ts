import {
  internalMutation,
  query,
  mutation,
  action,
  QueryCtx,
  MutationCtx,
  ActionCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import {
  DocumentSearch,
  InputChunk,
  vDocumentId,
} from "@convex-dev/document-search";
import { openai } from "@ai-sdk/openai";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

const documentSearch = new DocumentSearch(components.documentSearch, {
  filterNames: ["documentKey", "documentMimeType", "category"],
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

export const chunkerAction = documentSearch.defineChunkerAction(
  async (ctx, args) => {
    const chunks: InputChunk[] = [];
    return { chunks };
  }
);

export const uploadFile = action({
  args: {
    globalNamespace: v.boolean(),
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    // Maybe rate limit how often a user can upload a file / attribute?
    if (!userId) throw new Error("Unauthorized");
    const { bytes, mimeType, filename, category } = args;

    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const documentId = await documentSearch.upsertDocumentAsync(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      key: args.filename,
      source: { storageId },
      filterValues: [
        { name: "documentKey", value: args.filename },
        { name: "documentMimeType", value: args.mimeType },
        { name: "category", value: args.category },
      ],
      chunkerAction: internal.example.chunkerAction,
    });
    // await ctx.runMutation(internal.example.recordUploadMetadata, {
    //   filename,
    //   storageId,
    //   documentId,
    //   mimeType,
    //   category,
    //   uploadedBy: userId,
    // });
    return {
      url: (await ctx.storage.getUrl(storageId))!,
      documentId,
    };
  },
});

// You can track other file metadata in your own tables.
export const recordUploadMetadata = internalMutation({
  args: {
    filename: v.string(),
    storageId: v.id("_storage"),
    documentId: vDocumentId,
    mimeType: v.string(),
    category: v.string(),
    uploadedBy: v.string(),
    global: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("files", args);
  },
});

export const listDocuments = query({
  args: {
    globalNamespace: v.boolean(),
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    return ctx.db
      .query("files")
      .withIndex("global_category", (q) =>
        args.category === undefined
          ? q.eq("global", args.globalNamespace)
          : q.eq("global", args.globalNamespace).eq("category", args.category)
      )
      .paginate(args.paginationOpts);
  },
});

export const listChunks = query({
  args: {
    documentId: vDocumentId,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const paginatedChunks = await documentSearch.listChunks(ctx, {
      documentId: args.documentId,
      paginationOpts: args.paginationOpts,
    });
    return paginatedChunks;
  },
});

export const deleteDocument = mutation({
  args: {
    documentId: vDocumentId,
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    await documentSearch.deleteDocument(ctx, {
      documentId: args.documentId,
    });
  },
});

export const search = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const paginatedDocuments = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
    });
    return paginatedDocuments;
  },
});

export const searchDocument = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {},
});

export const searchCategory = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    category: v.string(),
  },
  handler: async (ctx, args) => {},
});

/**
 * ==============================
 * Functions for demo purposes.
 * In a real app, you'd use real authentication & authorization.
 * ==============================
 */

async function getUserId(_ctx: QueryCtx | MutationCtx | ActionCtx) {
  // For demo purposes. You'd use real auth here.
  return "test user";
}
