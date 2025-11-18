import { assert } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { convexToJson, type Infer } from "convex/values";
import {
  statuses,
  vChunk,
  vCreateChunkArgs,
  vEntry,
  vPaginationResult,
  vStatus,
  type Entry,
} from "../shared.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { insertEmbedding } from "./embeddings/index.js";
import { vVectorId, type VectorTableName } from "./embeddings/tables.js";
import { schema, v } from "./schema.js";
import { getPreviousEntry, publicEntry } from "./entries.js";
import {
  filterFieldsFromNumbers,
  numberedFilterFromNamedFilters,
} from "./filters.js";

const KB = 1_024;
const MB = 1_024 * KB;
const BANDWIDTH_PER_TRANSACTION_HARD_LIMIT = 8 * MB;
const BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT = 4 * MB;

export const vInsertChunksArgs = v.object({
  entryId: v.id("entries"),
  startOrder: v.number(),
  chunks: v.array(vCreateChunkArgs),
});
type InsertChunksArgs = Infer<typeof vInsertChunksArgs>;

export const insert = mutation({
  args: vInsertChunksArgs,
  returns: v.object({ status: vStatus }),
  handler: insertChunks,
});

export async function insertChunks(
  ctx: MutationCtx,
  { entryId, startOrder, chunks }: InsertChunksArgs,
) {
  const entry = await ctx.db.get(entryId);
  if (!entry) {
    throw new Error(`Entry ${entryId} not found`);
  }
  await ensureLatestEntryVersion(ctx, entry);

  // Get the namespace for filter conversion
  const namespace = await ctx.db.get(entry.namespaceId);
  assert(namespace, `Namespace ${entry.namespaceId} not found`);

  const previousEntry = await getPreviousEntry(ctx, entry);
  let order = startOrder;
  const chunkIds: Id<"chunks">[] = [];
  const existingChunks = await ctx.db
    .query("chunks")
    .withIndex("entryId_order", (q) =>
      q
        .eq("entryId", entryId)
        .gte("order", startOrder)
        .lt("order", startOrder + chunks.length),
    )
    .collect();
  if (existingChunks.length > 0) {
    console.debug(
      `Deleting ${existingChunks.length} existing chunks for entry ${entryId} at version ${entry.version}`,
    );
  }
  // TODO: avoid writing if they're the same
  await Promise.all(
    existingChunks.map(async (c) => {
      if (c.state.kind === "ready") {
        await ctx.db.delete(c.state.embeddingId);
      }
      await ctx.db.delete(c.contentId);
      await ctx.db.delete(c._id);
    }),
  );
  const numberedFilter = numberedFilterFromNamedFilters(
    entry.filterValues,
    namespace!.filterNames,
  );
  for (const chunk of chunks) {
    const contentId = await ctx.db.insert("content", {
      text: chunk.content.text,
      metadata: chunk.content.metadata,
    });
    let state: Doc<"chunks">["state"] = {
      kind: "pending",
      embedding: chunk.embedding,
      importance: entry.importance,
      pendingSearchableText: chunk.searchableText,
    };
    if (!previousEntry) {
      const embeddingId = await insertEmbedding(
        ctx,
        chunk.embedding,
        entry.namespaceId,
        entry.importance,
        numberedFilter,
      );
      state = {
        kind: "ready",
        embeddingId,
        searchableText: chunk.searchableText,
      };
    }
    chunkIds.push(
      await ctx.db.insert("chunks", {
        entryId,
        order,
        state,
        contentId,
        namespaceId: entry.namespaceId,
        ...filterFieldsFromNumbers(entry.namespaceId, numberedFilter),
      }),
    );
    order++;
  }
  return { status: previousEntry ? ("pending" as const) : ("ready" as const) };
}

async function ensureLatestEntryVersion(ctx: QueryCtx, entry: Doc<"entries">) {
  if (!entry.key) {
    return true;
  }
  const newerEntry = await mergedStream(
    statuses.map((status) =>
      stream(ctx.db, schema)
        .query("entries")
        .withIndex("namespaceId_status_key_version", (q) =>
          q
            .eq("namespaceId", entry.namespaceId)
            .eq("status.kind", status)
            .eq("key", entry.key)
            .gt("version", entry.version),
        ),
    ),
    ["version"],
  ).first();
  if (newerEntry) {
    console.warn(
      `Bailing from inserting chunks for entry ${entry.key} at version ${entry.version} since there's a newer version ${newerEntry.version} (status ${newerEntry.status}) creation time difference ${(newerEntry._creationTime - entry._creationTime).toFixed(0)}ms`,
    );
    return false;
  }
  return true;
}

