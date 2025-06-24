/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema, { v } from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { modules } from "./setup.test.js";
import { insertChunks, deleteChunksPage, getRangesOfChunks } from "./chunks.js";
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
    const namespaceId = await setupTestNamespace(t);

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
      isDone = result.isDone;
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
      console.log(chunkDocs);
      assert(chunkDocs.length === 5);
      assert(chunkDocs[2].state.kind === "ready");

      const { ranges, documents } = await t.query(
        internal.chunks.getRangesOfChunks,
        {
          embeddingIds: [chunkDocs[2].state.embeddingId],
          messageRange: { before: 1, after: 2 },
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
      // TODO: Test this
    });
    test("finds chunks on both a pending and ready version of the same document", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("finds chunks before and after a chunk", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("accepts ranges outside of the document order bounds", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("when two ranges overlap, the later range gets priority on the chunks in between", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("when three ranges overlap, the middle chunk gets priority on before chunk but not after chunk", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("it works with before/after of 0", async () => {
      const t = convexTest(schema, modules);
      // TODO: Test this
    });
    test("it returns de-duplicated documents in the order of the associated embedding ids", async () => {});
  });
});
