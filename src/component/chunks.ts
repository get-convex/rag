import { assert, nullThrows } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { convexToJson, type Infer } from "convex/values";
import {
  BANDWIDTH_PER_TRANSACTION_HARD_LIMIT,
  BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT,
  KB,
  vChunk,
  vCreateChunkArgs,
  vDocument,
  vPaginationResult,
  type Document,
} from "../shared.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { insertEmbedding } from "./embeddings/index.js";
import { vVectorId } from "./embeddings/tables.js";
import { schema, v } from "./schema.js";
import { publicDocument } from "./documents.js";

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
          importance: document.importance,
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
              state: { kind: "replaced", embeddingId: chunk.state.embeddingId },
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

export const vRangeResult = v.object({
  documentId: v.id("documents"),
  order: v.number(),
  startOrder: v.number(),
  content: v.array(
    v.object({
      text: v.string(),
      metadata: v.optional(v.record(v.string(), v.any())),
    })
  ),
});

export const getRangesOfChunks = internalQuery({
  args: {
    embeddingIds: v.array(vVectorId),
    messageRange: v.object({ before: v.number(), after: v.number() }),
  },
  returns: v.object({
    ranges: v.array(v.union(v.null(), vRangeResult)),
    documents: v.array(vDocument),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    ranges: (null | Infer<typeof vRangeResult>)[];
    documents: Document[];
  }> => {
    const { embeddingIds, messageRange } = args;
    const chunks = await Promise.all(
      embeddingIds.map((embeddingId) =>
        ctx.db
          .query("chunks")
          .withIndex("embeddingId", (q) =>
            q.eq("state.embeddingId", embeddingId)
          )
          .order("desc")
          .first()
      )
    );

    // Note: This preserves order of documents as they first appeared.
    const documents = (
      await Promise.all(
        Array.from(
          new Set(chunks.filter((c) => c !== null).map((c) => c.documentId))
        ).map((id) => ctx.db.get(id))
      )
    )
      .filter((d) => d !== null)
      .map(publicDocument);

    const documentOders = chunks
      .filter((c) => c !== null)
      .map((c) => [c.documentId, c.order] as const)
      .reduce(
        (acc, [documentId, order]) => {
          if (acc[documentId]?.includes(order)) {
            // De-dupe orders
            return acc;
          }
          acc[documentId] = [...(acc[documentId] ?? []), order].sort(
            (a, b) => a - b
          );
          return acc;
        },
        {} as Record<Id<"documents">, number[]>
      );

    const result: Array<Infer<typeof vRangeResult> | null> = [];

    for (const chunk of chunks) {
      if (chunk === null) {
        result.push(null);
        continue;
      }
      // Note: if we parallelize this in the future, we could have a race
      // instead we'd check that other chunks are not the same doc/order
      if (
        result.find(
          (r) => r?.documentId === chunk.documentId && r?.order === chunk.order
        )
      ) {
        // De-dupe chunks
        result.push(null);
        continue;
      }
      const documentId = chunk.documentId;
      const document = await ctx.db.get(documentId);
      assert(document, `Document ${documentId} not found`);
      const otherOrders = documentOders[documentId] ?? [chunk.order];
      const ourOrderIndex = otherOrders.indexOf(chunk.order);
      const previousOrder = otherOrders[ourOrderIndex - 1] ?? chunk.order;
      const nextOrder = otherOrders[ourOrderIndex + 1] ?? chunk.order;
      // We absorb all previous context up to the previous chunk.
      const startOrder = Math.max(
        chunk.order - messageRange.before,
        previousOrder + 1
      );
      // We stop short if the next chunk order's "before" context will cover it.
      const endOrder = Math.min(
        chunk.order + messageRange.after + 1,
        Math.max(nextOrder - messageRange.before, chunk.order + 1)
      );
      const contentIds: Id<"content">[] = [];
      if (startOrder === chunk.order && endOrder === chunk.order + 1) {
        contentIds.push(chunk.contentId);
      } else {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) =>
            q
              .eq("documentId", documentId)
              .gte("order", startOrder)
              .lt("order", endOrder)
          )
          .collect();
        for (const chunk of chunks) {
          contentIds.push(chunk.contentId);
        }
      }
      const content = await Promise.all(
        contentIds.map(async (contentId) => {
          const content = await ctx.db.get(contentId);
          assert(content, `Content ${contentId} not found`);
          return { text: content.text, metadata: content.metadata };
        })
      );

      result.push({
        documentId,
        order: chunk.order,
        startOrder,
        content,
      });
    }

    return {
      ranges: result,
      documents,
    };
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

// export async function findLastChunk(
//   ctx: MutationCtx,
//   documentId: Id<"documents">
// ): Promise<Chunk | null> {
//   const chunk = await ctx.db
//     .query("chunks")
//     .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
//     .order("desc")
//     .first();
//   if (!chunk) {
//     return null;
//   }
//   const content = await ctx.db.get(chunk.contentId);
//   assert(content, `Content for chunk ${chunk._id} not found`);
//   return publicChunk(chunk, content);
// }

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
    dataUsedSoFar += chunk.state.embedding.length * 8;
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
