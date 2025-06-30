import { openai } from "@ai-sdk/openai";
import {
  contentHashFromArrayBuffer,
  Entry,
  EntryId,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  Memory,
  vEntryId,
} from "@convex-dev/memory";
import { assert } from "convex-helpers";
import {
  paginationOptsValidator,
  PaginationResult,
  StorageReader,
} from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { DataModel, Id } from "./_generated/dataModel";
import {
  action,
  ActionCtx,
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
    const text = await getText(ctx, { storageId, filename, bytes, mimeType });
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
      contentHash: await contentHashFromArrayBuffer(bytes), // To avoid re-inserting if the file contents haven't changed.
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

// Called from the /upload http endpoint.
export async function addFileAsync(
  ctx: ActionCtx,
  args: {
    globalNamespace: boolean;
    filename: string;
    blob: Blob;
    category: string | null;
  }
) {
  const userId = await getUserId(ctx);
  // Maybe rate limit how often a user can upload a file / attribute?
  if (!userId) throw new Error("Unauthorized");
  const { globalNamespace, blob, filename, category } = args;

  const namespace = globalNamespace ? "global" : userId;
  const bytes = await blob.arrayBuffer();
  const existing = await memory.findExistingEntryByContentHash(ctx, {
    contentHash: await contentHashFromArrayBuffer(bytes),
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
  const storageId = await ctx.storage.store(
    new Blob([bytes], { type: blob.type })
  );
  const { entryId } = await memory.addAsync(ctx, {
    namespace,
    key: filename,
    title: filename,
    filterValues: [
      { name: "filename", value: filename },
      { name: "category", value: category ?? null },
    ],
    metadata: { storageId, uploadedBy: userId },
    chunkerAction: internal.example.chunkerAction,
    onComplete: internal.example.recordUploadMetadata,
  });
  return {
    url: (await ctx.storage.getUrl(storageId))!,
    entryId,
  };
}

export const chunkerAction = memory.defineChunkerAction(async (ctx, args) => {
  assert(args.entry.metadata, "Entry metadata not found");
  const storageId = args.entry.metadata.storageId;
  const metadata = await ctx.storage.getMetadata(storageId);
  assert(metadata, "Metadata not found");
  const text = await getText(ctx, {
    storageId,
    filename: args.entry.title!,
    mimeType: metadata.contentType!,
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
      page: await Promise.all(
        results.page.map((entry) => toFile(ctx, entry, args.globalNamespace))
      ),
    };
  },
});

export const listPendingFiles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const globalNamespace = await memory.getNamespace(ctx, {
      namespace: "global",
    });
    const userNamespace = await memory.getNamespace(ctx, { namespace: userId });
    const paginationOpts = { numItems: 10, cursor: null };
    const globalResults =
      globalNamespace &&
      (await memory.list(ctx, {
        namespaceId: globalNamespace.namespaceId,
        status: "pending",
        paginationOpts,
      }));
    const userResults =
      userNamespace &&
      (await memory.list(ctx, {
        namespaceId: userNamespace.namespaceId,
        status: "pending",
        paginationOpts,
      }));

    const globalFiles =
      globalResults?.page.map((entry) => toFile(ctx, entry, true)) ?? [];
    const userFiles =
      userResults?.page.map((entry) => toFile(ctx, entry, false)) ?? [];

    const allFiles = await Promise.all([...globalFiles, ...userFiles]);
    return allFiles.filter((file) => file !== null);
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
  files: (Entry & { text: string })[]
): Promise<PublicFile[]> {
  return await Promise.all(files.map((entry) => toFile(ctx, entry, false)));
}

async function toFile(
  ctx: { storage: StorageReader },
  entry: Entry,
  global: boolean
): Promise<PublicFile> {
  assert(entry.metadata, "Entry metadata not found");
  const storageId = entry.metadata.storageId;
  const storageMetadata = await ctx.storage.getMetadata(storageId);
  assert(storageMetadata, "Storage metadata not found");
  return {
    entryId: entry.entryId,
    filename: entry.key!,
    storageId,
    global,
    category:
      entry.filterValues.find((f) => f.name === "category")?.value ?? undefined,
    title: entry.title,
    isImage: storageMetadata.contentType?.startsWith("image/") ?? false,
    url: await ctx.storage.getUrl(storageId),
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
    const { previousEntry, entry, success, namespace, error } = args;
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
    } else if (success) {
      console.debug("inserting file", entry);
      await ctx.db.insert("fileMetadata", metadata);
    } else if (error) {
      console.debug("adding file failed", entry, error);
      await memory.delete(ctx, { entryId: entry.entryId });
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