export const replaceChunksPage = mutation({
  args: v.object({ entryId: v.id("entries"), startOrder: v.number() }),
  returns: v.object({ status: vStatus, nextStartOrder: v.number() }),
  handler: async (ctx, args) => {
    const { entryId, startOrder } = args;
    const entryOrNull = await ctx.db.get(entryId);
    if (!entryOrNull) {
      throw new Error(`Entry ${entryId} not found`);
    }
    const entry = entryOrNull;
    const isLatest = await ensureLatestEntryVersion(ctx, entry);
    if (!isLatest) {
      return { status: "replaced" as const, nextStartOrder: startOrder };
    }

    // Get the namespace for filter conversion
    const namespace = await ctx.db.get(entry.namespaceId);
    assert(namespace, `Namespace ${entry.namespaceId} not found`);

    const previousEntry = await getPreviousEntry(ctx, entry);
    const pendingEntries =
      entry.key && previousEntry
        ? (
            await ctx.db
              .query("entries")
              .withIndex("namespaceId_status_key_version", (q) =>
                q
                  .eq("namespaceId", entry.namespaceId)
                  .eq("status.kind", "pending")
                  .eq("key", entry.key),
              )
              .collect()
          ).filter((e) => e._id !== entry._id)
        : [];
    const chunkStream = mergedStream(
      [entry, ...pendingEntries, previousEntry]
        .filter((d) => d !== null)
        .map((entry) =>
          stream(ctx.db, schema)
            .query("chunks")
            .withIndex("entryId_order", (q) =>
              q.eq("entryId", entry._id).gte("order", startOrder),
            ),
        ),
      ["order"],
    );
    const namespaceId = entry.namespaceId;
    const namedFilters = numberedFilterFromNamedFilters(
      entry.filterValues,
      namespace!.filterNames,
    );
    async function addChunk(
      chunk: Doc<"chunks"> & { state: { kind: "pending" } },
    ) {
      const embeddingId = await insertEmbedding(
        ctx,
        chunk.state.embedding,
        namespaceId,
        entry.importance,
        namedFilters,
      );
      await ctx.db.patch(chunk._id, { state: { kind: "ready", embeddingId } });
    }
    let dataUsedSoFar = 0;
    let indexToDelete = startOrder;
    let chunksToDeleteEmbeddings: Doc<"chunks">[] = [];
    let chunkToAdd: (Doc<"chunks"> & { state: { kind: "pending" } }) | null =
      null;
    async function handleBatch() {
      await Promise.all(
        chunksToDeleteEmbeddings.map(async (chunk) => {
          assert(chunk.state.kind === "ready");
          const vector = await ctx.db.get(chunk.state.embeddingId);
          assert(vector, `Vector ${chunk.state.embeddingId} not found`);
          // get and delete both count as bandwidth reads
          dataUsedSoFar += estimateEmbeddingSize(vector) * 2;
          await ctx.db.delete(chunk.state.embeddingId);
          await ctx.db.patch(chunk._id, {
            state: {
              kind: "replaced",
              embeddingId: chunk.state.embeddingId,
              vector: vector.vector,
              pendingSearchableText: chunk.state.searchableText,
            },
          });
        }),
      );
      chunksToDeleteEmbeddings = [];
      if (chunkToAdd) {
        await addChunk(chunkToAdd);
      }
      chunkToAdd = null;
    }
    for await (const chunk of chunkStream) {
      // one for the stream read, one for patching / replacing
      dataUsedSoFar += estimateChunkSize(chunk) * 2;
      if (chunk.state.kind !== "pending") {
        dataUsedSoFar += 17 * KB; // embedding conservative estimate
      }
      if (chunk.order > indexToDelete) {
        await handleBatch();
        indexToDelete = chunk.order;
        // delete the chunks
        // check if we're close to the limit
        // if so, bail and pick up on this chunk.order.
        if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT) {
          return { status: "pending" as const, nextStartOrder: indexToDelete };
        }
      }
      if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_HARD_LIMIT) {
        return { status: "pending" as const, nextStartOrder: indexToDelete };
      }
      if (chunk.state.kind === "pending") {
        if (chunk.entryId === entryId) {
          if (chunkToAdd) {
            console.warn(
              `Multiple pending chunks before changing order ${chunk.order} for entry ${entryId} version ${entry.version}: ${chunkToAdd._id} and ${chunk._id}`,
            );
            await addChunk(chunkToAdd);
          }
          chunkToAdd = chunk as Doc<"chunks"> & { state: { kind: "pending" } };
        }
      } else {
        if (chunk.entryId !== entryId && chunk.state.kind === "ready") {
          chunksToDeleteEmbeddings.push(chunk);
        } else {
          console.debug(
            `Skipping adding chunk ${chunk._id} for entry ${entryId} version ${entry.version} since it's already ready`,
          );
        }
      }
    }
    // handle the last batch
    await handleBatch();

    return { status: "ready" as const, nextStartOrder: 0 };
  },
});

