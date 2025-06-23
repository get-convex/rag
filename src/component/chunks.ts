import { convexToJson, v, type Infer } from "convex/values";
import { api, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { mergedStream, stream } from "convex-helpers/server/stream";
import type { VectorTableId } from "./embeddings/tables.js";
import { vVectorId } from "./embeddings/tables.js";
import schema, { vNamedFilter } from "./schema.js";
import { insertEmbedding } from "./embeddings/index.js";
import { assert } from "convex-helpers";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { vChunk, vPaginationResult } from "../shared.js";

const KB = 1_024;
const MB = 1_024 * KB;
const BANDWIDTH_PER_TRANSACTION_HARD_LIMIT = 8 * MB;
const BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT = 4 * MB;

export const vCreateChunkArgs = v.object({
  content: v.object({
    text: v.string(),
    metadata: v.optional(v.record(v.string(), v.any())),
  }),
  embedding: v.array(v.number()),
  importance: v.number(),
});
export type CreateChunkArgs = Infer<typeof vCreateChunkArgs>;

export const vInsertChunksArgs = v.object({
  documentId: v.id("documents"),
  startOrder: v.number(),
  chunks: v.array(vCreateChunkArgs),
});
type InsertChunksArgs = Infer<typeof vInsertChunksArgs>;

export const insert = mutation({
  args: vInsertChunksArgs,
  handler: insertChunks,
});

export async function insertChunks(
  ctx: MutationCtx,
  { documentId, startOrder, chunks }: InsertChunksArgs
) {
  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }
  await ensureLatestDocumentVersion(ctx, document);
  let order = startOrder;
  const chunkIds: Id<"chunks">[] = [];
  for (const chunk of chunks) {
    const contentId = await ctx.db.insert("content", {
      text: chunk.content.text,
      metadata: chunk.content.metadata,
    });
    chunkIds.push(
      await ctx.db.insert("chunks", {
        documentId,
        order,
        state: {
          kind: "pending",
          embedding: chunk.embedding,
          importance: chunk.importance,
        },
        contentId,
      })
    );
    order++;
  }
  return chunkIds;
}

async function ensureLatestDocumentVersion(
  ctx: QueryCtx,
  document: Doc<"documents">
) {
  const newerDocument = await ctx.db
    .query("documents")
    .withIndex("namespaceId_key_version", (q) =>
      q
        .eq("namespaceId", document.namespaceId)
        .eq("key", document.key)
        .gt("version", document.version)
    )
    .first();
  if (newerDocument) {
    throw new Error(
      `Bailing from inserting chunks for document ${document.key} at version ${document.version} since there's a newer version ${newerDocument.version} (status ${newerDocument.status}) creation time difference ${(newerDocument._creationTime - document._creationTime).toFixed(0)}ms`
    );
  }
}

