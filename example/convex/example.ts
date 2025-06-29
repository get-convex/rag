import {
  internalMutation,
  query,
  mutation,
  action,
  QueryCtx,
  MutationCtx,
  ActionCtx,
  internalQuery,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import {
  Entry,
  EntryId,
  Memory,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  InputChunk,
  vEntry,
  vEntryId,
} from "@convex-dev/memory";
import { openai } from "@ai-sdk/openai";
import { v } from "convex/values";
import { paginationOptsValidator, PaginationResult } from "convex/server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import schema from "./schema";
import { getText } from "./getText";

type Filters = {
  filename: string;
  category: string | null;
};

const memory = new Memory<Filters>(components.memory, {
  filterNames: ["filename", "category"],
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

export const addFile = action({
  args: {
    globalNamespace: v.boolean(),
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
    category: v.optional(v.string()),
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
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const text = await getText(ctx, { storageId, mimeType, filename, bytes });
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
    });
    const chunks = await textSplitter.splitText(text);
    const { entryId, created, replacedVersion } = await memory.add(ctx, {
      namespace: globalNamespace ? "global" : userId,
      chunks,
      key: filename,
      title: filename,
      filterValues: [
        { name: "filename", value: filename },
        { name: "category", value: category ?? null },
      ],
    });
    if (created) {
      await ctx.runMutation(internal.example.recordUploadMetadata, {
        global: args.globalNamespace,
        filename,
        storageId,
        entryId,
        category,
        uploadedBy: userId,
        previousId: replacedVersion?.entryId,
      });
    } else {
      console.debug("entry already exists, skipping upload metadata");
      await ctx.storage.delete(storageId);
    }
    return {
      url: (await ctx.storage.getUrl(storageId))!,
      entryId,
    };
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
    const results = await memory.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
    });
    return {
      ...results,
      files: await toFiles(ctx, results.entries),
    };
  },
});

export const searchFile = action({
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
    const results = await memory.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      chunkContext: { before: 1, after: 1 },
      filters: [{ name: "filename", value: args.filename }],
      limit: 10,
    });
    return {
      ...results,
      files: await toFiles(ctx, results.entries),
    };
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
    const results = await memory.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
      filters: [{ name: "category", value: args.category }],
    });
    return {
      ...results,
      files: await toFiles(ctx, results.entries),
    };
  },
});

/**
 * Uploading asynchronously
 */
export const chunkerAction = memory.defineChunkerAction(async () => {
  const chunks: InputChunk[] = [];
  // TODO: do async chunking
  return { chunks };
});

export const listFiles = query({
  args: {
    globalNamespace: v.boolean(),
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<PaginationResult<PublicFile>> => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const namespace = await memory.getNamespace(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
    });
    if (!namespace) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const results = await memory.list(ctx, {
      namespaceId: namespace.namespaceId,
      paginationOpts: args.paginationOpts,
    });
    return {
      ...results,
      page: await Promise.all(
        results.page.map((entry) => toFile(ctx, entry, args.globalNamespace))
      ),
    };
  },
});

export type PublicFile = {
  entryId: EntryId;
  filename: string;
  global: boolean;
  category: string | undefined;
  title: string | undefined;
  isImage: boolean;
  url: string | null;
};

async function toFiles(ctx: ActionCtx, files: Entry[]): Promise<PublicFile[]> {
  return await ctx.runQuery(internal.example.getFiles, { files });
}

export const getFiles = internalQuery({
  args: { files: v.array(vEntry) },
  handler: async (ctx, { files }) => {
    return Promise.all(files.map((entry) => toFile(ctx, entry, false)));
  },
});

async function toFile(
  ctx: QueryCtx,
  entry: Entry,
  global: boolean
): Promise<PublicFile> {
  const fileMetadata = await ctx.db
    .query("fileMetadata")
    .withIndex("entryId", (q) => q.eq("entryId", entry.entryId))
    .unique();
  const storageMetadata =
    fileMetadata && (await ctx.db.system.get(fileMetadata.storageId));
  return {
    entryId: entry.entryId,
    filename: entry.key,
    global,
    category: fileMetadata?.category ?? undefined,
    title: entry.title,
    isImage: storageMetadata?.contentType?.startsWith("image/") ?? false,
    url: fileMetadata?.storageId
      ? await ctx.storage.getUrl(fileMetadata.storageId)
      : null,
  };
}

export const listChunks = query({
  args: {
    entryId: vEntryId,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const paginatedChunks = await memory.listChunks(ctx, {
      entryId: args.entryId,
      paginationOpts: args.paginationOpts,
    });
    return paginatedChunks;
  },
});

/**
 * Entry metadata handling
 */

// You can track other file metadata in your own tables.
export const recordUploadMetadata = internalMutation({
  args: {
    ...schema.tables.fileMetadata.validator.fields,
    previousId: v.optional(vEntryId),
  },
  handler: async (ctx, args) => {
    const { previousId, ...entry } = args;
    if (previousId) {
      console.debug("deleting previous entry", previousId);
      await _deleteFile(ctx, previousId);
    }
    const existing = await ctx.db
      .query("fileMetadata")
      .withIndex("entryId", (q) => q.eq("entryId", entry.entryId))
      .unique();
    if (existing) {
      console.debug("replacing file", existing._id, entry);
      await ctx.db.replace(existing._id, entry);
    } else {
      console.debug("inserting file", entry);
      await ctx.db.insert("fileMetadata", entry);
    }
  },
});

export const deleteFile = mutation({
  args: { entryId: vEntryId },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    await _deleteFile(ctx, args.entryId);
  },
});

async function _deleteFile(ctx: MutationCtx, entryId: EntryId) {
  const file = await ctx.db
    .query("fileMetadata")
    .withIndex("entryId", (q) => q.eq("entryId", entryId))
    .unique();
  if (file) {
    await ctx.db.delete(file._id);
    await ctx.storage.delete(file.storageId);
    await memory.delete(ctx, { entryId });
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
