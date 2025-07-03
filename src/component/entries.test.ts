/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { modules } from "./setup.test.js";
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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    const result = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.entryId).toBeDefined();
    expect(result.replacedEntry).toBeNull();

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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");
    expect(firstResult.replacedEntry).toBeNull();

    // Second add with identical content
    const secondResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(secondResult.created).toBe(false);
    expect(secondResult.status).toBe("ready");
    expect(secondResult.entryId).toBe(firstResult.entryId);
    expect(secondResult.replacedEntry).toBeNull();

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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.replacedEntry).toBeNull();

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
    // When creating a entry as "ready" initially, replacedEntry is null
    // Replacement only happens during pending -> ready transitions
    expect(secondResult.replacedEntry).toMatchObject({
      entryId: firstResult.entryId,
    });

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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

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
    expect(secondResult.replacedEntry).toMatchObject({
      entryId: firstResult.entryId,
    });

    // Verify new version was created
    const newDoc = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.entryId);
    });

    expect(newDoc!.version).toBe(1);
    expect(newDoc!.importance).toBe(0.8);
  });

  test("add creates new version when filter values change", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t, ["category"]); // Add filter name

    const entry = testEntryArgs(namespaceId);

    // First add
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

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
    expect(secondResult.replacedEntry).toMatchObject({
      entryId: firstResult.entryId,
    });

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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    const result = await t.mutation(api.entries.add, {
      entry,
      // No allChunks provided
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.replacedEntry).toBeNull();

    // Verify the entry was created with pending status
    const createdDoc = await t.run(async (ctx) => {
      return ctx.db.get(result.entryId);
    });

    expect(createdDoc!.status.kind).toBe("pending");
  });

  test("multiple entries with different keys can coexist", async () => {
    const t = convexTest(schema, modules);
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
    expect(result1.replacedEntry).toBeNull();
    expect(result2.replacedEntry).toBeNull();

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
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const entry = testEntryArgs(namespaceId);

    // First add - create as ready
    const firstResult = await t.mutation(api.entries.add, {
      entry,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");
    expect(firstResult.replacedEntry).toBeNull();

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
    expect(pendingResult.replacedEntry).toBeNull();

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
});
