/**
 * This file is the interface for interacting with embeddings.
 * It translates from embeddings to the underlying vector storage and search.
 * It modifies embeddings to include importance.
 * The outer world deals with filters with user names.
 * The underlying vector storage has its own names.
 * This file takes in numbered filters (0-3) to translate without knowing about
 * user names.
 */
import type { Id } from "../_generated/dataModel.js";
import { type ActionCtx, type MutationCtx } from "../_generated/server.js";
import { getVectorTableName, validateVectorDimension } from "./tables.js";
import { filterFieldsFromNumbers, type NumberedFilter } from "../filters.js";
import { searchVector, vectorWithImportance } from "./importance.js";

// TODO: see if this is needed.
// export const insertBatch = mutation({
//   args: {
//     vectorDimension: vVectorDimension,
//     vectors: v.array(
//       v.object({
//         vector: v.array(v.number()),
//         namespace: v.id("namespaces"),
//         importance: v.optional(v.number()),
//         filters: v.optional(v.any()),
//       })
//     ),
//   },
//   returns: v.array(vVectorId),
//   handler: async (ctx, args) => {
//     return Promise.all(
//       args.vectors.map(async (vector) =>
//         insertEmbedding(
//           ctx,
//           vector.vector,
//           vector.namespace,
//           vector.importance,
//           vector.filters
//         )
//       )
//     );
//   },
// });


export async function insertEmbedding(
  ctx: MutationCtx,
  embedding: number[],
  namespaceId: Id<"namespaces">,
  importance: number | undefined,
  filters: NumberedFilter | undefined
) {
  const filterFields = filterFieldsFromNumbers(namespaceId, filters);
  const dimension = validateVectorDimension(embedding.length);
  return ctx.db.insert(getVectorTableName(dimension), {
    namespaceId,
    vector: vectorWithImportance(embedding, importance ?? 1),
    ...filterFields,
  });
}

export async function searchEmbeddings(
  ctx: ActionCtx,
  {
    embedding,
    namespaceId,
    filters,
    limit,
  }: {
    embedding: number[];
    namespaceId: Id<"namespaces">;
    // NOTE: Current vector search supports OR logic between filters
    // Multiple filters will match if ANY condition is met
    // e.g. [{3: filter3}, {1: filter1}, {2: filter2}] will match if any of
    // filter3, filter1, or filter2 is present.
    filters: Array<NumberedFilter>;
    limit: number;
  }
) {
  const dimension = validateVectorDimension(embedding.length);
  const tableName = getVectorTableName(dimension);
  const orFilters = filters.flatMap((filter) =>
    filterFieldsFromNumbers(namespaceId, filter)
  );
  return ctx.vectorSearch(tableName, "vector", {
    vector: searchVector(embedding),
    filter: (q) =>
      orFilters.length === 0
        ? q.eq("namespaceId", namespaceId)
        : q.or(
            ...orFilters.flatMap((namedFilter) =>
              Object.entries(namedFilter).map(([filterField, filter]) =>
                q.eq(filterField as keyof (typeof orFilters)[number], filter)
              )
            )
          ),
    limit,
  });
}
