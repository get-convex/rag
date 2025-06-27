import { assert, omit } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
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
      await promoteToReadyHandler(ctx, { documentId });
      return { documentId, status: "ready" as const, created: true };
    }
    return { documentId, status: "pending" as const, created: true };
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
  if (
    !!existing.contentHash &&
    !!newDocument.contentHash &&
    existing.contentHash !== newDocument.contentHash
  ) {
    return false;
  }
  if (
    (!!existing.contentHash || !!newDocument.contentHash) &&
    !(
      existing.source.kind === "_storage" &&
      newDocument.source.kind === "_storage"
    )
  ) {
    // if we are adding/removing a content hash, that's only ok if we are using
    // the same storageId, as those are immutable.
    return false;
  }
  if (existing.importance !== newDocument.importance) {
    console.debug(
      `Document ${newDocument.key} importance is different, skipping...`
    );
    return false;
  }
  if (newDocument.filterValues.length !== existing.filterValues.length) {
    console.debug(
      `Document ${newDocument.key} has a different number of filter values, skipping...`
    );
    return false;
  }
  if (
    existing.filterValues.every((filter) =>
      newDocument.filterValues.some(
        (f) => f.name === filter.name && f.value === filter.value
      )
    )
  ) {
    console.debug(
      `Document ${newDocument.key} filter values are different, skipping...`
    );
    return false;
  }
  if (!sourceMatches(existing.source, newDocument.source)) {
    console.debug(
      `Document ${newDocument.key} source is different, skipping...`
    );
    return false;
  }
  return true;
}

function sourceMatches(existing: Source, newSource: Source) {
  switch (existing.kind) {
    case "url":
      return newSource.kind === "url" && existing.url === newSource.url;
    case "_storage":
      return (
        newSource.kind === "_storage" &&
        existing.storageId === newSource.storageId
      );
    default:
      throw new Error(`Unknown source kind: ${existing}`);
  }
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

export const promoteToReady = mutation({
  args: v.object({
    documentId: v.id("documents"),
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
    return;
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
