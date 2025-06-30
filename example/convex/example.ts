import { openai } from "@ai-sdk/openai";
import {
  contentHashFromBlob,
  Entry,
  EntryId,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  Memory,
  vEntry,
  vEntryId,
} from "@convex-dev/memory";
import { assert } from "convex-helpers";
import { paginationOptsValidator, PaginationResult } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { DataModel, Id } from "./_generated/dataModel";
import {
  action,
  ActionCtx,
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { getText } from "./getText";

type Filters = {
  filename: string;
  category: string | null;
};

type Metadata = {
  storageId: Id<"_storage">;
  uploadedBy: string;
};

const memory = new Memory<Filters, Metadata>(components.memory, {
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

    const mimeType = args.mimeType || guessMimeType(filename, bytes);
    const blob = new Blob([bytes], { type: mimeType });
    const storageId = await ctx.storage.store(blob);
    const text = await getText(ctx, { storageId, filename, blob });
    const { entryId, created } = await memory.add(ctx, {
      // What search space to add this to. You cannot search across namespaces.
      namespace: globalNamespace ? "global" : userId,
      // The parts of the entry to semantically search across.
      chunks: text.split("\n\n"),
      /** The following fields are optional: */
      key: filename, // will replace any existing entry with the same key & namespace.
      title: filename, // A readable title for the entry.
      // Filters available for search.
      filterValues: [
        { name: "filename", value: filename },
        { name: "category", value: category ?? null },
      ],
      metadata: { storageId, uploadedBy: userId }, // Any other metadata here that isn't used for filtering.
      contentHash: await contentHashFromBlob(blob), // To avoid re-inserting if the file contents haven't changed.
      onComplete: internal.example.recordUploadMetadata, // Called when the entry is ready (transactionally safe with listing).
    });
    if (!created) {
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

export const addFileAsync = action({
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

    const mimeType = args.mimeType || guessMimeType(filename, bytes);
    const blob = new Blob([bytes], { type: mimeType });
    const contentHash = await contentHashFromBlob(blob);
    const namespace = globalNamespace ? "global" : userId;
    const existing = await memory.findExistingEntryByContentHash(ctx, {
      contentHash,
      key: filename,
      namespace,
    });
    if (existing) {
      console.debug("entry already exists, skipping async add");
      return {
        entryId: existing.entryId,
      };
    }
    // If it doesn't exist, we need to store the file and chunk it asynchronously.
    const storageId = await ctx.storage.store(blob);
    const { entryId } = await memory.addAsync(ctx, {
      namespace,
      key: filename,
      title: filename,
      metadata: { storageId, uploadedBy: userId },
      filterValues: [
        { name: "filename", value: filename },
        { name: "category", value: category ?? null },
      ],
      chunkerAction: internal.example.chunkerAction,
      onComplete: internal.example.recordUploadMetadata,
    });
    return {
      url: (await ctx.storage.getUrl(storageId))!,
      entryId,
    };
  },
});

export const chunkerAction = memory.defineChunkerAction(async (ctx, args) => {
  const [fileMetadata] = await ctx.runQuery(internal.example.getFiles, {
    files: [args.entry],
  });
  assert(fileMetadata, "File metadata not found");
  const blob = await ctx.storage.get(fileMetadata.storageId);
  assert(blob, "File not found");
  const text = await getText(ctx, {
    storageId: fileMetadata.storageId,
    filename: fileMetadata.filename,
    blob,
  });
  return { chunks: text.split("\n\n") };
});

/**
 * File reading
 */

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
      page: (
        await Promise.all(
          results.page.map((entry) => toFile(ctx, entry, args.globalNamespace))
        )
      ).filter((file) => file !== null),
    };
  },
});

export type PublicFile = {
  entryId: EntryId;
  filename: string;
  storageId: Id<"_storage">;
  global: boolean;
  category: string | undefined;
  title: string | undefined;
  isImage: boolean;
  url: string | null;
};

async function toFiles(
  ctx: ActionCtx,
  filesWithText: (Entry & { text: string })[]
): Promise<PublicFile[]> {
  const files = filesWithText.map(({ text: _, ...entry }) => entry);
  return await ctx.runQuery(internal.example.getFiles, { files });
}

export const getFiles = internalQuery({
  args: { files: v.array(vEntry) },
  handler: async (ctx, { files }) => {
    return (
      await Promise.all(files.map((entry) => toFile(ctx, entry, false)))
    ).filter((file) => file !== null);
  },
});

async function toFile(
  ctx: QueryCtx,
  entry: Entry,
  global: boolean
): Promise<PublicFile | null> {
  // Note: Illustrative only, we technically could get all this info from the entry metadata.
  const fileMetadata = await ctx.db
    .query("fileMetadata")
    .withIndex("entryId", (q) => q.eq("entryId", entry.entryId))
    .unique();
  assert(fileMetadata, "File metadata not found");
  const storageMetadata =
    fileMetadata && (await ctx.db.system.get(fileMetadata.storageId));
  if (!storageMetadata) {
    return null;
  }
  return {
    entryId: entry.entryId,
    filename: entry.key!,
    storageId: fileMetadata.storageId,
    global,
    category: fileMetadata.category ?? undefined,
    title: entry.title,
    isImage: storageMetadata.contentType?.startsWith("image/") ?? false,
    url: await ctx.storage.getUrl(fileMetadata.storageId),
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
export const recordUploadMetadata = memory.defineOnComplete<DataModel>(
  async (ctx, args) => {
    const { previousEntry, entry, success, namespace } = args;
    if (previousEntry && success) {
      console.debug("deleting previous entry", previousEntry.entryId);
      await _deleteFile(ctx, previousEntry.entryId);
    }
    const metadata = {
      entryId: entry.entryId,
      filename: entry.key!,
      storageId: entry.metadata!.storageId,
      global: namespace.namespace === "global",
      uploadedBy: entry.metadata!.uploadedBy,
      category:
        entry.filterValues.find((f) => f.name === "category")?.value ??
        undefined,
    };
    const existing = await ctx.db
      .query("fileMetadata")
      .withIndex("entryId", (q) => q.eq("entryId", entry.entryId))
      .unique();
    if (existing) {
      console.debug("replacing file", existing._id, entry);
      await ctx.db.replace(existing._id, metadata);
    } else {
      console.debug("inserting file", entry);
      await ctx.db.insert("fileMetadata", metadata);
    }
  }
);

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

function guessMimeType(filename: string, bytes: ArrayBuffer) {
  return (
    guessMimeTypeFromExtension(filename) || guessMimeTypeFromContents(bytes)
  );
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