export const vRangeResult = v.object({
  entryId: v.id("entries"),
  order: v.number(),
  startOrder: v.number(),
  content: v.array(
    v.object({
      text: v.string(),
      metadata: v.optional(v.record(v.string(), v.any())),
    }),
  ),
});

export const getRangesOfChunks = internalQuery({
  args: {
    embeddingIds: v.array(vVectorId),
    chunkContext: v.object({ before: v.number(), after: v.number() }),
  },
  returns: v.object({
    ranges: v.array(v.union(v.null(), vRangeResult)),
    entries: v.array(vEntry),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ranges: (null | Infer<typeof vRangeResult>)[];
    entries: Entry[];
  }> => {
    const { embeddingIds, chunkContext } = args;
    const chunks = await Promise.all(
      embeddingIds.map((embeddingId) =>
        ctx.db
          .query("chunks")
          .withIndex("embeddingId", (q) =>
            q.eq("state.embeddingId", embeddingId),
          )
          .order("desc")
          .first(),
      ),
    );

    // Note: This preserves order of entries as they first appeared.
    const entries = (
      await Promise.all(
        Array.from(
          new Set(chunks.filter((c) => c !== null).map((c) => c.entryId)),
        ).map((id) => ctx.db.get(id)),
      )
    )
      .filter((d) => d !== null)
      .map(publicEntry);

    const entryOders = chunks
      .filter((c) => c !== null)
      .map((c) => [c.entryId, c.order] as const)
      .reduce(
        (acc, [entryId, order]) => {
          if (acc[entryId]?.includes(order)) {
            // De-dupe orders
            return acc;
          }
          acc[entryId] = [...(acc[entryId] ?? []), order].sort((a, b) => a - b);
          return acc;
        },
        {} as Record<Id<"entries">, number[]>,
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
          (r) => r?.entryId === chunk.entryId && r?.order === chunk.order,
        )
      ) {
        // De-dupe chunks
        result.push(null);
        continue;
      }
      const entryId = chunk.entryId;
      const entry = await ctx.db.get(entryId);
      assert(entry, `Entry ${entryId} not found`);
      const otherOrders = entryOders[entryId] ?? [chunk.order];
      const ourOrderIndex = otherOrders.indexOf(chunk.order);
      const previousOrder = otherOrders[ourOrderIndex - 1] ?? -Infinity;
      const nextOrder = otherOrders[ourOrderIndex + 1] ?? Infinity;
      // We absorb all previous context up to the previous chunk.
      const startOrder = Math.max(
        chunk.order - chunkContext.before,
        0,
        Math.min(previousOrder + 1, chunk.order),
      );
      // We stop short if the next chunk order's "before" context will cover it.
      const endOrder = Math.min(
        chunk.order + chunkContext.after + 1,
        Math.max(nextOrder - chunkContext.before, chunk.order + 1),
      );
      const contentIds: Id<"content">[] = [];
      if (startOrder === chunk.order && endOrder === chunk.order + 1) {
        contentIds.push(chunk.contentId);
      } else {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("entryId_order", (q) =>
            q
              .eq("entryId", entryId)
              .gte("order", startOrder)
              .lt("order", endOrder),
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
        }),
      );

      result.push({ entryId, order: chunk.order, startOrder, content });
    }

    return { ranges: result, entries };
  },
});

