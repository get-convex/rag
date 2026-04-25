/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import type { Id } from "./_generated/dataModel.js";

type ConvexTest = TestConvex<typeof schema>;

describe("namespaces", () => {
  async function setupTestNamespace(t: ConvexTest) {
    const namespace = await t.mutation(api.namespaces.getOrCreate, {
      namespace: "test-namespace",
      status: "ready",
      modelId: "test-model",
      dimension: 128,
      filterNames: [],
    });
    return namespace.namespaceId;
  }

  function testEntryArgs(namespaceId: Id<"namespaces">, key: string) {
    return {
      namespaceId,
      key,
      importance: 0.5,
      filterValues: [],
      contentHash: `hash-${key}`,
      title: `Entry ${key}`,
    };
  }

  function testChunk() {
    return {
      content: { text: "test chunk" },
      embedding: Array.from({ length: 128 }, () => Math.random()),
      searchableText: "test chunk",
    };
  }

  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("deleteNamespaceSync deletes all entries then the namespace", async () => {
    const t = initConvexTest();
    const namespaceId = await setupTestNamespace(t);

    // Create multiple entries so the pagination loop must handle them all
    const entryIds: Id<"entries">[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await t.mutation(api.entries.add, {
        entry: testEntryArgs(namespaceId, `key-${i}`),
        allChunks: [testChunk()],
      });
      expect(result.status).toBe("ready");
      entryIds.push(result.entryId);
    }

    // Verify entries exist
    const entriesBefore = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesBefore).toHaveLength(3);

    // This should delete all entries and then the namespace.
    // Before the fix, this threw "cannot delete, has entries" because
    // the pagination loop checked isDone before processing the page,
    // skipping deletion when entries fit in a single page.
    await t.action(api.namespaces.deleteNamespaceSync, {
      namespaceId,
    });

    // Verify all entries are deleted
    const entriesAfter = await t.run(async (ctx) => {
      return ctx.db
        .query("entries")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });
    expect(entriesAfter).toHaveLength(0);

    // Verify namespace is deleted
    const namespaceAfter = await t.run(async (ctx) => {
      return ctx.db.get("namespaces", namespaceId);
    });
    expect(namespaceAfter).toBeNull();
  });
});