export const replaceChunksAsync = mutation({
  args: v.object({
    documentId: v.id("documents"),
    startOrder: v.number(),
    embeddingIds: v.array(vVectorId),
  }),
  handler: async (ctx, args) => {
    const { documentId, startOrder, embeddingIds } = args;
    const documentOrNull = await ctx.db.get(documentId);
    if (!documentOrNull) {
      throw new Error(`Document ${documentId} not found`);
    }
    const document = documentOrNull;
    await ensureLatestDocumentVersion(ctx, document);
    const previousDocument = await ctx.db
      .query("documents")
      .withIndex("namespaceId_key_version", (q) =>
        q
          .eq("namespaceId", document.namespaceId)
          .eq("key", document.key)
          .lt("version", document.version)
      )
      .filter((q) => q.eq(q.field("status"), { kind: "ready" }))
      .order("desc")
      .first();
    const pendingDocuments = previousDocument
      ? await ctx.db
          .query("documents")
          .withIndex("namespaceId_key_version", (q) =>
            q
              .eq("namespaceId", document.namespaceId)
              .eq("key", document.key)
              .gt("version", previousDocument.version)
              .lt("version", document.version)
          )
          .order("desc")
          .collect()
      : [];
    const chunkStream = mergedStream(
      [document, ...pendingDocuments, previousDocument]
        .filter((d) => d !== null)
        .map((doc) =>
          stream(ctx.db, schema)
            .query("chunks")
            .withIndex("documentId_order", (q) =>
              q.eq("documentId", doc._id).gte("order", startOrder)
            )
        ),
      ["order"]
    );
    const namespaceId = document.namespaceId;
    async function addChunk(
      chunk: Doc<"chunks"> & { state: { kind: "pending" } }
    ) {
      const embeddingId = await insertEmbedding(
        ctx,
        chunk.state.embedding,
        namespaceId,
        document.importance,
        document.filterValues
      );
      await ctx.db.patch(chunk._id, {
        state: { kind: "ready", embeddingId },
      });
    }
    let dataUsedSoFar = 0;
    let indexToDelete = startOrder;
    let chunksToDeleteEmbeddings: Doc<"chunks">[] = [];
    let chunkToAdd: (Doc<"chunks"> & { state: { kind: "pending" } }) | null =
      null;
    for await (const chunk of chunkStream) {
      if (chunk.state.kind === "pending") {
        dataUsedSoFar += await estimateChunkSize(chunk);
      } else {
        dataUsedSoFar += 17 * KB; // embedding conservative estimate
      }
      if (chunk.order > indexToDelete) {
        await Promise.all(
          chunksToDeleteEmbeddings.map(async (chunk) => {
            assert(chunk.state.kind === "ready");
            await ctx.db.delete(chunk.state.embeddingId);
            await ctx.db.patch(chunk._id, {
              state: { kind: "deleted", embeddingId: chunk.state.embeddingId },
            });
          })
        );
        if (chunkToAdd) {
          await addChunk(chunkToAdd);
        }
        indexToDelete = chunk.order;
        chunksToDeleteEmbeddings = [];
        chunkToAdd = null;
        // delete the chunks
        // check if we're close to the limit
        // if so, bail and pick up on this chunk.order.
        if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT) {
          break;
        }
      }
      if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_HARD_LIMIT) {
        break;
      }
      if (chunk.state.kind === "pending") {
        if (chunk.documentId === documentId) {
          if (chunkToAdd) {
            console.warn(
              `Multiple pending chunks before changing order ${chunk.order} for document ${documentId} version ${document.version}: ${chunkToAdd._id} and ${chunk._id}`
            );
            await addChunk(chunkToAdd);
          }
          chunkToAdd = chunk as Doc<"chunks"> & { state: { kind: "pending" } };
        }
      } else {
        if (chunk.documentId !== documentId && chunk.state.kind === "ready") {
          chunksToDeleteEmbeddings.push(chunk);
        } else {
          console.warn(
            `Skipping adding chunk ${chunk._id} for document ${documentId} version ${document.version} since it's already ready`
          );
        }
      }
    }
    // TODO: schedule next page - workpool?
  },
});

export const list = query({
  args: v.object({
    documentId: v.id("documents"),
    paginationOpts: paginationOptsValidator,
  }),
  returns: vPaginationResult(vChunk),
  handler: async (ctx, args) => {
    const { documentId, paginationOpts } = args;
    const chunks = await paginator(ctx.db, schema)
      .query("chunks")
      .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
      .order("asc")
      .paginate(paginationOpts);
    return {
      ...chunks,
      page: await Promise.all(
        chunks.page.map(async (chunk) => {
          const content = await ctx.db.get(chunk.contentId);
          assert(content, `Content ${chunk.contentId} not found`);
          return publicChunk(chunk, content);
        })
      ),
    };
  },
});

async function publicChunk(chunk: Doc<"chunks">, content: Doc<"content">) {
  return {
    order: chunk.order,
    state: chunk.state.kind,
    text: content.text,
    metadata: content.metadata,
  };
}

export async function deleteChunksPage(
  ctx: MutationCtx,
  {
    documentId,
    startOrder,
  }: { documentId: Id<"documents">; startOrder: number }
) {
  const chunkStream = ctx.db
    .query("chunks")
    .withIndex("documentId_order", (q) =>
      q.eq("documentId", documentId).gte("order", startOrder)
    );
  let dataUsedSoFar = 0;
  for await (const chunk of chunkStream) {
    dataUsedSoFar += await estimateChunkSize(chunk);
    await ctx.db.delete(chunk._id);
    dataUsedSoFar += await estimateContentSize(ctx, chunk.contentId);
    await ctx.db.delete(chunk.contentId);
    if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_HARD_LIMIT) {
      // TODO: schedule follow-up - workpool?
      return { isDone: false, nextStartOrder: chunk.order };
    }
  }
  return { isDone: true, nextStartOrder: -1 };
}

async function estimateChunkSize(chunk: Doc<"chunks">) {
  let dataUsedSoFar = 100; // constant metadata - roughly
  if (chunk.state.kind === "pending") {
    dataUsedSoFar += chunk.state.embedding.length * 4;
  }
  return dataUsedSoFar;
}
async function estimateContentSize(ctx: QueryCtx, contentId: Id<"content">) {
  let dataUsedSoFar = 0;
  // TODO: if/when deletions don't count as bandwidth, we can remove this.
  const content = await ctx.db.get(contentId);
  if (content) {
    dataUsedSoFar += content.text.length;
    dataUsedSoFar += JSON.stringify(
      convexToJson(content.metadata ?? {})
    ).length;
  }
  return dataUsedSoFar;
}