export const list = query({
  args: v.object({
    entryId: v.id("entries"),
    paginationOpts: paginationOptsValidator,
    order: v.union(v.literal("desc"), v.literal("asc")),
  }),
  returns: vPaginationResult(vChunk),
  handler: async (ctx, args) => {
    const { entryId, paginationOpts } = args;
    const chunks = await paginator(ctx.db, schema)
      .query("chunks")
      .withIndex("entryId_order", (q) => q.eq("entryId", entryId))
      .order(args.order)
      .paginate(paginationOpts);
    return {
      ...chunks,
      page: await Promise.all(
        chunks.page.map(async (chunk) => {
          const content = await ctx.db.get(chunk.contentId);
          assert(content, `Content ${chunk.contentId} not found`);
          return publicChunk(chunk, content);
        }),
      ),
    };
  },
});

// export async function findLastChunk(
//   ctx: MutationCtx,
//   entryId: Id<"entries">
// ): Promise<Chunk | null> {
//   const chunk = await ctx.db
//     .query("chunks")
//     .withIndex("entryId_order", (q) => q.eq("entryId", entryId))
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

export const deleteChunksPage = internalMutation({
  args: v.object({ entryId: v.id("entries"), startOrder: v.number() }),
  returns: v.object({ isDone: v.boolean(), nextStartOrder: v.number() }),
  handler: deleteChunksPageHandler,
});

export async function deleteChunksPageHandler(
  ctx: MutationCtx,
  { entryId, startOrder }: { entryId: Id<"entries">; startOrder: number },
) {
  const chunkStream = ctx.db
    .query("chunks")
    .withIndex("entryId_order", (q) =>
      q.eq("entryId", entryId).gte("order", startOrder),
    );
  let dataUsedSoFar = 0;
  for await (const chunk of chunkStream) {
    // one for the stream read, one for deleting
    dataUsedSoFar += estimateChunkSize(chunk) * 2;
    await ctx.db.delete(chunk._id);
    if (chunk.state.kind === "ready") {
      const embedding = await ctx.db.get(chunk.state.embeddingId);
      if (embedding) {
        // get and delete both count as bandwidth reads
        dataUsedSoFar += estimateEmbeddingSize(embedding) * 2;
        await ctx.db.delete(chunk.state.embeddingId);
      }
    }
    dataUsedSoFar += await estimateContentSize(ctx, chunk.contentId);
    await ctx.db.delete(chunk.contentId);
    if (dataUsedSoFar > BANDWIDTH_PER_TRANSACTION_HARD_LIMIT) {
      return { isDone: false, nextStartOrder: chunk.order };
    }
  }
  return { isDone: true, nextStartOrder: -1 };
}

function estimateEmbeddingSize(embedding: Doc<VectorTableName>) {
  let dataUsedSoFar =
    embedding.vector.length * 8 +
    embedding.namespaceId.length +
    embedding._id.length +
    8;
  for (const filter of [
    embedding.filter0,
    embedding.filter1,
    embedding.filter2,
    embedding.filter3,
  ]) {
    if (filter) {
      dataUsedSoFar += JSON.stringify(convexToJson(filter[1])).length;
    }
  }
  return dataUsedSoFar;
}

function estimateChunkSize(chunk: Doc<"chunks">) {
  let dataUsedSoFar = 100; // constant metadata - roughly
  if (chunk.state.kind === "pending") {
    dataUsedSoFar += chunk.state.embedding.length * 8;
    dataUsedSoFar += chunk.state.pendingSearchableText?.length ?? 0;
  } else if (chunk.state.kind === "replaced") {
    dataUsedSoFar += chunk.state.vector.length * 8;
    dataUsedSoFar += chunk.state.pendingSearchableText?.length ?? 0;
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
      convexToJson(content.metadata ?? {}),
    ).length;
  }
  return dataUsedSoFar;
}
