import { assert, omit } from "convex-helpers";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { DocumentId } from "../shared.js";
import {
  statuses,
  vCreateChunkArgs,
  vDocument,
  vPaginationResult,
  vStatus,
  type Document,
} from "../shared.js";
import { api } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx } from "./_generated/server.js";
import { deleteChunksPage, insertChunks } from "./chunks.js";
import schema, { type StatusWithOnComplete } from "./schema.js";
import { mergedStream } from "convex-helpers/server/stream";
import { stream } from "convex-helpers/server/stream";
import {
  getCompatibleNamespaceHandler,
  vNamespaceLookupArgs,
} from "./namespaces.js";

export const addAsync = mutation({
  args: {
    document: v.object({
      ...omit(schema.tables.documents.validator.fields, ["version", "status"]),
    }),
    onComplete: v.optional(v.string()),
    chunker: v.string(),
  },
  returns: v.object({
    documentId: v.id("documents"),
    status: vStatus,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { namespaceId, key } = args.document;
    const namespace = await ctx.db.get(namespaceId);
    assert(namespace, `Namespace ${namespaceId} not found`);
    // iterate through the latest versions of the document
    const existing = await findExistingDocument(ctx, namespaceId, key);
    if (
      existing?.status.kind === "ready" &&
      documentIsSame(existing, args.document)
    ) {
      if (args.onComplete) {
        await enqueueOnComplete(ctx, args.onComplete, existing._id);
      }
      return {
        documentId: existing._id,
        status: existing.status.kind,
        created: false,
      };
    }
    const version = existing ? existing.version + 1 : 0;
    const status: StatusWithOnComplete = {
      kind: "pending",
      onComplete: args.onComplete,
    };
    const documentId = await ctx.db.insert("documents", {
      ...args.document,
      version,
      status,
    });
    await enqueueAdd(ctx, {
      documentId,
      chunker: args.chunker,
    });
    return { documentId, status: status.kind, created: true };
  },
});

async function enqueueAdd(
  _ctx: MutationCtx,
  _args: {
    documentId: Id<"documents">;
    chunker: string;
  }
) {
  // TODO: enqueue into workpool
}

type AddDocumentArgs = Pick<
  Doc<"documents">,
  "key" | "contentHash" | "importance" | "filterValues"
>;

async function findExistingDocument(
  ctx: MutationCtx,
  namespaceId: Id<"namespaces">,
  key: string
) {
  const existing = await mergedStream(
    statuses.map((status) =>
      stream(ctx.db, schema)
        .query("documents")
        .withIndex("namespaceId_status_key_version", (q) =>
          q
            .eq("namespaceId", namespaceId)
            .eq("status.kind", status)
            .eq("key", key)
        )
        .order("desc")
    ),
    ["version"]
  ).first();
  return existing;
}

export const add = mutation({
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
    status: vStatus,
    created: v.boolean(),
    replacedVersion: v.union(vDocument, v.null()),
  }),
  handler: async (ctx, args) => {
    const { namespaceId, key } = args.document;
    const namespace = await ctx.db.get(namespaceId);
    assert(namespace, `Namespace ${namespaceId} not found`);
    // iterate through the latest versions of the document
    const existing = await findExistingDocument(ctx, namespaceId, key);
    if (
      existing?.status.kind === "ready" &&
      documentIsSame(existing, args.document)
    ) {
      if (args.onComplete) {
        await enqueueOnComplete(ctx, args.onComplete, existing._id);
      }
      return {
        documentId: existing._id,
        status: existing.status.kind,
        created: false,
        replacedVersion: null,
      };
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
      await insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks: args.allChunks,
      });
      const { replacedVersion } = await promoteToReadyHandler(ctx, {
        documentId,
      });
      return {
        documentId,
        status: "ready" as const,
        created: true,
        replacedVersion,
      };
    }
    return {
      documentId,
      status: "pending" as const,
      created: true,
      replacedVersion: null,
    };
  },
});

async function enqueueOnComplete(
  _ctx: MutationCtx,
  _onComplete: string,
  _documentId: Id<"documents">
) {
  throw new Error("Not implemented");
}

function documentIsSame(
  existing: Doc<"documents">,
  newDocument: AddDocumentArgs
) {
  if (!existing.contentHash || !newDocument.contentHash) {
    console.debug(
      `Document ${newDocument.key} has no content hash, replacing...`
    );
    return false;
  }
  if (existing.contentHash !== newDocument.contentHash) {
    console.debug(
      `Document ${newDocument.key} content hash is different, replacing...`
    );
    return false;
  }
  if (existing.importance !== newDocument.importance) {
    console.debug(
      `Document ${newDocument.key} importance is different, replacing...`
    );
    return false;
  }
  if (newDocument.filterValues.length !== existing.filterValues.length) {
    console.debug(
      `Document ${newDocument.key} has a different number of filter values, replacing...`
    );
    return false;
  }
  if (
    !existing.filterValues.every((filter) =>
      newDocument.filterValues.some(
        (f) => f.name === filter.name && f.value === filter.value
      )
    )
  ) {
    console.debug(
      `Document ${newDocument.key} filter values are different, replacing...`
    );
    return false;
  }
  // At this point we check for the contents to be the same.
  if (existing.contentHash && newDocument.contentHash) {
    if (existing.contentHash === newDocument.contentHash) {
      // Return early, even if the storageIds are different.
      return true;
    }
    console.debug(
      `Document ${newDocument.key} content hash is different, replacing...`
    );
    return false;
  }
  return true;
}

