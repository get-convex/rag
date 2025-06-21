/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema, { v } from "../schema.js";
import { api } from "../_generated/api.js";
import { modules } from "../setup.test.js";
import { insertEmbedding, searchEmbeddings } from "./index.js";
import { vectorWithImportanceDimension } from "./importance.js";
import { action } from "../_generated/server.js";
import { anyApi, type ApiFromModules } from "convex/server";

export const search = action({
  args: {
    embedding: v.array(v.number()),
    namespace: v.id("namespaces"),
    filters: v.array(v.any()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return searchEmbeddings(ctx, args);
  },
});

const testApi: ApiFromModules<{
  fns: {
    search: typeof search;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}>["fns"] = anyApi["embeddings"]["index.test"] as any;

describe("embeddings", () => {
  test("insertEmbedding with no filters or importance works", async () => {
    const t = convexTest(schema, modules);

    // Create a namespace first
    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "test-namespace",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    // Create a simple 128-dimension embedding
    const embedding = Array(128).fill(0.1);

    // Insert embedding without filters or importance
    const vectorId = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespaceId, undefined, undefined);
    });

    expect(vectorId).toBeDefined();

    // Verify the vector was inserted correctly
    const insertedVector = await t.run(async (ctx) => {
      return ctx.db.get(vectorId);
    });

    expect(insertedVector).toBeDefined();
    expect(insertedVector!.namespace).toBe(namespaceId);
    expect(insertedVector!.vector).toHaveLength(
      vectorWithImportanceDimension(128)
    );
    expect(insertedVector!.filter0).toBeUndefined();
    expect(insertedVector!.filter1).toBeUndefined();
    expect(insertedVector!.filter2).toBeUndefined();
    expect(insertedVector!.filter3).toBeUndefined();
  });

  test("insertEmbedding with importance modifies the vector", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "test-namespace-importance",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);
    const importance = 0.5;

    // Insert embedding with importance
    const vectorId = await t.run(async (ctx) => {
      return insertEmbedding(
        ctx,
        embedding,
        namespaceId,
        importance,
        undefined
      );
    });

    const insertedVector = await t.run(async (ctx) => {
      return ctx.db.get(vectorId);
    });

    expect(insertedVector).toBeDefined();
    expect(insertedVector!.vector).toHaveLength(129);

    // The importance should affect the vector - it should not be the same as without importance
    const vectorWithoutImportance = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespaceId, undefined, undefined);
    });

    const vectorWithoutImportanceData = await t.run(async (ctx) => {
      return ctx.db.get(vectorWithoutImportance);
    });

    // Vectors should be different due to importance scaling
    expect(insertedVector!.vector).not.toEqual(
      vectorWithoutImportanceData!.vector
    );

    // The last element should be the weight: sqrt(1 - importance^2)
    const expectedWeight = Math.sqrt(1 - importance ** 2);
    expect(insertedVector!.vector[128]).toBeCloseTo(expectedWeight, 5);
  });

  test("search for vectors sorted by importance when identical otherwise", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "importance-sort-test",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert same embedding with different importance levels
    await t.run(async (ctx) => {
      await insertEmbedding(ctx, embedding, namespaceId, 0.2, undefined); // Low importance
      await insertEmbedding(ctx, embedding, namespaceId, 0.8, undefined); // High importance
      await insertEmbedding(ctx, embedding, namespaceId, 0.5, undefined); // Medium importance
    });

    // Search for the vectors
    const results = await t.action(testApi.search, {
      embedding,
      namespace: namespaceId,
      filters: [],
      limit: 10,
    });

    expect(results).toHaveLength(3);

    // Results should be sorted by similarity (which correlates with importance)
    // Higher importance vectors should have higher similarity scores
    expect(results[0]._score).toBeGreaterThan(results[1]._score);
    expect(results[1]._score).toBeGreaterThan(results[2]._score);
  });

  test("filters are added to the correct field", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "filter-test",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: ["category", "priority", "status", "author"],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert embedding with filter on position 0
    const vectorId0 = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "documents",
      });
    });

    // Insert embedding with filter on position 2
    const vectorId2 = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespaceId, undefined, {
        2: "active",
      });
    });

    // Verify filters are in correct fields
    const vector0 = await t.run(async (ctx) => ctx.db.get(vectorId0));
    const vector2 = await t.run(async (ctx) => ctx.db.get(vectorId2));

    expect(vector0!.filter0).toEqual([namespaceId, "documents"]);
    expect(vector0!.filter1).toBeUndefined();
    expect(vector0!.filter2).toBeUndefined();
    expect(vector0!.filter3).toBeUndefined();

    expect(vector2!.filter0).toBeUndefined();
    expect(vector2!.filter1).toBeUndefined();
    expect(vector2!.filter2).toEqual([namespaceId, "active"]);
    expect(vector2!.filter3).toBeUndefined();
  });

  test("embeddings have namespace prefixed on filter fields", async () => {
    const t = convexTest(schema, modules);

    const namespace1Id = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "namespace1",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: ["type"],
        status: "ready",
      });
    });

    const namespace2Id = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "namespace2",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: ["type"],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert same filter value in different namespaces
    const vector1Id = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespace1Id, undefined, {
        0: "article",
      });
    });

    const vector2Id = await t.run(async (ctx) => {
      return insertEmbedding(ctx, embedding, namespace2Id, undefined, {
        0: "article",
      });
    });

    const vector1 = await t.run(async (ctx) => ctx.db.get(vector1Id));
    const vector2 = await t.run(async (ctx) => ctx.db.get(vector2Id));

    // Both have the same filter value but different namespace prefixes
    expect(vector1!.filter0).toEqual([namespace1Id, "article"]);
    expect(vector2!.filter0).toEqual([namespace2Id, "article"]);
    expect(vector1!.filter0).not.toEqual(vector2!.filter0);
  });

  test("search without filters returns only vectors in the target namespace", async () => {
    const t = convexTest(schema, modules);

    const namespace1Id = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "namespace1",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    const namespace2Id = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "namespace2",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert vectors in both namespaces
    await t.run(async (ctx) => {
      await insertEmbedding(ctx, embedding, namespace1Id, undefined, undefined);
      await insertEmbedding(ctx, embedding, namespace1Id, undefined, undefined);
      await insertEmbedding(ctx, embedding, namespace2Id, undefined, undefined);
    });

    // Search in namespace1 only
    const results1 = await t.action(testApi.search, {
      embedding,
      namespace: namespace1Id,
      filters: [],
      limit: 10,
    });

    // Search in namespace2 only
    const results2 = await t.action(testApi.search, {
      embedding,
      namespace: namespace2Id,
      filters: [],
      limit: 10,
    });

    expect(results1).toHaveLength(2);
    expect(results2).toHaveLength(1);

    // All results should be from the correct namespace
    for (const result of results1) {
      const vector = await t.run(async (ctx) => ctx.db.get(result._id));
      expect(vector!.namespace).toBe(namespace1Id);
    }

    for (const result of results2) {
      const vector = await t.run(async (ctx) => ctx.db.get(result._id));
      expect(vector!.namespace).toBe(namespace2Id);
    }
  });

  test("search with filters returns only matching vectors in namespace", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "filtered-search",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: ["category", "status"],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert vectors with different filter combinations
    await t.run(async (ctx) => {
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "articles",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "blogs",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        1: "published",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "articles",
        1: "draft",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, undefined); // No filters
    });

    // Search for articles only
    const articlesResults = await t.action(testApi.search, {
      embedding,
      namespace: namespaceId,
      filters: [{ 0: "articles" }],
      limit: 10,
    });

    expect(articlesResults).toHaveLength(2); // Two vectors with category "articles"

    // Search for published status only
    const publishedResults = await t.action(testApi.search, {
      embedding,
      namespace: namespaceId,
      filters: [{ 1: "published" }],
      limit: 10,
    });

    expect(publishedResults).toHaveLength(1); // One vector with status "published"
  });

  test("multiple filters perform OR operation", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "multi-filter-or",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: ["category", "priority"],
        status: "ready",
      });
    });

    const embedding = Array(128).fill(0.1);

    // Insert vectors with different filter values
    await t.run(async (ctx) => {
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "articles",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        0: "blogs",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        1: "high",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, {
        1: "low",
      });
      await insertEmbedding(ctx, embedding, namespaceId, undefined, undefined); // No filters
    });

    // Search with OR filters: articles OR high priority
    const orResults = await t.action(testApi.search, {
      embedding,
      namespace: namespaceId,
      filters: [
        { 0: "articles" }, // category = articles
        { 1: "high" }, // OR priority = high
      ],
      limit: 10,
    });

    expect(orResults).toHaveLength(2); // Should match both "articles" and "high priority" vectors

    // Verify the results contain the expected filters
    const vectorIds = orResults.map((r) => r._id);
    const vectors = await t.run(async (ctx) => {
      return Promise.all(vectorIds.map((id) => ctx.db.get(id)));
    });

    const hasArticles = vectors.some((v) => v!.filter0?.[1] === "articles");
    const hasHighPriority = vectors.some((v) => v!.filter1?.[1] === "high");

    expect(hasArticles).toBe(true);
    expect(hasHighPriority).toBe(true);
  });

  test("searchEmbeddings", async () => {
    const t = convexTest(schema, modules);

    const namespaceId = await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        id: "search-test",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: "ready",
      });
    });

    const embedding1 = Array(128).fill(0.1);
    embedding1[0] = 1;
    const embedding2 = Array(128).fill(0.1);
    embedding2[0] = 0;
    const searchEmbedding = Array(128).fill(0.1);
    searchEmbedding[0] = 0.8; // Closer to embedding1

    // Insert two different embeddings
    await t.run(async (ctx) => {
      await insertEmbedding(ctx, embedding1, namespaceId, undefined, undefined);
      await insertEmbedding(ctx, embedding2, namespaceId, undefined, undefined);
    });

    // Search should return results ordered by similarity
    const results = await t.action(testApi.search, {
      embedding: searchEmbedding,
      namespace: namespaceId,
      filters: [],
      limit: 10,
    });

    expect(results).toHaveLength(2);
    expect(results[0]._score).toBeGreaterThan(results[1]._score);

    // The first result should be more similar to embedding1 (0.1) than embedding2 (0.2)
    // since searchEmbedding (0.15) is closer to 0.1
    const firstVector = await t.run(async (ctx) => ctx.db.get(results[0]._id));
    expect(firstVector).toBeDefined();
  });
});
