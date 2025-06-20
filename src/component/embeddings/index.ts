import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import {
  type ActionCtx,
  mutation,
  type MutationCtx,
  query,
} from "../_generated/server.js";
import schema from "../schema.js";
import {
  type CreateEmbeddingArgs,
  getVectorTableName,
  type VectorDimension,
  vCreateEmbeddingArgs,
  vVectorDimension,
  vVectorId,
  type Filters,
  filterNames,
} from "./tables.js";

export const insertBatch = mutation({
  args: {
    vectorDimension: vVectorDimension,
    vectors: v.array(
      v.object({
        ...vCreateEmbeddingArgs.fields,
      })
    ),
  },
  returns: v.array(vVectorId),
  handler: async (ctx, args) => {
    return Promise.all(
      args.vectors.map(async (v) => insertVector(ctx, args.vectorDimension, v))
    );
  },
});

export async function insertVector(
  ctx: MutationCtx,
  dimension: VectorDimension,
  v: CreateEmbeddingArgs
) {
  const filters: Filters = {};
  for (const [i, filter] of v.filters.entries()) {
    if (!filter) continue;
    filters[filterNames[i]] = {
      namespaceId: v.namespace,
      filter,
    };
  }
  return ctx.db.insert(getVectorTableName(dimension), {
    namespace: v.namespace,
    vector: v.vector,
    ...filters,
  });
}

export function searchVectors(
  ctx: ActionCtx,
  vector: number[],
  args: {
    dimension: VectorDimension;
    namespace: Id<"namespaces">;
    filters: Filters;
    limit?: number;
  }
) {
  const tableName = getVectorTableName(args.dimension);
  return ctx.vectorSearch(tableName, "vector", {
    vector,
    // TODO:
    // filter: (q) =>
    // args.searchAllMessagesForUserId
    //   ? q.eq("model_table_userId", [
    //       args.model,
    //       args.table,
    //       args.searchAllMessagesForUserId,
    //     ])
    //   : q.eq("model_table_threadId", [
    //       args.model,
    //       args.table,
    //       // TODO
    //       // args.threadId!,
    //     ]),
    limit: args.limit,
  });
}
