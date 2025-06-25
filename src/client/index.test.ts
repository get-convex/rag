import { describe, expect, test } from "vitest";
import { DocumentSearch } from "./index.js";
import type { DataModelFromSchemaDefinition } from "convex/server";
import {
  anyApi,
  queryGeneric,
  mutationGeneric,
  actionGeneric,
} from "convex/server";
import type {
  ApiFromModules,
  ActionBuilder,
  MutationBuilder,
  QueryBuilder,
} from "convex/server";
import { v } from "convex/values";
import { defineSchema } from "convex/server";
import { components, initConvexTest } from "./setup.test.js";
import { openai } from "@ai-sdk/openai";
import { vSource } from "../component/schema.js";

// The schema for the tests
const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
// type DatabaseReader = GenericDatabaseReader<DataModel>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const documentSearch = new DocumentSearch(components.documentSearch, {
  embeddingDimension: 1536,
  textEmbeddingModel: openai.textEmbeddingModel("text-embedding-3-small"),
  filterNames: ["simpleString", "arrayOfStrings", "customObject"],
});

export const testQuery = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // return await documentSearch.count(ctx, args.name);
  },
});

export const testMutation = mutation({
  args: { name: v.string(), count: v.number() },
  handler: async (ctx, args) => {
    // return await documentSearch.add(ctx, args.name, args.count);
  },
});

export const upsertDocument = action({
  args: {
    key: v.string(),
    chunks: v.array(
      v.object({
        text: v.string(),
        metadata: v.record(v.string(), v.any()),
        embedding: v.array(v.number()),
      })
    ),
    namespace: v.string(),
    source: vSource,
    title: v.optional(v.string()),
    filterValues: v.optional(
      v.array(
        v.union(
          v.object({
            name: v.literal("simpleString"),
            value: v.string(),
          }),
          v.object({
            name: v.literal("arrayOfStrings"),
            value: v.array(v.string()),
          }),
          v.object({
            name: v.literal("customObject"),
            value: v.record(v.string(), v.any()),
          })
        )
      )
    ),
    importance: v.optional(v.number()),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("upserting document", args);
    return documentSearch.upsertDocument(ctx, args);
  },
});

const testApi: ApiFromModules<{
  fns: {
    testQuery: typeof testQuery;
    testMutation: typeof testMutation;
    upsertDocument: typeof upsertDocument;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}>["fns"] = anyApi["index.test"] as any;

function dummyEmbeddings(text: string) {
  return Array.from({ length: 1536 }, (_, i) =>
    i === 0 ? text.charCodeAt(0) / 256 : 0.1
  );
}

describe("DocumentSearch thick client", () => {
  test("should upsert a document and be able to list it", async () => {
    const t = initConvexTest(schema);
    const { documentId, status } = await t.action(testApi.upsertDocument, {
      key: "test",
      chunks: [
        { text: "A", metadata: {}, embedding: dummyEmbeddings("A") },
        { text: "B", metadata: {}, embedding: dummyEmbeddings("B") },
        { text: "C", metadata: {}, embedding: dummyEmbeddings("C") },
      ],
      namespace: "test",
      source: { kind: "url", url: "https://www.google.com" },
    });
    expect(documentId).toBeDefined();
    expect(status).toBe("ready");
    await t.run(async (ctx) => {
      const { isDone, page } = await documentSearch.listChunks(ctx, {
        documentId,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(page.length).toBe(3);
      expect(isDone).toBe(true);
      expect(page[0].order).toBe(0);
      expect(page[1].order).toBe(1);
      expect(page[2].order).toBe(2);
    });
  });
  test("should work from a test function", async () => {
    const t = initConvexTest(schema);
    const result = await t.mutation(testApi.testMutation, {
      name: "beans",
      count: 1,
    });
    // expect(result).toBe(1);
  });
});
