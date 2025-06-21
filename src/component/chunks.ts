import { v, type Infer } from "convex/values";
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
} from "./_generated/server.js";
import type { CreateEmbeddingArgs } from "./embeddings/tables.js";
import { vNamedFilter } from "./schema.js";

export const vCreateChunkArgs = v.object({
  content: v.object({
    text: v.string(),
    metadata: v.optional(v.record(v.string(), v.any())),
  }),
  filters: v.array(vNamedFilter),
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
          filters: chunk.filters,
        },
        contentId,
        importance: chunk.importance,
      })
    );
    order++;
  }
  return chunkIds;
}
