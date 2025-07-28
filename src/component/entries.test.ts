/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import type { Id } from "./_generated/dataModel.js";

type ConvexTest = TestConvex<typeof schema>;

describe("entries", () => {
  async function setupTestNamespace(t: ConvexTest, filterNames: string[] = []) {
    const namespace = await t.mutation(api.namespaces.getOrCreate, {
      namespace: "test-namespace",
      status: "ready",
      modelId: "test-model",
      dimension: 128,
      filterNames,
    });
    return namespace.namespaceId;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function testEntryArgs(namespaceId: Id<"namespaces">, key = "test-entry") {
    return {
      namespaceId,
      key,
      importance: 0.5,
      filterValues: [],
      contentHash: "hash123",
      title: "Test Entry",
    };
  }

  test("add creates a new entry when none exists", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    const result = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.entryId).toBeDefined();

    // Verify the entry was actually created
    const createdDoc = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });

    expect(createdDoc).toBeDefined();
    expect(createdDoc!.key).toBe(entry.key);
    expect(createdDoc!.version).toBe(0);
    expect(createdDoc!.status.kind).toBe("ready");
  });

  test("add returns existing entry when adding identical content", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");

    // Second add with identical content
    const secondResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(secondResult.created).toBe(false);
    expect(secondResult.status).toBe("ready");
    expect(secondResult.entryId).toBe(firstResult.entryId);

    // Verify no new entry was created
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), entry.key)
          )
        )
        .collect();
    });

    expect(allDocs).toHaveLength(1);
    expect(allDocs[0]._id).toBe(firstResult.entryId);
  });

  test("add creates new version when content hash changes", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);

    // Second add with different content hash
    const modifiedEntry = {
      ...entry,
      contentHash: "hash456", // Different hash
    };

    const secondResult = await t.mutation(api.entries.add, {
      entry: modifiedEntry,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.entryId).not.toBe(firstResult.entryId);
    expect(secondResult.status).toBe("pending");

    // Verify both entries exist with different versions
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), entry.key)
          )
        )
        .collect();
    });

    expect(allDocs).toHaveLength(2);

    const versions = allDocs.map((entry) => entry.version).sort();
    expect(versions).toEqual([0, 1]);
  });

  test("add creates new version when importance changes", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });
    expect(firstResult.status).toBe("ready");
    const first = await t.run(async (ctx) => {
      return ctx.db.get(firstResult.entryId);
    })!;
    expect(first?.version).toBe(0);
    expect(first?.status.kind).toBe("ready");

    // Second add with different importance
    const modifiedEntry = {
      ...entry,
      importance: 0.8, // Changed from 0.5
    };

    const secondResult = await t.mutation(api.entries.add, {
      entry: modifiedEntry,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.entryId).not.toBe(firstResult.entryId);
    const second = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.entryId);
    })!;
    expect(second?.version).toBe(1);
    expect(second?.status.kind).toBe("pending");
    expect(secondResult.status).toBe("pending");

    // Verify new version was created
    const newDoc = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.entryId);
    });

    expect(newDoc!.version).toBe(1);
    expect(newDoc!.importance).toBe(0.8);
  });

  test("add creates new version when filter values change", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t, ["category"]); // Add filter name

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });
    expect(firstResult.status).toBe("ready");

    // Second add with different filter values
    const modifiedEntry = {
      ...entry,
      filterValues: [{ name: "category", value: "test" }],
    };

    const secondResult = await t.mutation(api.entries.add, {
      entry: modifiedEntry,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.entryId).not.toBe(firstResult.entryId);
    expect(secondResult.status).toBe("pending");

    // Verify new version was created with correct filter values
    const newDoc = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.entryId);
    });

    expect(newDoc!.version).toBe(1);
    expect(newDoc!.filterValues).toHaveLength(1);
    expect(newDoc!.filterValues[0].name).toBe("category");
    expect(newDoc!.filterValues[0].value).toBe("test");
  });

  test("add without allChunks creates pending entry", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    const result = await t.mutation(api.entries.add, {
      entry,
      // No allChunks provided
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("pending");

    // Verify the entry was created with pending status
    const createdDoc = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });

    expect(createdDoc!.status.kind).toBe("pending");
  });

  test("multiple entries with different keys can coexist", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry1 = testEntryArgs(namespaceId, "doc1");
    const entry2 = testEntryArgs(namespaceId, "doc2");

    const result1 = await t.mutation(api.entries.add, {
      entry: entry1,
      allChunks: [],
    });

    const result2 = await t.mutation(api.entries.add, {
      entry: entry2,
      allChunks: [],
    });

    expect(result1.created).toBe(true);
    expect(result2.created).toBe(true);
    expect(result1.entryId).not.toBe(result2.entryId);
    expect(result1.status).toBe("ready");
    expect(result2.status).toBe("ready");

    // Verify both entries exist
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });

    expect(allDocs).toHaveLength(2);
    const keys = allDocs.map((entry) => entry.key).sort();
    expect(keys).toEqual(["doc1", "doc2"]);
  });

  test("pending to ready transition populates replacedEntry", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add - create as ready
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");

    // Second add - create as pending (no allChunks)
    const modifiedEntry = {
      ...entry,
      contentHash: "hash456",
    };

    const pendingResult = await t.mutation(api.entries.add, {
      entry: modifiedEntry,
      // No allChunks - creates pending entry
    });

    expect(pendingResult.created).toBe(true);
    expect(pendingResult.status).toBe("pending");

    const chunksResult = await t.mutation(api.chunks.replaceChunksPage, {
      entryId: pendingResult.entryId,
      startOrder: 0,
    });
    expect(chunksResult.status).toBe("ready");

    // Promote to ready - this should replace the first entry
    const promoteResult = await t.mutation(api.entries.promoteToReady, {
      entryId: pendingResult.entryId,
    });

    expect(promoteResult.replacedEntry).not.toBeNull();
    expect(promoteResult.replacedEntry!.entryId).toBe(firstResult.entryId);

    // Verify the first entry is now replaced
    const firstDoc = await t.run(async (ctx) => {
      return ctx.db.get(firstResult.entryId);
    });
    expect(firstDoc!.status.kind).toBe("replaced");
  });

  test("deleteAsync deletes entry and all chunks", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // Create entry with chunks
    const testChunks = [
      {
        content: { text: "chunk 1 content", metadata: { type: "text" } },
        embedding: Array.from({ length: 128 }, () => Math.random()),
        searchableText: "chunk 1 content",
      },
      {
        content: { text: "chunk 2 content", metadata: { type: "text" } },
        embedding: Array.from({ length: 128 }, () => Math.random()),
        searchableText: "chunk 2 content",
      },
    ];

    const result = await t.mutation(api.entries.add, {
      entry,
      allChunks: testChunks,
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("ready");

    // Verify entry and chunks exist before deletion
    const entryBefore = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });
    expect(entryBefore).toBeDefined();

    const chunksBefore = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .filter((q) => q.eq(q.field("entryId"), result.entryId))
        .collect();
    });
    expect(chunksBefore).toHaveLength(2);

    // Delete the entry
    await t.mutation(api.entries.deleteAsync, {
      entryId: result.entryId,
      startOrder: 0,
    });

    // Wait for async deletion to complete by repeatedly checking
    await t.finishInProgressScheduledFunctions();

    // Verify entry is deleted
    const entryAfter = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });
    expect(entryAfter).toBeNull();

    // Verify chunks are deleted
    const chunksAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .filter((q) => q.eq(q.field("entryId"), result.entryId))
        .collect();
    });
    expect(chunksAfter).toHaveLength(0);
  });

  test("deleteSync deletes entry and all chunks synchronously", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // Create entry with chunks
    const testChunks = [
      {
        content: { text: "sync chunk 1", metadata: { type: "text" } },
        embedding: Array.from({ length: 128 }, () => Math.random()),
        searchableText: "sync chunk 1",
      },
      {
        content: { text: "sync chunk 2", metadata: { type: "text" } },
        embedding: Array.from({ length: 128 }, () => Math.random()),
        searchableText: "sync chunk 2",
      },
    ];

    const result = await t.mutation(api.entries.add, {
      entry,
      allChunks: testChunks,
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("ready");

    // Verify entry and chunks exist before deletion
    const entryBefore = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });
    expect(entryBefore).toBeDefined();

    const chunksBefore = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .filter((q) => q.eq(q.field("entryId"), result.entryId))
        .collect();
    });
    expect(chunksBefore).toHaveLength(2);

    // Delete the entry synchronously
    await t.action(api.entries.deleteSync, {
      entryId: result.entryId,
    });

    // Verify entry is deleted
    const entryAfter = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });
    expect(entryAfter).toBeNull();

    // Verify chunks are deleted
    const chunksAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("chunks")
        .filter((q) => q.eq(q.field("entryId"), result.entryId))
        .collect();
    });
    expect(chunksAfter).toHaveLength(0);
  });

  test("deleteByKeyAsync deletes all entries with the given key", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry1 = testEntryArgs(namespaceId, "shared-key");
    const entry2 = {
      ...testEntryArgs(namespaceId, "shared-key"),
      contentHash: "hash456",
    };
    const entry3 = testEntryArgs(namespaceId, "different-key");

    // Create multiple entries with same key and one with different key
    const result1 = await t.mutation(api.entries.add, {
      entry: entry1,
      allChunks: [
        {
          content: { text: "content 1" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    const result2 = await t.mutation(api.entries.add, {
      entry: entry2,
      allChunks: [
        {
          content: { text: "content 2" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    const result3 = await t.mutation(api.entries.add, {
      entry: entry3,
      allChunks: [
        {
          content: { text: "content 3" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    // Verify all entries exist
    const entriesBefore = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesBefore).toHaveLength(3);
    const sharedBefore = await t.query(
      internal.entries.getEntriesForNamespaceByKey,
      {
        namespaceId,
        key: "shared-key",
      }
    );
    expect(sharedBefore).toHaveLength(2);

    // Delete entries by key
    await t.mutation(api.entries.deleteByKeyAsync, {
      namespaceId,
      key: "shared-key",
    });

    // Wait for async deletion to complete
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify only entries with "shared-key" are deleted
    const entriesAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesAfter).toHaveLength(1);
    expect(entriesAfter[0].key).toBe("different-key");
    expect(entriesAfter[0]._id).toBe(result3.entryId);

    const sharedAfter = await t.query(
      internal.entries.getEntriesForNamespaceByKey,
      { namespaceId, key: "shared-key" }
    );
    expect(sharedAfter).toHaveLength(0);

    // Verify chunks from deleted entries are also deleted
    const chunksAfter = await t.run(async (ctx) => {
      return ctx.db.query("chunks").collect();
    });
    expect(chunksAfter).toHaveLength(1); // Only chunk from entry3 should remain
  });

  test("deleteByKeySync deletes all entries with the given key synchronously", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry1 = testEntryArgs(namespaceId, "sync-key");
    const entry2 = {
      ...testEntryArgs(namespaceId, "sync-key"),
      contentHash: "hash789",
    };
    const entry3 = testEntryArgs(namespaceId, "keep-key");

    // Create multiple entries with same key and one with different key
    const result1 = await t.mutation(api.entries.add, {
      entry: entry1,
      allChunks: [
        {
          content: { text: "sync content 1" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    const result2 = await t.mutation(api.entries.add, {
      entry: entry2,
      allChunks: [
        {
          content: { text: "sync content 2" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    const result3 = await t.mutation(api.entries.add, {
      entry: entry3,
      allChunks: [
        {
          content: { text: "sync content 3" },
          embedding: Array.from({ length: 128 }, () => Math.random()),
        },
      ],
    });

    // Verify all entries exist
    const entriesBefore = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesBefore).toHaveLength(3);

    // Delete entries by key synchronously
    await t.action(api.entries.deleteByKeySync, {
      namespaceId,
      key: "sync-key",
    });

    // Verify only entries with "sync-key" are deleted
    const entriesAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesAfter).toHaveLength(1);
    expect(entriesAfter[0].key).toBe("keep-key");
    expect(entriesAfter[0]._id).toBe(result3.entryId);

    // Verify chunks from deleted entries are also deleted
    const chunksAfter = await t.run(async (ctx) => {
      return ctx.db.query("chunks").collect();
    });
    expect(chunksAfter).toHaveLength(1); // Only chunk from entry3 should remain
  });

  test("deleteByKeyAsync handles entries without key gracefully", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entryWithKey = testEntryArgs(namespaceId, "has-key");
    const entryWithoutKey = { ...testEntryArgs(namespaceId), key: undefined };

    // Create entries
    const result1 = await t.mutation(api.entries.add, {
      entry: entryWithKey,
      allChunks: [],
    });

    const result2 = await t.mutation(api.entries.add, {
      entry: entryWithoutKey,
      allChunks: [],
    });

    // Delete by key - should only affect entries with that key
    await t.mutation(api.entries.deleteByKeyAsync, {
      namespaceId,
      key: "has-key",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify only the entry with the specified key is deleted
    const entriesAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesAfter).toHaveLength(1);
    expect(entriesAfter[0]._id).toBe(result2.entryId);
    expect(entriesAfter[0].key).toBeUndefined();
  });

  test("deleteByKeyAsync with beforeVersion parameter", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId, "versioned-key");

    // Create multiple versions of the same entry
    const result1 = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    const result2 = await t.mutation(api.entries.add, {
      entry: { ...entry, contentHash: "hash456" },
      allChunks: [],
    });

    const result3 = await t.mutation(api.entries.add, {
      entry: { ...entry, contentHash: "hash789" },
      allChunks: [],
    });

    // Get the versions to understand ordering
    const allEntries = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), "versioned-key")
          )
        )
        .collect();
    });

    const sortedEntries = allEntries.sort((a, b) => a.version - b.version);
    expect(sortedEntries).toHaveLength(3);

    // Delete entries before version 2 (should delete version 0 and 1)
    await t.mutation(api.entries.deleteByKeyAsync, {
      namespaceId,
      key: "versioned-key",
      beforeVersion: 2,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Should only have the latest version (version 2) remaining
    const remainingEntries = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), "versioned-key")
          )
        )
        .collect();
    });

    expect(remainingEntries).toHaveLength(1);
    expect(remainingEntries[0].version).toBe(2);
    expect(remainingEntries[0]._id).toBe(result3.entryId);
  });
});
