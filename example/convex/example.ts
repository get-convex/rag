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
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import schema from "./schema";

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
    const { globalNamespace, bytes, mimeType, filename, category } = args;

    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100,
    });
    const chunks = await textSplitter.splitText(
      new TextDecoder().decode(bytes)
    );
    const { documentId } = await documentSearch.upsertDocument(ctx, {
      namespace: globalNamespace ? "global" : userId,
      chunks,
      key: filename,
      title: filename,
      source: { kind: "_storage", storageId },
      filterValues: [
        { name: "documentKey", value: filename },
        { name: "documentMimeType", value: mimeType },
        { name: "category", value: category },
      ],
    });
    await ctx.runMutation(internal.example.recordUploadMetadata, {
      global: args.globalNamespace,
      filename,
      storageId,
      documentId,
      category,
      uploadedBy: userId,
    });
    return {
      url: (await ctx.storage.getUrl(storageId))!,
      documentId,
    };
  },
});

// You can track other file metadata in your own tables.
export const recordUploadMetadata = internalMutation({
  args: schema.tables.files.validator,
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
    const results = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
    });
    return results;
  },
});

export const searchDocument = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const results = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      chunkContext: { before: 1, after: 1 },
      limit: 10,
    });
    return results;
  },
});

export const searchCategory = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const results = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
      filters: [
        {
          name: "category",
          value: args.category,
        },
      ],
    });
    return results;
  },
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