/**
 * Lists documents in order of their most recent change
 */
export const list = query({
  args: {
    namespaceId: v.id("namespaces"),
    order: v.optional(v.union(v.literal("desc"), v.literal("asc"))),
    status: vStatus,
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginationResult(vDocument),
  handler: async (ctx, args) => {
    const results = await stream(ctx.db, schema)
      .query("documents")
      .withIndex("status_namespaceId", (q) =>
        q
          .eq("status.kind", args.status ?? "ready")
          .eq("namespaceId", args.namespaceId)
      )
      .order(args.order ?? "asc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map(publicDocument),
    };
  },
});

/**
 * Gets a document by its id.
 */
export const get = query({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.union(vDocument, v.null()),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      console.warn(`Document ${args.documentId} not found`);
      return null;
    }
    return publicDocument(document);
  },
});

/**
 * Finds a document by its key and content hash.
 */
export const findByContentHash = query({
  args: {
    ...vNamespaceLookupArgs,
    key: v.string(),
    contentHash: v.string(),
  },
  returns: v.union(vDocument, v.null()),
  handler: async (ctx, args) => {
    const namespace = await getCompatibleNamespaceHandler(ctx, args);
    if (!namespace) {
      return null;
    }
    let attempts = 0;
    for await (const doc of mergedStream(
      statuses.map((status) =>
        stream(ctx.db, schema)
          .query("documents")
          .withIndex("namespaceId_status_key_version", (q) =>
            q
              .eq("namespaceId", namespace._id)
              .eq("status.kind", status)
              .eq("key", args.key)
          )
          .order("desc")
      ),
      ["version"]
    )) {
      attempts++;
      if (attempts > 20) {
        console.debug(
          `Giving up after checking ${attempts} documents for ${args.key}, returning null`
        );
        return null;
      }
      if (
        documentIsSame(doc, {
          key: args.key,
          contentHash: args.contentHash,
          filterValues: doc.filterValues,
          importance: doc.importance,
        })
      ) {
        return publicDocument(doc);
      }
    }
    return null;
  },
});

/**
 * Promotes a document to ready, replacing any existing ready document by key.
 * It will also call the associated onComplete function if it was pending.
 * Note: this will not replace the chunks automatically, so you should first
 * call `replaceChunksPage` on all its chunks.
 * Edge case: if the document has already been replaced, it will return the
 * same document (replacedVersion.documentId === args.documentId).
 */
export const promoteToReady = mutation({
  args: v.object({
    documentId: v.id("documents"),
  }),
  returns: v.object({
    replacedVersion: v.union(vDocument, v.null()),
  }),
  handler: promoteToReadyHandler,
});

async function promoteToReadyHandler(
  ctx: MutationCtx,
  args: { documentId: Id<"documents"> }
) {
  const document = await ctx.db.get(args.documentId);
  assert(document, `Document ${args.documentId} not found`);
  if (document.status.kind === "ready") {
    console.debug(`Document ${args.documentId} is already ready, skipping...`);
    return { replacedVersion: null };
  } else if (document.status.kind === "replaced") {
    console.debug(
      `Document ${args.documentId} is already replaced, returning the current version...`
    );
    return { replacedVersion: publicDocument(document) };
  }
  const previousDocument = await ctx.db
    .query("documents")
    .withIndex("namespaceId_status_key_version", (q) =>
      q
        .eq("namespaceId", document.namespaceId)
        .eq("status.kind", "ready")
        .eq("key", document.key)
    )
    .order("desc")
    .unique();
  if (previousDocument) {
    await ctx.db.patch(previousDocument._id, {
      status: { kind: "replaced", replacedAt: Date.now() },
    });
  }
  await ctx.db.patch(args.documentId, {
    status: { kind: "ready" },
  });
  if (document.status.kind === "pending" && document.status.onComplete) {
    await enqueueOnComplete(ctx, document.status.onComplete, args.documentId);
  }
  return {
    replacedVersion: previousDocument ? publicDocument(previousDocument) : null,
  };
}

export function publicDocument(document: Doc<"documents">): Document {
  const { key, importance, filterValues, contentHash, title } = document;

  return {
    documentId: document._id as unknown as DocumentId,
    key,
    title,
    importance,
    filterValues,
    contentHash,
    status: document.status.kind,
  };
}

export const deleteDocumentAsync = mutation({
  args: v.object({
    documentId: v.id("documents"),
    startOrder: v.number(),
  }),
  returns: v.null(),
  handler: async (ctx, args) => {
    const { documentId, startOrder } = args;
    const document = await ctx.db.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }
    const status = await deleteChunksPage(ctx, { documentId, startOrder });
    if (status.isDone) {
      await ctx.db.delete(documentId);
    } else {
      // TODO: schedule follow-up - workpool?
      await ctx.scheduler.runAfter(0, api.documents.deleteDocumentAsync, {
        documentId,
        startOrder: status.nextStartOrder,
      });
    }
  },
});
