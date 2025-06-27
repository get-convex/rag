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
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  InputChunk,
  vDocumentId,
} from "@convex-dev/document-search";
import { openai } from "@ai-sdk/openai";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import schema from "./schema";
import { generateText, experimental_transcribe as transcribe } from "ai";
import { assert } from "convex-helpers";
import { Id } from "./_generated/dataModel";

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

const describeImage = openai.chat("o4-mini");
const describeAudio = openai.transcription("whisper-1");
const describePdf = openai.chat("gpt-4.1");

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
    const { globalNamespace, bytes, filename, category } = args;

    const mimeType =
      args.mimeType ||
      guessMimeTypeFromExtension(filename) ||
      guessMimeTypeFromContents(bytes);
    console.debug(
      "mimeType",
      mimeType,
      args.mimeType,
      guessMimeTypeFromExtension(filename),
      guessMimeTypeFromContents(bytes)
    );
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const text = await getText(ctx, { storageId, mimeType, filename, bytes });
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100,
    });
    const chunks = await textSplitter.splitText(text);
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

    const file = await ctx.db
      .query("files")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .first();
    if (file) {
      await ctx.db.delete(file._id);
    }
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

async function getText(
  ctx: ActionCtx,
  {
    storageId,
    mimeType,
    filename,
    bytes,
  }: {
    storageId: Id<"_storage">;
    mimeType: string;
    filename: string;
    bytes: ArrayBuffer;
  }
) {
  const url = await ctx.storage.getUrl(storageId);
  assert(url);
  if (mimeType.startsWith("image/")) {
    const imageResult = await generateText({
      model: describeImage,
      system:
        "You turn images into text. If it is a photo of a document, transcribe it. If it is not a document, describe it.",
      messages: [
        {
          role: "user",
          content: [{ type: "image", image: new URL(url) }],
        },
      ],
    });
    return imageResult.text;
  } else if (mimeType.startsWith("audio/")) {
    const audioResult = await transcribe({
      model: describeAudio,
      audio: new URL(url),
    });
    return audioResult.text;
  } else if (mimeType.toLowerCase().includes("pdf")) {
    const pdfResult = await generateText({
      model: describePdf,
      system: "You transform PDF files into text.",
      messages: [
        {
          role: "user",
          content: [{ type: "file", data: new URL(url), mimeType, filename }],
        },
      ],
    });
    return pdfResult.text;
  } else if (mimeType.toLowerCase().includes("text")) {
    return new TextDecoder().decode(bytes);
  } else {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
}

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
