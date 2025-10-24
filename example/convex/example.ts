import { openai } from "@ai-sdk/openai";
import {
  contentHashFromArrayBuffer,
  defaultChunker,
  Entry,
  EntryId,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  RAG,
  SearchEntry,
  vEntryId,
} from "@convex-dev/rag";
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
  internalMutation,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { getText } from "./getText";

export type Filters = { filename: string; category: string | null };

type Metadata = { storageId: Id<"_storage">; uploadedBy: string };

const rag = new RAG<Filters, Metadata>(components.rag, {
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
    const { entryId, created } = await rag.add(ctx, {
      // What search space to add this to. You cannot search across namespaces.
      namespace: globalNamespace ? "global" : userId,
      // The text to embed. If you want to control chunking, pass `chunks` instead.
      text,
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
    return { url: (await ctx.storage.getUrl(storageId))!, entryId };
  },
});

export const search = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    limit: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const results = await rag.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: args.limit ?? 10,
      chunkContext: args.chunkContext,
    });
    return { ...results, files: await toFiles(ctx, results.entries) };
  },
});

export const searchFile = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    filename: v.string(),
    limit: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const results = await rag.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      chunkContext: args.chunkContext ?? { before: 1, after: 1 },
      filters: [{ name: "filename", value: args.filename }],
      limit: args.limit ?? 10,
    });
    return { ...results, files: await toFiles(ctx, results.entries) };
  },
});

export const searchCategory = action({
  args: {
    query: v.string(),
    globalNamespace: v.boolean(),
    category: v.string(),
    limit: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const results = await rag.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: args.limit ?? 10,
      filters: [{ name: "category", value: args.category }],
      chunkContext: args.chunkContext,
    });
    return { ...results, files: await toFiles(ctx, results.entries) };
  },
});

export const askQuestion = action({
  args: {
    prompt: v.string(),
    globalNamespace: v.boolean(),
    filter: v.optional(
      v.union(
        v.object({
          name: v.literal("category"),
          value: v.union(v.null(), v.string()),
        }),
        v.object({ name: v.literal("filename"), value: v.string() })
      )
    ),
    limit: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({ before: v.number(), after: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const { text, context } = await rag.generateText(ctx, {
      search: {
        namespace: args.globalNamespace ? "global" : userId,
        filters: args.filter ? [args.filter] : [],
        limit: args.limit ?? 10,
        chunkContext: args.chunkContext ?? { before: 1, after: 1 },
      },
      prompt: args.prompt,
      model: openai.chat("gpt-4o-mini"),
    });
    return {
      answer: text,
      ...context,
      files: await toFiles(ctx, context.entries),
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
  const existing = await rag.findEntryByContentHash(ctx, {
    contentHash: await contentHashFromArrayBuffer(bytes),
    key: filename,
    namespace,
  });
  if (existing) {
    console.debug("entry already exists, skipping async add");
    return { entryId: existing.entryId };
  }
  // If it doesn't exist, we need to store the file and chunk it asynchronously.
  const storageId = await ctx.storage.store(
    new Blob([bytes], { type: blob.type })
  );
  const { entryId } = await rag.addAsync(ctx, {
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
  return { url: (await ctx.storage.getUrl(storageId))!, entryId };
}

export const chunkerAction = rag.defineChunkerAction(async (ctx, args) => {
  assert(args.entry.metadata, "Entry metadata not found");
  const storageId = args.entry.metadata.storageId;
  const metadata = await ctx.storage.getMetadata(storageId);
  assert(metadata, "Metadata not found");
  const text = await getText(ctx, {
    storageId,
    filename: args.entry.title!,
    mimeType: metadata.contentType!,
  });
  return { chunks: defaultChunker(text) };
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
    const namespace = await rag.getNamespace(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
    });
    if (!namespace) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const results = await rag.list(ctx, {
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
    const globalNamespace = await rag.getNamespace(ctx, {
      namespace: "global",
    });
    const userNamespace = await rag.getNamespace(ctx, { namespace: userId });
    const paginationOpts = { numItems: 10, cursor: null };
    const globalResults =
      globalNamespace &&
      (await rag.list(ctx, {
        namespaceId: globalNamespace.namespaceId,
        status: "pending",
        paginationOpts,
      }));
    const userResults =
      userNamespace &&
      (await rag.list(ctx, {
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
  files: SearchEntry<Filters, Metadata>[]
): Promise<PublicFile[]> {
  return await Promise.all(files.map((entry) => toFile(ctx, entry, false)));
}

async function toFile(
  ctx: { storage: StorageReader },
  entry: Entry<Filters, Metadata>,
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
    order: v.union(v.literal("desc"), v.literal("asc")),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const paginatedChunks = await rag.listChunks(ctx, {
      entryId: args.entryId,
      paginationOpts: args.paginationOpts,
      order: args.order,
    });
    return paginatedChunks;
  },
});

/**
 * Entry metadata handling
 */

// You can track other file metadata in your own tables.
export const recordUploadMetadata = rag.defineOnComplete<DataModel>(
  async (ctx, args) => {
    const { replacedEntry, entry, namespace, error } = args;
    if (replacedEntry) {
      console.debug("deleting previous entry", replacedEntry.entryId);
      await _deleteFile(ctx, replacedEntry.entryId);
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
    } else if (entry.status === "ready") {
      console.debug("inserting file", entry);
      await ctx.db.insert("fileMetadata", metadata);
    } else if (error) {
      console.debug("adding file failed", entry, error);
      await rag.deleteAsync(ctx, { entryId: entry.entryId });
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
    await rag.delete(ctx, { entryId });
  }
}

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;

export const deleteOldContent = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const toDelete = await rag.list(ctx, {
      status: "replaced",
      paginationOpts: { cursor: args.cursor ?? null, numItems: 100 },
    });

    for (const entry of toDelete.page) {
      assert(entry.status === "replaced");
      if (entry.replacedAt >= Date.now() - WEEK) {
        return; // we're done when we catch up to a week ago
      }
      await rag.delete(ctx, { entryId: entry.entryId });
    }
    if (!toDelete.isDone) {
      await ctx.scheduler.runAfter(0, internal.example.deleteOldContent, {
        cursor: toDelete.continueCursor,
      });
    }
  },
});

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
