/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { modules } from "./setup.test.js";
import { insertChunks, deleteChunksPage } from "./chunks.js";
import type { Id } from "./_generated/dataModel.js";
import { assert } from "convex-helpers";

type ConvexTest = TestConvex<typeof schema>;

describe("chunks", () => {
  async function setupTestNamespace(t: ConvexTest) {
    return await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        namespace: "test-namespace",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames: [],
        status: { kind: "ready" },
      });
    });
  }

  async function setupTestDocument(
    t: ConvexTest,
    namespaceId: Id<"namespaces">,
    key = "test-doc",
    version = 0,
    status: "ready" | "pending" = "ready"
  ) {
    return await t.run(async (ctx) => {
      return ctx.db.insert("documents", {
        namespaceId,
        key,
        version,
        status: { kind: status },
        contentHash: `test-content-hash-${key}-${version}`,
        importance: 0.5,
        filterValues: [],
        source: { kind: "url", url: "https://example.com/test" },
      });
    });
  }

  function createTestChunks(count = 3) {
    return Array.from({ length: count }, (_, i) => ({
      content: {
        text: `Test chunk content ${i + 1}`,
        metadata: { index: i },
      },
      embedding: Array(128).fill(0.1 + i * 0.01),
    }));
  }

  test("inserting chunks when there's no document throws error", async () => {
    const t = convexTest(schema, modules);
    await setupTestNamespace(t);

    // Try to insert chunks for a non-existent document
    const nonExistentDocId = "j57c3xc4x6j3c4x6j3c4x6j3c4x6" as Id<"documents">;
    const chunks = createTestChunks(2);

    await expect(
      t.run(async (ctx) => {
        return insertChunks(ctx, {
          documentId: nonExistentDocId,
          startOrder: 0,
          chunks,
        });
      })
    ).rejects.toThrow(`Document ${nonExistentDocId} not found`);
  });

  test("overwriting chunks with insert works", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const documentId = await setupTestDocument(t, namespaceId);

    // Insert initial chunks
    const initialChunks = createTestChunks(3);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks: initialChunks,
      });
    });

    // Verify initial chunks exist
    const initialChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
        .collect();
    });
    expect(initialChunksList).toHaveLength(3);

    // Overwrite chunks 1 and 2 with new content
    const overwriteChunks = [
      {
        content: {
          text: "Overwritten chunk 1 content",
          metadata: { overwritten: true, index: 1 },
        },
        embedding: Array(128).fill(0.9),
      },
      {
        content: {
          text: "Overwritten chunk 2 content",
          metadata: { overwritten: true, index: 2 },
        },
        embedding: Array(128).fill(0.8),
      },
    ];

    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId,
        startOrder: 1,
        chunks: overwriteChunks,
      });
    });

    // Verify total chunks is still correct (original chunk 0 + 2 overwritten)
    const finalChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
        .collect();
    });
    expect(finalChunksList).toHaveLength(3);

    // Verify the overwritten chunks have new content
    const overwrittenChunk1 = finalChunksList.find((c) => c.order === 1);
    const overwrittenChunk2 = finalChunksList.find((c) => c.order === 2);

    expect(overwrittenChunk1).toBeDefined();
    expect(overwrittenChunk2).toBeDefined();

    const content1 = await t.run(async (ctx) =>
      ctx.db.get(overwrittenChunk1!.contentId)
    );
    const content2 = await t.run(async (ctx) =>
      ctx.db.get(overwrittenChunk2!.contentId)
    );

    expect(content1!.text).toBe("Overwritten chunk 1 content");
    expect(content1!.metadata?.overwritten).toBe(true);
    expect(content2!.text).toBe("Overwritten chunk 2 content");
    expect(content2!.metadata?.overwritten).toBe(true);
  });

  test("when replacing an older version, older one is marked as replaced and only new one shows up in search results", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    // Create version 1 of document
    const docV1Id = await setupTestDocument(t, namespaceId, "versioned-doc", 1);

    // Insert chunks in version 1
    const v1Chunks = createTestChunks(2);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId: docV1Id,
        startOrder: 0,
        chunks: v1Chunks,
      });
    });

    // Create version 2 of the same document
    const docV2Id = await setupTestDocument(t, namespaceId, "versioned-doc", 2);

    // Insert chunks in version 2 (this should mark v1 chunks as replaced)
    const v2Chunks = createTestChunks(2);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId: docV2Id,
        startOrder: 0,
        chunks: v2Chunks,
      });
    });

    // Run replaceChunksPage to actually perform the replacement
    let isDone = false;
    let startOrder = 0;
    while (!isDone) {
      const result = await t.mutation(api.chunks.replaceChunksPage, {
        documentId: docV2Id,
        startOrder,
      });
      isDone = result.status !== "pending";
      startOrder = result.nextStartOrder;
    }

    // Check that v1 chunks are marked as replaced
    const v1ChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", docV1Id))
        .collect();
    });

    for (const chunk of v1ChunksList) {
      if (chunk.state.kind !== "pending") {
        expect(chunk.state.kind).toBe("replaced");
      }
    }

    // Check that v2 chunks are ready
    const v2ChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", docV2Id))
        .collect();
    });

    for (const chunk of v2ChunksList) {
      expect(chunk.state.kind).toBe("ready");
    }
  });

  test("chunks can be created on different documents and fetched separately", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    // Create two documents
    const doc1Id = await setupTestDocument(t, namespaceId, "doc1");
    const doc2Id = await setupTestDocument(t, namespaceId, "doc2");

    // Insert chunks in both documents
    const doc1Chunks = createTestChunks(5);
    const doc2Chunks = createTestChunks(3);

    await t.run(async (ctx) => {
      await insertChunks(ctx, {
        documentId: doc1Id,
        startOrder: 0,
        chunks: doc1Chunks,
      });
      return insertChunks(ctx, {
        documentId: doc2Id,
        startOrder: 0,
        chunks: doc2Chunks,
      });
    });

    // Verify chunks exist in both documents
    const doc1ChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", doc1Id))
        .collect();
    });

    const doc2ChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", doc2Id))
        .collect();
    });

    expect(doc1ChunksList).toHaveLength(5);
    expect(doc2ChunksList).toHaveLength(3);

    // Verify chunk order and content
    expect(doc1ChunksList[0].order).toBe(0);
    expect(doc1ChunksList[4].order).toBe(4);
    expect(doc2ChunksList[0].order).toBe(0);
    expect(doc2ChunksList[2].order).toBe(2);

    // Verify chunk content
    const doc1Content0 = await t.run(async (ctx) =>
      ctx.db.get(doc1ChunksList[0].contentId)
    );
    const doc2Content0 = await t.run(async (ctx) =>
      ctx.db.get(doc2ChunksList[0].contentId)
    );

    expect(doc1Content0!.text).toBe("Test chunk content 1");
    expect(doc2Content0!.text).toBe("Test chunk content 1");
  });

  test("chunks support zero-range queries", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const documentId = await setupTestDocument(t, namespaceId);

    // Insert chunks
    const chunks = createTestChunks(5);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks,
      });
    });

    // Get a single chunk (simulating zero range)
    const singleChunk = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) =>
          q.eq("documentId", documentId).eq("order", 2)
        )
        .first();
    });

    expect(singleChunk).toBeDefined();
    expect(singleChunk!.order).toBe(2);

    // Verify content
    const content = await t.run(async (ctx) =>
      ctx.db.get(singleChunk!.contentId)
    );
    expect(content!.text).toBe("Test chunk content 3");
  });

  test("deleting pages should work", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const documentId = await setupTestDocument(t, namespaceId);

    // Insert a large number of chunks
    const chunks = createTestChunks(10);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks,
      });
    });

    // Verify chunks exist
    const initialChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
        .collect();
    });
    expect(initialChunksList).toHaveLength(10);

    // Delete chunks starting from order 3
    const deleteResult = await t.run(async (ctx) => {
      return deleteChunksPage(ctx, {
        documentId,
        startOrder: 3,
      });
    });

    expect(deleteResult.isDone).toBe(true);

    // Verify only first 3 chunks remain
    const remainingChunksList = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
        .collect();
    });
    expect(remainingChunksList).toHaveLength(3);

    // Verify the remaining chunks are orders 0, 1, 2
    const orders = remainingChunksList.map((c) => c.order).sort();
    expect(orders).toEqual([0, 1, 2]);

    // Verify content was also deleted
    const allContent = await t.run(async (ctx) => {
      return ctx.db.query("content").collect();
    });
    // Should have only 3 content records remaining (for the 3 remaining chunks)
    expect(allContent).toHaveLength(3);
  });

  test("listing chunks returns correct pagination", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);
    const documentId = await setupTestDocument(t, namespaceId);

    // Insert chunks
    const chunks = createTestChunks(5);
    await t.run(async (ctx) => {
      return insertChunks(ctx, {
        documentId,
        startOrder: 0,
        chunks,
      });
    });

    // Test listing with pagination
    const result = await t.query(api.chunks.list, {
      documentId,
      paginationOpts: { numItems: 3, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.isDone).toBe(false);

    // Verify chunk content and order
    expect(result.page[0].order).toBe(0);
    expect(result.page[0].text).toBe("Test chunk content 1");
    expect(result.page[0].state).toBe("ready");

    expect(result.page[1].order).toBe(1);
    expect(result.page[1].text).toBe("Test chunk content 2");

    expect(result.page[2].order).toBe(2);
    expect(result.page[2].text).toBe("Test chunk content 3");

    // Get next page
    const nextResult = await t.query(api.chunks.list, {
      documentId,
      paginationOpts: { numItems: 3, cursor: result.continueCursor },
    });

    expect(nextResult.page).toHaveLength(2);
    expect(nextResult.isDone).toBe(true);
    expect(nextResult.page[0].order).toBe(3);
    expect(nextResult.page[1].order).toBe(4);
  });

  describe("getRangesOfChunks", () => {
    test("it returns the correct number of chunks when given a range", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert chunks
      const chunks = createTestChunks(5);
      await t.run(async (ctx) => {
        const result = await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
        expect(result.status).toBe("ready");
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs.length === 5);
      assert(chunkDocs[2].state.kind === "ready");

      const { ranges, documents } = await t.query(
        internal.chunks.getRangesOfChunks,
        {
          embeddingIds: [chunkDocs[2].state.embeddingId],
          chunkContext: { before: 1, after: 2 },
        }
      );
      expect(documents).toHaveLength(1);
      expect(documents[0].documentId).toBe(documentId);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.startOrder).toBe(1);
      expect(ranges[0]?.order).toBe(2);
      expect(ranges[0]?.documentId).toBe(documentId);
      expect(ranges[0]?.content).toHaveLength(4);
      expect(ranges[0]?.content[0].text).toBe("Test chunk content 2");
      expect(ranges[0]?.content[1].text).toBe("Test chunk content 3");
      expect(ranges[0]?.content[2].text).toBe("Test chunk content 4");
      expect(ranges[0]?.content[3].text).toBe("Test chunk content 5");
    });

    test("works finding chunks from multiple documents", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);

      // Create two documents
      const doc1Id = await setupTestDocument(t, namespaceId, "doc1");
      const doc2Id = await setupTestDocument(t, namespaceId, "doc2");

      // Insert chunks in both documents
      const doc1Chunks = createTestChunks(3);
      const doc2Chunks = createTestChunks(4);

      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId: doc1Id,
          startOrder: 0,
          chunks: doc1Chunks,
        });
        await insertChunks(ctx, {
          documentId: doc2Id,
          startOrder: 0,
          chunks: doc2Chunks,
        });
      });

      // Get chunks from both documents
      const doc1ChunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", doc1Id))
          .collect();
      });
      const doc2ChunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", doc2Id))
          .collect();
      });

      assert(doc1ChunkDocs[1].state.kind === "ready");
      assert(doc2ChunkDocs[2].state.kind === "ready");

      const { ranges, documents } = await t.query(
        internal.chunks.getRangesOfChunks,
        {
          embeddingIds: [
            doc1ChunkDocs[1].state.embeddingId, // doc1, chunk at order 1
            doc2ChunkDocs[2].state.embeddingId, // doc2, chunk at order 2
          ],
          chunkContext: { before: 1, after: 1 },
        }
      );

      expect(documents).toHaveLength(2);
      expect(ranges).toHaveLength(2);

      // First range should be from doc1
      expect(ranges[0]?.documentId).toBe(doc1Id);
      expect(ranges[0]?.order).toBe(1);
      expect(ranges[0]?.startOrder).toBe(0);
      expect(ranges[0]?.content).toHaveLength(3); // orders 0, 1, 2

      // Second range should be from doc2
      expect(ranges[1]?.documentId).toBe(doc2Id);
      expect(ranges[1]?.order).toBe(2);
      expect(ranges[1]?.startOrder).toBe(1);
      expect(ranges[1]?.content).toHaveLength(3); // orders 1, 2, 3
    });

    test("finds chunks on both a ready and replaced version of the same document", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);

      // Create version 1 (ready) and version 2 (ready) of the same document
      // (We'll test with ready versions since pending chunks don't have embeddingIds)
      const docV1Id = await setupTestDocument(
        t,
        namespaceId,
        "versioned-doc",
        1,
        "ready"
      );

      // Insert chunks in version 1
      const v1Chunks = createTestChunks(3);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId: docV1Id,
          startOrder: 0,
          chunks: v1Chunks,
        });
      });

      const docV2Id = await setupTestDocument(
        t,
        namespaceId,
        "versioned-doc",
        2,
        "pending"
      );

      // Insert chunks in version 2
      const v2Chunks = createTestChunks(3);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId: docV2Id,
          startOrder: 0,
          chunks: v2Chunks,
        });
      });
      while (true) {
        const result = await t.mutation(api.chunks.replaceChunksPage, {
          documentId: docV2Id,
          startOrder: 0,
        });
        if (result.status !== "pending") {
          break;
        }
      }

      // Get chunks from both versions
      const v1ChunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", docV1Id))
          .collect();
      });
      const v2ChunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", docV2Id))
          .collect();
      });

      expect(v1ChunkDocs[1].state.kind).toBe("replaced");
      expect(v2ChunkDocs[1].state.kind).toBe("ready");

      // Type guard to ensure we have ready chunks
      assert(v1ChunkDocs[1].state.kind === "replaced");
      assert(v2ChunkDocs[1].state.kind === "ready");

      const { ranges, documents } = await t.query(
        internal.chunks.getRangesOfChunks,
        {
          embeddingIds: [
            v1ChunkDocs[1].state.embeddingId, // v1, chunk at order 1
            v2ChunkDocs[1].state.embeddingId, // v2, chunk at order 1
          ],
          chunkContext: { before: 1, after: 1 },
        }
      );

      expect(documents).toHaveLength(2);
      expect(ranges).toHaveLength(2);
      expect(ranges[0]?.documentId).toBe(docV1Id);
      expect(ranges[0]?.order).toBe(1);
      expect(ranges[1]?.documentId).toBe(docV2Id);
      expect(ranges[1]?.order).toBe(1);
    });

    test("finds chunks before and after a chunk", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert chunks
      const chunks = createTestChunks(7);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs[3].state.kind === "ready");

      const { ranges } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [chunkDocs[3].state.embeddingId], // chunk at order 3
        chunkContext: { before: 2, after: 2 },
      });

      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.order).toBe(3);
      expect(ranges[0]?.startOrder).toBe(1); // 3 - 2 = 1
      expect(ranges[0]?.content).toHaveLength(5); // orders 1, 2, 3, 4, 5
      expect(ranges[0]?.content[0].text).toBe("Test chunk content 2"); // order 1
      expect(ranges[0]?.content[1].text).toBe("Test chunk content 3"); // order 2
      expect(ranges[0]?.content[2].text).toBe("Test chunk content 4"); // order 3 (target)
      expect(ranges[0]?.content[3].text).toBe("Test chunk content 5"); // order 4
      expect(ranges[0]?.content[4].text).toBe("Test chunk content 6"); // order 5
    });

    test("accepts ranges outside of the document order bounds", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert only 3 chunks (orders 0, 1, 2)
      const chunks = createTestChunks(3);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs[2].state.kind === "ready");

      // Request a large range that extends beyond document bounds
      const { ranges } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [chunkDocs[2].state.embeddingId], // chunk at order 2
        chunkContext: { before: 5, after: 5 }, // Large range
      });

      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.order).toBe(2);
      expect(ranges[0]?.startOrder).toBe(0); // Should be clamped to 0
      expect(ranges[0]?.content).toHaveLength(3); // All available chunks (0, 1, 2)
      expect(ranges[0]?.content[0].text).toBe("Test chunk content 1"); // order 0
      expect(ranges[0]?.content[1].text).toBe("Test chunk content 2"); // order 1
      expect(ranges[0]?.content[2].text).toBe("Test chunk content 3"); // order 2
    });

    test("when two ranges overlap, the later range gets priority on the chunks in between", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert chunks
      const chunks = createTestChunks(10);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs[2].state.kind === "ready");
      assert(chunkDocs[6].state.kind === "ready");

      const { ranges } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [
          chunkDocs[2].state.embeddingId, // chunk at order 2
          chunkDocs[6].state.embeddingId, // chunk at order 6
        ],
        chunkContext: { before: 3, after: 3 },
      });

      expect(ranges).toHaveLength(2);

      // First range (order 2): should stop before the second range's territory
      expect(ranges[0]?.order).toBe(2);
      expect(ranges[0]?.startOrder).toBe(0);
      // The end should be limited by the second range's before context
      expect(ranges[0]?.content.length).toBe(3); // orders 0, 1, 2

      // Second range (order 6): should get priority for overlapping chunks
      expect(ranges[1]?.order).toBe(6);
      expect(ranges[1]?.startOrder).toBe(3); // start at 6, 3 before
      expect(ranges[1]?.content).toHaveLength(7); // orders 3, 4, 5, 6, 7, 8, 9
    });

    test("when three ranges overlap, the middle chunk gets priority on before chunk but not after chunk", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert chunks
      const chunks = createTestChunks(15);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs[2].state.kind === "ready");
      assert(chunkDocs[7].state.kind === "ready");
      assert(chunkDocs[12].state.kind === "ready");

      const { ranges } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [
          chunkDocs[2].state.embeddingId, // chunk at order 2
          chunkDocs[7].state.embeddingId, // chunk at order 7 (middle)
          chunkDocs[12].state.embeddingId, // chunk at order 12
        ],
        chunkContext: { before: 4, after: 4 },
      });

      expect(ranges).toHaveLength(3);

      // First range (order 2)
      expect(ranges[0]?.order).toBe(2);
      expect(ranges[0]?.startOrder).toBe(0);

      // Middle range (order 7): should get priority over first range's after context
      expect(ranges[1]?.order).toBe(7);
      expect(ranges[1]?.startOrder).toBe(3); // Should start after first range's territory

      // Last range (order 12): should get priority over middle range's after context
      expect(ranges[2]?.order).toBe(12);
      expect(ranges[2]?.startOrder).toBe(8); // Should start after middle range's territory
      expect(ranges[2]?.content.length).toBeLessThanOrEqual(7); // Should not extend beyond document
    });

    test("it works with before/after of 0", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);
      const documentId = await setupTestDocument(t, namespaceId);

      // Insert chunks
      const chunks = createTestChunks(5);
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId,
          startOrder: 0,
          chunks,
        });
      });

      const chunkDocs = await t.run(async (ctx) => {
        return ctx.db
          .query("chunks")
          .withIndex("documentId_order", (q) => q.eq("documentId", documentId))
          .collect();
      });
      assert(chunkDocs[2].state.kind === "ready");

      const { ranges } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [chunkDocs[2].state.embeddingId], // chunk at order 2
        chunkContext: { before: 0, after: 0 },
      });

      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.order).toBe(2);
      expect(ranges[0]?.startOrder).toBe(2);
      expect(ranges[0]?.content).toHaveLength(1); // Only the target chunk
      expect(ranges[0]?.content[0].text).toBe("Test chunk content 3"); // order 2
    });

    test("it returns de-duplicated documents in the order of the associated embedding ids", async () => {
      const t = convexTest(schema, modules);
      const namespaceId = await setupTestNamespace(t);

      // Create three documents
      const doc1Id = await setupTestDocument(t, namespaceId, "doc1");
      const doc2Id = await setupTestDocument(t, namespaceId, "doc2");
      const doc3Id = await setupTestDocument(t, namespaceId, "doc3");

      // Insert chunks in all documents
      await t.run(async (ctx) => {
        await insertChunks(ctx, {
          documentId: doc1Id,
          startOrder: 0,
          chunks: createTestChunks(2),
        });
        await insertChunks(ctx, {
          documentId: doc2Id,
          startOrder: 0,
          chunks: createTestChunks(2),
        });
        await insertChunks(ctx, {
          documentId: doc3Id,
          startOrder: 0,
          chunks: createTestChunks(2),
        });
      });

      // Get chunks from all documents
      const [doc1Chunks, doc2Chunks, doc3Chunks] = await t.run(async (ctx) => {
        return Promise.all([
          ctx.db
            .query("chunks")
            .withIndex("documentId_order", (q) => q.eq("documentId", doc1Id))
            .collect(),
          ctx.db
            .query("chunks")
            .withIndex("documentId_order", (q) => q.eq("documentId", doc2Id))
            .collect(),
          ctx.db
            .query("chunks")
            .withIndex("documentId_order", (q) => q.eq("documentId", doc3Id))
            .collect(),
        ]);
      });

      assert(doc1Chunks[0].state.kind === "ready");
      assert(doc2Chunks[1].state.kind === "ready");
      assert(doc3Chunks[0].state.kind === "ready");
      assert(doc1Chunks[1].state.kind === "ready");
      assert(doc2Chunks[0].state.kind === "ready");

      const { documents } = await t.query(internal.chunks.getRangesOfChunks, {
        embeddingIds: [
          doc2Chunks[1].state.embeddingId, // doc2 first
          doc1Chunks[0].state.embeddingId, // doc1 second
          doc3Chunks[0].state.embeddingId, // doc3 third
          doc1Chunks[1].state.embeddingId, // doc1 again (should be deduplicated)
          doc2Chunks[0].state.embeddingId, // doc2 again (should be deduplicated)
        ],
        chunkContext: { before: 0, after: 0 },
      });

      // Should return only 3 documents (deduplicated)
      expect(documents).toHaveLength(3);

      // Should be in the order they first appeared in the embedding IDs
      expect(documents[0].documentId).toBe(doc2Id); // First appearance
      expect(documents[1].documentId).toBe(doc1Id); // Second appearance
      expect(documents[2].documentId).toBe(doc3Id); // Third appearance
    });
  });
});
