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
  Document,
  DocumentId,
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
import { getText } from "./getText";

type DocumentFilterValues = {
  documentKey: string;
  documentMimeType: string;
  category: string;
};

const documentSearch = new DocumentSearch<DocumentFilterValues>(
  components.documentSearch,
  {
    filterNames: ["documentKey", "documentMimeType", "category"],
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
    embeddingDimension: 1536,
  }
);

export const upsertFile = action({
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
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const text = await getText(ctx, { storageId, mimeType, filename, bytes });
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
    });
    const chunks = await textSplitter.splitText(text);
    const { documentId, created, replacedVersion } =
      await documentSearch.upsertDocument(ctx, {
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
    if (created) {
      await ctx.runMutation(internal.example.recordUploadMetadata, {
        global: args.globalNamespace,
        filename,
        storageId,
        documentId,
        category,
        uploadedBy: userId,
        previousDocumentId: replacedVersion?.documentId,
      });
    } else {
      console.debug("document already exists, skipping upload metadata");
      await ctx.storage.delete(storageId);
    }
    return {
      url: (await ctx.storage.getUrl(storageId))!,
      documentId,
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
    const results = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
    });
    return {
      ...results,
      documents: await Promise.all(
        results.documents.map((doc) =>
          publicDocument(ctx, doc, args.globalNamespace)
        )
      ),
    };
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
      filters: [{ name: "documentKey", value: args.filename }],
      limit: 10,
    });
    return {
      ...results,
      documents: await Promise.all(
        results.documents.map((doc) =>
          publicDocument(ctx, doc, args.globalNamespace)
        )
      ),
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
    const results = await documentSearch.search(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
      query: args.query,
      limit: 10,
      filters: [{ name: "category", value: args.category }],
    });
    return {
      ...results,
      documents: await Promise.all(
        results.documents.map((doc) =>
          publicDocument(ctx, doc, args.globalNamespace)
        )
      ),
    };
  },
});

/**
 * Uploading asynchronously
 */
export const chunkerAction = documentSearch.defineChunkerAction(async () => {
  const chunks: InputChunk[] = [];
  // TODO: do async chunking
  return { chunks };
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
    const namespace = await documentSearch.getNamespace(ctx, {
      namespace: args.globalNamespace ? "global" : userId,
    });
    if (!namespace) {
      return {
        page: [],
        isDone: true,
        cursor: null,
      };
    }
    const results = await documentSearch.listDocuments(ctx, {
      namespaceId: namespace.namespaceId,
      paginationOpts: args.paginationOpts,
    });
    return {
      ...results,
      page: await Promise.all(
        results.page.map(async (file) =>
          publicDocument(ctx, file, args.globalNamespace)
        )
      ),
    };
  },
});

export type PublicFile = {
  documentId: DocumentId;
  filename: string;
  global: boolean;
  category: string;
  title: string | undefined;
  isImage: boolean;
  url: string | null;
};

async function publicDocument(
  ctx: QueryCtx | ActionCtx,
  doc: Document<DocumentFilterValues>,
  global: boolean
): Promise<PublicFile> {
  return {
    documentId: doc.documentId,
    filename: doc.key,
    global,
    category: doc.filterValues.find((f) => f.name === "category")!.value,
    title: doc.title,
    isImage:
      doc.source.kind === "_storage"
        ? await ctx.storage
            .getMetadata(doc.source.storageId)
            .then((m) => !!m?.contentType?.startsWith("image/"))
        : false,
    url:
      doc.source.kind === "_storage"
        ? await ctx.storage.getUrl(doc.source.storageId)
        : doc.source.url,
  };
}

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

/**
 * Document metadata handling
 */

// You can track other file metadata in your own tables.
export const recordUploadMetadata = internalMutation({
  args: {
    ...schema.tables.fileMetadata.validator.fields,
    previousDocumentId: v.optional(vDocumentId),
  },
  handler: async (ctx, args) => {
    const { previousDocumentId, ...doc } = args;
    if (previousDocumentId) {
      console.debug("deleting previous document", previousDocumentId);
      const previous = await ctx.db
        .query("fileMetadata")
        .withIndex("documentId", (q) => q.eq("documentId", previousDocumentId))
        .first();
      if (previous) {
        await ctx.db.delete(previous._id);
        await deleteFile(ctx, previousDocumentId);
      }
    }
    const existing = await ctx.db
      .query("fileMetadata")
      .withIndex("documentId", (q) => q.eq("documentId", doc.documentId))
      .unique();
    if (existing) {
      console.debug("replacing file", existing._id, doc);
      await ctx.db.replace(existing._id, doc);
    } else {
      console.debug("inserting file", doc);
      await ctx.db.insert("fileMetadata", doc);
    }
  },
});

export const deleteDocument = mutation({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    await deleteFile(ctx, args.documentId);
  },
});

async function deleteFile(ctx: MutationCtx, documentId: DocumentId) {
  const file = await ctx.db
    .query("fileMetadata")
    .withIndex("documentId", (q) => q.eq("documentId", documentId))
    .unique();
  if (file) {
    await ctx.db.delete(file._id);
    await ctx.storage.delete(file.storageId);
    await documentSearch.deleteDocument(ctx, { documentId });
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
