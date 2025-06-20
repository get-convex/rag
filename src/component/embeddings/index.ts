import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v, type Value } from "convex/values";
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
  filterFieldNames,
  validateVectorDimension,
} from "./tables.js";
import { vectorWithImportance } from "./importance.js";

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
      args.vectors.map(async (v) =>
        insertVector(ctx, v.vector, v.namespace, v.importance, v.filters)
      )
    );
  },
});

export async function insertVector(
  ctx: MutationCtx,
  vector: number[],
  namespace: Id<"namespaces">,
  importance: number | undefined,
  filters: Array<Value> | undefined
) {
  const filterFields: Filters = {};
  if (filters) {
    for (let i = 0; i < filters.length; i++) {
      if (i >= filterFieldNames.length) {
        console.warn(`Unknown filter name: ${i}`);
        break;
      }
      const filter = filters[i];
      if (!filter) continue;
      filterFields[filterFieldNames[i]] = {
        namespaceId: namespace,
        filter,
      };
    }
  }
  const dimension = validateVectorDimension(vector.length);
  return ctx.db.insert(getVectorTableName(dimension), {
    namespace,
    vector: vectorWithImportance(vector, importance ?? 1),
    ...filterFields,
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
