import { literals } from "convex-helpers/validators";
import {
  defineTable,
  type GenericTableSearchIndexes,
  type SchemaDefinition,
  type TableDefinition,
} from "convex/server";
import {
  type GenericId,
  type ObjectType,
  v,
  type VId,
  type VObject,
  type VUnion,
} from "convex/values";
import { vectorWithImportanceDimension } from "./importance.js";
import { allFilterFieldNames, vAllFilterFields } from "../filters.js";

// We only generate embeddings for non-tool, non-system messages
const embeddingsFields = {
  vector: v.array(v.number()),
  ...vAllFilterFields,
};

function table(dimensions: VectorDimension): Table {
  return defineTable(embeddingsFields).vectorIndex("vector", {
    vectorField: "vector",
    dimensions: vectorWithImportanceDimension(dimensions),
    filterFields: allFilterFieldNames,
  });
}

type Table = TableDefinition<
  VObject<ObjectType<typeof embeddingsFields>, typeof embeddingsFields>,
  { model_table_threadId: ["model", "table", "threadId", "_creationTime"] },
  GenericTableSearchIndexes,
  VectorIndex
>;

type VectorIndex = {
  vector: {
    vectorField: "vector";
    dimensions: number;
    filterFields: string;
  };
};

export type VectorSchema = SchemaDefinition<
  { [key in VectorTableName]: Table },
  true
>;

export const VectorDimensions = [
  128, 256, 512, 768, 1024, 1408, 1536, 2048, 3072, 4096,
] as const;

export function assertVectorDimension(
  dimension: number
): asserts dimension is VectorDimension {
  if (!VectorDimensions.includes(dimension as VectorDimension)) {
    throw new Error(
      `Unsupported vector dimension${dimension}. Supported: ${VectorDimensions.join(", ")}`
    );
  }
}

export function validateVectorDimension(dimension: number): VectorDimension {
  if (!VectorDimensions.includes(dimension as VectorDimension)) {
    throw new Error(
      `Unsupported vector dimension${dimension}. Supported: ${VectorDimensions.join(", ")}`
    );
  }
  return dimension as VectorDimension;
}
export type VectorDimension = (typeof VectorDimensions)[number];
export const VectorTableNames = VectorDimensions.map(
  (d) => `embeddings_${d}`
) as `embeddings_${(typeof VectorDimensions)[number]}`[];
export type VectorTableName = (typeof VectorTableNames)[number];
export type VectorTableId = GenericId<(typeof VectorTableNames)[number]>;

export const vVectorDimension = literals(...VectorDimensions);
export const vVectorTableName = literals(...VectorTableNames);
export const vVectorId = v.union(
  ...VectorTableNames.map((name) => v.id(name))
) as VUnion<
  GenericId<(typeof VectorTableNames)[number]>,
  VId<(typeof VectorTableNames)[number]>[]
>;

export function getVectorTableName(dimension: VectorDimension) {
  return `embeddings_${dimension}` as VectorTableName;
}
// export function getVectorIdInfo(ctx: QueryCtx, id: VectorTableId) {
//   for (const dimension of VectorDimensions) {
//     const tableName = getVectorTableName(dimension);
//     if (ctx.db.normalizeId(tableName, id)) {
//       return { tableName, dimension };
//     }
//   }
//   throw new Error(`Unknown vector table id: ${id}`);
// }

const tables: {
  [K in keyof typeof VectorDimensions &
    number as `embeddings_${(typeof VectorDimensions)[K]}`]: Table;
} = Object.fromEntries(
  VectorDimensions.map((dimensions) => [
    `embeddings_${dimensions}`,
    table(dimensions),
  ])
) as Record<`embeddings_${(typeof VectorDimensions)[number]}`, Table>;

export default tables;
