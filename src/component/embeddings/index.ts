/**
 * This file is the interface for interacting with embeddings.
 * It translates from embeddings to the underlying vector storage and search.
 * It modifies embeddings to include importance.
 * The outer world deals with filters with user names.
 * The underlying vector storage has its own names.
 * This file takes in numbered filters (0-3) to translate without knowing about
 * user names.
 */
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
  filterFieldNames,
  validateVectorDimension,
  type NumberedFilter,
  type NamedFilterField,
} from "./tables.js";
import { searchVector, vectorWithImportance } from "./importance.js";

export type NamedFilter = {
  name: string;
  value: Value;
};

// TODO: see if this is needed.
// export const insertBatch = mutation({
//   args: {
//     vectorDimension: vVectorDimension,
//     vectors: v.array(
//       v.object({
//         ...vCreateEmbeddingArgs.fields,
//       })
//     ),
//   },
//   returns: v.array(vVectorId),
//   handler: async (ctx, args) => {
//     return Promise.all(
//       args.vectors.map(async (v) =>
//         insertVector(ctx, v.vector, v.namespace, v.importance, v.filters)
//       )
//     );
//   },
// });

function filterFieldsFromNumbers(
  namespace: Id<"namespaces">,
  filters: NumberedFilter | undefined
): NamedFilterField {
  const filterFields: NamedFilterField = {};
  if (!filters) return filterFields;
  for (const [i, filter] of Object.entries(filters)) {
    const index = Number(i);
    if (index >= filterFieldNames.length) {
      console.warn(`Unknown filter name: ${index}`);
      break;
    }
    filterFields[filterFieldNames[index]] = [namespace, filter];
  }
  return filterFields;
}

export async function insertEmbedding(
  ctx: MutationCtx,
  embedding: number[],
  namespace: Id<"namespaces">,
  importance: number | undefined,
  filters: NumberedFilter | undefined
) {
  const filterFields = filterFieldsFromNumbers(namespace, filters);
  const dimension = validateVectorDimension(embedding.length);
  return ctx.db.insert(getVectorTableName(dimension), {
    namespace,
    vector: vectorWithImportance(embedding, importance ?? 1),
    ...filterFields,
  });
}

export async function searchEmbeddings(
  ctx: ActionCtx,
  {
    embedding,
    namespace,
    filters,
    limit,
  }: {
    embedding: number[];
    namespace: Id<"namespaces">;
    // list of ORs of filters in the form of
    // [{3: filter3}, {1: filter1}, {2: filter2}]
    // where null is a placeholder for a filter that is not used.
    filters: Array<NumberedFilter>;
    limit: number;
  }
) {
  const dimension = validateVectorDimension(embedding.length);
  const tableName = getVectorTableName(dimension);
  const orFilters = filters.flatMap((filter) =>
    filterFieldsFromNumbers(namespace, filter)
  );
  return ctx.vectorSearch(tableName, "vector", {
    vector: searchVector(embedding),
    filter: (q) =>
      q.or(
        ...orFilters.flatMap((namedFilter) =>
          Object.entries(namedFilter).map(([filterField, filter]) =>
            q.eq(filterField as keyof (typeof orFilters)[number], filter)
          )
        )
      ),
    limit,
  });
}
