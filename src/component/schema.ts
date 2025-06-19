import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import embeddingsTables from "./embeddings/tables.js";
import { typedV } from "convex-helpers/validators";

const schema = defineSchema({
  ...embeddingsTables,
});

export const vv = typedV(schema);
export { vv as v };

export default schema;
