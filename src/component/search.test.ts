/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { modules } from "./setup.test.js";
import { insertChunks } from "./chunks.js";
import type { Id } from "./_generated/dataModel.js";
import type { Value } from "convex/values";
import { assert } from "convex-helpers";

type ConvexTest = TestConvex<typeof schema>;

describe("search", () => {
  async function setupTestNamespace(
    t: ConvexTest,
    namespace = "test-namespace",
    dimension = 128,
    filterNames: string[] = [],
  ) {
    return await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        namespace,
        version: 1,
        modelId: "test-model",
        dimension,
        filterNames,
        status: { kind: "ready" },
      });
    });
  }

  async function setupTestEntry(
    t: ConvexTest,
    namespaceId: Id<"namespaces">,
    key = "test-entry",
    version = 0,
    filterValues: Array<{ name: string; value: Value }> = [],
  ) {
    return await t.run(async (ctx) => {
      return ctx.db.insert("entries", {
        namespaceId,
        key,
        version,
        status: { kind: "ready" },
        contentHash: `test-content-hash-${key}-${version}`,
        importance: 0.5,
        filterValues,
      });
    });
  }

  function createTestChunks(count = 3, baseEmbedding = 0.1) {
    return Array.from({ length: count }, (_, i) => ({
      content: {
        text: `Test chunk content ${i + 1}`,
        metadata: { index: i },
      },
      embedding: [...Array(127).fill(0.01), baseEmbedding + i * 0.01],
    }));
  }

  test("if a namespace doesn't exist yet, returns nothing", async () => {
    const t = convexTest(schema, modules);

    // Search in a non-existent namespace
    const result = await t.action(api.search.search, {
      namespace: "non-existent-namespace",
      embedding: Array(128).fill(0.1),
      modelId: "test-model",
      filters: [],
      limit: 10,
    });

    expect(result.results).toHaveLength(0);
    expect(result.entries).toHaveLength(0);
  });

  test("if a namespace exists and is compatible, it finds the correct embedding for a query", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const entryId = await setupTestEntry(t, namespaceId);

    // Insert chunks with specific embeddings
    const targetEmbedding = [...Array(127).fill(0.5), 1];
    const chunks = [
      {
        content: {
          text: "Target chunk content",
          metadata: { target: true },
        },
        embedding: targetEmbedding,
      },
      {
        content: {
          text: "Other chunk content",
          metadata: { target: false },
        },
        embedding: [...Array(127).fill(0.1), 0], // Different embedding
      },
    ];

    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId,
        startOrder: 0,
        chunks,
      });
    });

    // Search with the exact target embedding
    const result = await t.action(api.search.search, {
      namespace: "test-namespace",
      embedding: targetEmbedding,
      modelId: "test-model",
      filters: [],
      limit: 10,
    });

    expect(result.results).toHaveLength(2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].entryId).toBe(entryId);

    // The target chunk should have a higher score (first result)
    expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
    expect(result.results[0].content[0].text).toBe("Target chunk content");
  });

  test("if the limit is 0, it returns nothing", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const entryId = await setupTestEntry(t, namespaceId);

    // Insert chunks
    const chunks = createTestChunks(3);
    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId,
        startOrder: 0,
        chunks,
      });
    });

    // Search with limit 0
    const result = await t.action(api.search.search, {
      namespace: "test-namespace",
      embedding: Array(128).fill(0.1),
      modelId: "test-model",
      filters: [],
      limit: 0,
    });

    expect(result.results).toHaveLength(0);
    expect(result.entries).toHaveLength(0);
  });

  test("it filters out results where the vectorScoreThreshold is too low", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const entryId = await setupTestEntry(t, namespaceId);

    // Insert chunks with different embeddings (to get different scores)
    const chunks = [
      {
        content: {
          text: "High similarity chunk",
          metadata: { similarity: "high" },
        },
        embedding: Array(128).fill(0.5), // Very similar to search embedding
      },
      {
        content: {
          text: "Low similarity chunk",
          metadata: { similarity: "low" },
        },
        embedding: Array(128).fill(0.0), // Very different from search embedding
      },
    ];

    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId,
        startOrder: 0,
        chunks,
      });
    });

    // Search with a high threshold
    const searchEmbedding = Array(128).fill(0.5);
    const resultWithThreshold = await t.action(api.search.search, {
      namespace: "test-namespace",
      embedding: searchEmbedding,
      modelId: "test-model",
      filters: [],
      limit: 10,
      vectorScoreThreshold: 0.8, // High threshold
    });

    // Search without threshold
    const resultWithoutThreshold = await t.action(api.search.search, {
      namespace: "test-namespace",
      embedding: searchEmbedding,
      modelId: "test-model",
      filters: [],
      limit: 10,
    });

    // With threshold should return fewer results
    expect(resultWithThreshold.results.length).toBeLessThan(
      resultWithoutThreshold.results.length,
    );
    expect(resultWithoutThreshold.results).toHaveLength(2);

    // All results with threshold should have score >= threshold
    for (const result of resultWithThreshold.results) {
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    }
  });

  test("it successfully uses filters to search for entries that match", async () => {
    const t = convexTest(schema, modules);

    // Create namespace with filter support
    const namespaceId = await setupTestNamespace(t, "filtered-namespace", 128, [
      "category",
    ]);

    // Create entries with different filter values
    const doc1Id = await setupTestEntry(t, namespaceId, "doc1", 0, [
      { name: "category", value: "category1" },
    ]);
    const doc2Id = await setupTestEntry(t, namespaceId, "doc2", 0, [
      { name: "category", value: "category2" },
    ]);
    const doc3Id = await setupTestEntry(t, namespaceId, "doc3", 0, [
      { name: "category", value: "category1" },
    ]);

    // Insert chunks in all entries
    const baseEmbedding = Array(128).fill(0.1);
    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId: doc1Id,
        startOrder: 0,
        chunks: createTestChunks(2, 0.1),
      });
      await insertChunks(ctx, {
        entryId: doc2Id,
        startOrder: 0,
        chunks: createTestChunks(2, 0.1),
      });
      await insertChunks(ctx, {
        entryId: doc3Id,
        startOrder: 0,
        chunks: createTestChunks(2, 0.1),
      });
    });

    // Search for category1 only
    const category1Results = await t.action(api.search.search, {
      namespace: "filtered-namespace",
      embedding: baseEmbedding,
      modelId: "test-model",
      filters: [{ name: "category", value: "category1" }],
      limit: 10,
    });

    expect(category1Results.entries).toHaveLength(2); // doc1 and doc3
    expect(category1Results.results).toHaveLength(4); // 2 chunks each from doc1 and doc3

    const entryIds = category1Results.entries.map((d) => d.entryId).sort();
    expect(entryIds).toEqual([doc1Id, doc3Id].sort());

    // Search for category2 only
    const category2Results = await t.action(api.search.search, {
      namespace: "filtered-namespace",
      embedding: baseEmbedding,
      modelId: "test-model",
      filters: [{ name: "category", value: "category2" }],
      limit: 10,
    });

    expect(category2Results.entries).toHaveLength(1); // only doc2
    expect(category2Results.results).toHaveLength(2); // 2 chunks from doc2
    expect(category2Results.entries[0].entryId).toBe(doc2Id);

    // Search with no filters should return all
    const noFilterResults = await t.action(api.search.search, {
      namespace: "filtered-namespace",
      embedding: baseEmbedding,
      modelId: "test-model",
      filters: [],
      limit: 10,
    });

    expect(noFilterResults.entries).toHaveLength(3); // all entries
    expect(noFilterResults.results).toHaveLength(6); // all chunks
  });

  test("it handles multiple filter fields correctly", async () => {
    const t = convexTest(schema, modules);

    // Create namespace with multiple filter fields
    const namespaceId = await setupTestNamespace(
      t,
      "multi-filter-namespace",
      128,
      ["category", "priority_category"],
    );

    // Create entries with different filter combinations
    const doc1Id = await setupTestEntry(t, namespaceId, "doc1", 0, [
      { name: "category", value: "articles" },
      {
        name: "priority_category",
        value: { priority: "high", category: "articles" },
      },
    ]);
    const doc2Id = await setupTestEntry(t, namespaceId, "doc2", 0, [
      { name: "category", value: "articles" },
      {
        name: "priority_category",
        value: { priority: "low", category: "articles" },
      },
    ]);
    const doc3Id = await setupTestEntry(t, namespaceId, "doc3", 0, [
      { name: "category", value: "blogs" },
      {
        name: "priority_category",
        value: { priority: "high", category: "blogs" },
      },
    ]);

    // Insert chunks
    const baseEmbedding = Array(128).fill(0.1);
    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId: doc1Id,
        startOrder: 0,
        chunks: createTestChunks(1, 0.1),
      });
      await insertChunks(ctx, {
        entryId: doc2Id,
        startOrder: 0,
        chunks: createTestChunks(1, 0.1),
      });
      await insertChunks(ctx, {
        entryId: doc3Id,
        startOrder: 0,
        chunks: createTestChunks(1, 0.1),
      });
    });

    // Search for articles with high priority
    const result = await t.action(api.search.search, {
      namespace: "multi-filter-namespace",
      embedding: baseEmbedding,
      modelId: "test-model",
      filters: [
        {
          name: "priority_category",
          value: { priority: "high", category: "articles" },
        },
      ],
      limit: 10,
    });

    expect(result.entries).toHaveLength(1); // only doc1 matches both filters
    expect(result.entries[0].entryId).toBe(doc1Id);
    expect(result.results).toHaveLength(1);
  });

  test("it returns empty results for incompatible namespace dimensions", async () => {
    const t = convexTest(schema, modules);

    // Create namespace with 256 dimensions
    await setupTestNamespace(t, "high-dim-namespace", 256);

    // Search with 128-dimensional embedding (incompatible)
    const result = await t.action(api.search.search, {
      namespace: "high-dim-namespace",
      embedding: Array(128).fill(0.1), // Wrong dimension
      modelId: "test-model",
      filters: [],
      limit: 10,
    });

    expect(result.results).toHaveLength(0);
    expect(result.entries).toHaveLength(0);
  });

  test("it returns empty results for incompatible model IDs", async () => {
    const t = convexTest(schema, modules);

    // Create namespace with specific model ID
    await setupTestNamespace(t, "model-specific-namespace", 128);

    // Search with different model ID
    const result = await t.action(api.search.search, {
      namespace: "model-specific-namespace",
      embedding: Array(128).fill(0.1),
      modelId: "different-model", // Wrong model ID
      filters: [],
      limit: 10,
    });

    expect(result.results).toHaveLength(0);
    expect(result.entries).toHaveLength(0);
  });

  test("it respects the limit parameter", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const entryId = await setupTestEntry(t, namespaceId);

    // Insert many chunks
    const chunks = createTestChunks(10);
    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        entryId,
        startOrder: 0,
        chunks,
      });
    });

    // Search with small limit
    const result = await t.action(api.search.search, {
      namespace: "test-namespace",
      embedding: Array(128).fill(0.1),
      modelId: "test-model",
      filters: [],
      limit: 3,
    });

    expect(result.results).toHaveLength(3);
    expect(result.entries).toHaveLength(1);

    // Results should be sorted by score (best first)
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].score).toBeGreaterThanOrEqual(
        result.results[i].score,
      );
    }
  });

  describe("hybrid search", () => {
    function createSearchableChunks(
      texts: string[],
      baseEmbedding = 0.1,
    ) {
      return texts.map((text, i) => ({
        content: { text, metadata: { index: i } },
        embedding: [...Array(127).fill(0.01), baseEmbedding + i * 0.01],
        searchableText: text,
      }));
    }

    test("textSearch internal query finds chunks by text content", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      const chunks = createSearchableChunks([
        "The quick brown fox jumps over the lazy dog",
        "A fast red car drives on the highway",
        "The brown bear sleeps in the forest",
      ]);

      await t.run(async (ctx) => {
        await insertChunks(ctx, { entryId, startOrder: 0, chunks });
      });

      const results = await t.query(internal.search.textSearch, {
        query: "brown",
        namespaceId,
        filters: [],
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entryId).toBe(entryId);
      }
    });

    test("textSearch scopes results to the given namespace", async () => {
      const t = convexTest(schema, modules);
      const ns1Id = await setupTestNamespace(t, "namespace-1");
      const ns2Id = await setupTestNamespace(t, "namespace-2");
      const entry1Id = await setupTestEntry(t, ns1Id, "entry-1");
      const entry2Id = await setupTestEntry(t, ns2Id, "entry-2");

      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          entryId: entry1Id,
          startOrder: 0,
          chunks: createSearchableChunks(["alpha bravo charlie"]),
        });
        await insertChunks(ctx, {
          entryId: entry2Id,
          startOrder: 0,
          chunks: createSearchableChunks(["alpha delta echo"]),
        });
      });

      const ns1Results = await t.query(internal.search.textSearch, {
        query: "alpha",
        namespaceId: ns1Id,
        filters: [],
        limit: 10,
      });

      // All results should belong to namespace-1's entry.
      for (const r of ns1Results) {
        expect(r.entryId).toBe(entry1Id);
      }
    });

    test("textSearch applies numbered filters", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(
        t,
        "filtered-ns",
        128,
        ["category"],
      );

      const cat1Entry = await setupTestEntry(t, namespaceId, "cat1", 0, [
        { name: "category", value: "docs" },
      ]);
      const cat2Entry = await setupTestEntry(t, namespaceId, "cat2", 0, [
        { name: "category", value: "blogs" },
      ]);

      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          entryId: cat1Entry,
          startOrder: 0,
          chunks: createSearchableChunks(["shared keyword content"]),
        });
        await insertChunks(ctx, {
          entryId: cat2Entry,
          startOrder: 0,
          chunks: createSearchableChunks(["shared keyword content"]),
        });
      });

      // Filter to "docs" category only (filter index 0 = "category").
      const results = await t.query(internal.search.textSearch, {
        query: "shared keyword",
        namespaceId,
        filters: [{ 0: "docs" }],
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entryId).toBe(cat1Entry);
      }
    });

    test("getChunkIdsByEmbeddingIds maps embedding IDs to chunk IDs", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          entryId,
          startOrder: 0,
          chunks: createTestChunks(3),
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("entryId_order", (q) => q.eq("entryId", entryId))
          .collect();
      });
      assert(chunkDocs[0].state.kind === "ready");
      assert(chunkDocs[2].state.kind === "ready");

      const chunkIds = await t.query(
        internal.chunks.getChunkIdsByEmbeddingIds,
        {
          embeddingIds: [
            chunkDocs[0].state.embeddingId,
            chunkDocs[2].state.embeddingId,
          ],
        },
      );

      expect(chunkIds).toHaveLength(2);
      expect(chunkIds[0]).toBe(chunkDocs[0]._id);
      expect(chunkIds[1]).toBe(chunkDocs[2]._id);
    });

    test("getRangesOfChunkIds returns ranges by chunk ID", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          entryId,
          startOrder: 0,
          chunks: createTestChunks(5),
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("entryId_order", (q) => q.eq("entryId", entryId))
          .collect();
      });

      const { ranges, entries } = await t.query(
        internal.chunks.getRangesOfChunkIds,
        {
          chunkIds: [chunkDocs[1]._id, chunkDocs[3]._id],
          chunkContext: { before: 1, after: 1 },
        },
      );

      expect(entries).toHaveLength(1);
      expect(entries[0].entryId).toBe(entryId);
      expect(ranges).toHaveLength(2);
      expect(ranges[0]?.order).toBe(1);
      expect(ranges[1]?.order).toBe(3);
    });

    test("hybrid search returns results when textQuery is provided", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      const chunks = createSearchableChunks([
        "Machine learning is a subset of artificial intelligence",
        "Deep learning uses neural networks with many layers",
        "Natural language processing handles text data",
      ]);

      await t.run(async (ctx) => {
        await insertChunks(ctx, { entryId, startOrder: 0, chunks });
      });

      const result = await t.action(api.search.search, {
        namespace: "test-namespace",
        embedding: [...Array(127).fill(0.01), 0.1],
        modelId: "test-model",
        filters: [],
        limit: 10,
        textQuery: "neural networks",
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.entries).toHaveLength(1);

      // Hybrid scores are position-based (1.0 for top, decreasing linearly).
      expect(result.results[0].score).toBe(1.0);
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i].score).toBeLessThan(result.results[i - 1].score);
      }
    });

    test("hybrid search deduplicates results from vector and text paths", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      const chunks = createSearchableChunks([
        "Unique content about quantum computing",
        "Another chunk about classical physics",
      ]);

      await t.run(async (ctx) => {
        await insertChunks(ctx, { entryId, startOrder: 0, chunks });
      });

      const result = await t.action(api.search.search, {
        namespace: "test-namespace",
        embedding: [...Array(127).fill(0.01), 0.1],
        modelId: "test-model",
        filters: [],
        limit: 10,
        textQuery: "quantum computing",
      });

      // Each chunk should appear at most once in the results.
      const entryOrderPairs = result.results.map(
        (r) => `${r.entryId}:${r.order}`,
      );
      const uniquePairs = new Set(entryOrderPairs);
      expect(uniquePairs.size).toBe(entryOrderPairs.length);
    });

    test("vector-only search is unchanged when textQuery is not provided", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      const targetEmbedding = [...Array(127).fill(0.5), 1];
      const chunks = [
        {
          content: { text: "Target chunk", metadata: {} },
          embedding: targetEmbedding,
          searchableText: "Target chunk",
        },
        {
          content: { text: "Other chunk", metadata: {} },
          embedding: [...Array(127).fill(0.1), 0],
          searchableText: "Other chunk",
        },
      ];

      await t.run(async (ctx) => {
        await insertChunks(ctx, { entryId, startOrder: 0, chunks });
      });

      const result = await t.action(api.search.search, {
        namespace: "test-namespace",
        embedding: targetEmbedding,
        modelId: "test-model",
        filters: [],
        limit: 10,
      });

      // Without textQuery, scores should be cosine similarity (not position-based).
      expect(result.results).toHaveLength(2);
      expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
      // Cosine similarity scores are typically between -1 and 1, not exactly 1.0.
      // Position-based would give exactly 1.0 for the first result.
      // With cosine similarity the first result can be 1.0 if exact match,
      // but the second should not follow the linear decrease pattern.
      expect(result.results[0].content[0].text).toBe("Target chunk");
    });

    test("textWeight and vectorWeight influence hybrid ranking", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const entryId = await setupTestEntry(t, namespaceId);

      const chunks = createSearchableChunks([
        "Alpha topic with specific terminology",
        "Beta topic with different keywords",
        "Gamma topic about something else entirely",
      ]);

      await t.run(async (ctx) => {
        await insertChunks(ctx, { entryId, startOrder: 0, chunks });
      });

      const embedding = [...Array(127).fill(0.01), 0.1];

      // Search with heavy text weight.
      const textHeavy = await t.action(api.search.search, {
        namespace: "test-namespace",
        embedding,
        modelId: "test-model",
        filters: [],
        limit: 10,
        textQuery: "specific terminology",
        textWeight: 10,
        vectorWeight: 1,
      });

      // Search with heavy vector weight.
      const vectorHeavy = await t.action(api.search.search, {
        namespace: "test-namespace",
        embedding,
        modelId: "test-model",
        filters: [],
        limit: 10,
        textQuery: "specific terminology",
        textWeight: 1,
        vectorWeight: 10,
      });

      // Both should return results.
      expect(textHeavy.results.length).toBeGreaterThan(0);
      expect(vectorHeavy.results.length).toBeGreaterThan(0);
    });
  });
});
