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
      args.vectors.map(async (v) => insertVector(ctx, args.vectorDimension, v))
    );
  },
});

export async function insertVector(
  ctx: MutationCtx,
  vector: number[],
  namespace: Id<"namespaces">,
  importance: number | undefined,
  filters: Record<string, Value>,
  // filterNames is the ordering of the filters in the vector.
  filterNames: string[]
) {
  const filterFields: Filters = {};
  for (const [name, filter] of Object.entries(filters)) {
    if (!filter) continue;
    const filterIndex = filterNames.indexOf(name);
    if (filterIndex === -1) {
      console.warn(`Unknown filter name: ${name}`);
      continue;
    }
    filterFields[filterFieldNames[filterIndex]] = {
      namespaceId: namespace,
      filter,
    };
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
