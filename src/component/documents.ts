import { assert, omit } from "convex-helpers";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { DocumentId } from "../client/index.js";
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
import schema, { type Source, type StatusWithOnComplete } from "./schema.js";
import { mergedStream } from "convex-helpers/server/stream";
import { stream } from "convex-helpers/server/stream";
import {
  getCompatibleNamespaceHandler,
  vNamespaceLookupArgs,
} from "./namespaces.js";

export const upsertAsync = mutation({
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
    await enqueueUpsert(ctx, {
      documentId,
      chunker: args.chunker,
    });
    return { documentId, status: status.kind, created: true };
  },
});

async function enqueueUpsert(
  ctx: MutationCtx,
  args: {
    documentId: Id<"documents">;
    chunker: string;
  }
) {
  // TODO: enqueue into workpool
}

type UpsertDocumentArgs = Pick<
  Doc<"documents">,
  "key" | "contentHash" | "importance" | "source" | "filterValues"
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
  ctx: MutationCtx,
  onComplete: string,
  documentId: Id<"documents">
) {
  throw new Error("Not implemented");
}

function documentIsSame(
  existing: Doc<"documents">,
  newDocument: UpsertDocumentArgs
) {
  console.debug("documentIsSame", existing, newDocument);
  if (
    !!existing.contentHash &&
    !!newDocument.contentHash &&
    existing.contentHash !== newDocument.contentHash
  ) {
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
  if (existing.source.kind !== newDocument.source.kind) {
    console.debug(
      `Document ${newDocument.key} source kind is different, replacing...`
    );
    return false;
  }
  if (
    existing.source.kind === "url" &&
    newDocument.source.kind === "url" &&
    existing.source.url !== newDocument.source.url
  ) {
    console.debug(
      `Document ${newDocument.key} source url is different, replacing...`
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
  if (
    existing.source.kind === "_storage" &&
    newDocument.source.kind === "_storage" &&
    existing.contentHash !== newDocument.contentHash
  ) {
    console.debug(
      `Document ${newDocument.key} source storageId is different, replacing...`
    );
    // if we are adding/removing a content hash, that's only ok if we are using
    // the same storageId, as those are immutable.
    return false;
  }
  return true;
}

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
      .withIndex("namespaceId_status_key_version", (q) =>
        q
          .eq("namespaceId", args.namespaceId)
          .eq("status.kind", args.status ?? "ready")
      )
      .order(args.order ?? "asc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map(publicDocument),
    };
  },
});

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

export const findByContentHash = query({
  args: {
    ...vNamespaceLookupArgs,
    key: v.string(),
    contentHash: v.string(),
    url: v.optional(v.string()),
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
          source: args.url
            ? { kind: "url", url: args.url }
            : { kind: "_storage", storageId: "" },
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
  const { key, importance, filterValues, contentHash, source, title } =
    document;

  return {
    documentId: document._id as unknown as DocumentId,
    key,
    title,
    importance,
    filterValues,
    contentHash,
    source,
    status: document.status.kind,
  };
}

export const deleteDocumentAsync = mutation({
  args: v.object({
    documentId: v.id("documents"),
    startOrder: v.number(),
  }),
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
