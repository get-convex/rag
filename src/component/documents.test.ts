/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { modules } from "./setup.test.js";
import type { Id } from "./_generated/dataModel.js";

type ConvexTest = TestConvex<typeof schema>;

describe("documents", () => {
  async function setupTestNamespace(t: ConvexTest, filterNames: string[] = []) {
    return await t.run(async (ctx) => {
      return ctx.db.insert("namespaces", {
        namespace: "test-namespace",
        version: 1,
        modelId: "test-model",
        dimension: 128,
        filterNames,
        status: { kind: "ready" },
      });
    });
  }

  function createTestDocument(namespaceId: Id<"namespaces">, key = "test-doc") {
    return {
      namespaceId,
      key,
      importance: 0.5,
      filterValues: [],
      contentHash: "hash123",
      title: "Test Document",
    };
  }

  test("add creates a new document when none exists", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    const result = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.documentId).toBeDefined();
    expect(result.replacedVersion).toBeNull();

    // Verify the document was actually created
    const createdDoc = await t.run(async (ctx) => {
      return ctx.db.get(result.documentId);
    });

    expect(createdDoc).toBeDefined();
    expect(createdDoc!.key).toBe(document.key);
    expect(createdDoc!.version).toBe(0);
    expect(createdDoc!.status.kind).toBe("ready");
  });

  test("add returns existing document when adding identical content", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    // First add
    const firstResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");
    expect(firstResult.replacedVersion).toBeNull();

    // Second add with identical content
    const secondResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    expect(secondResult.created).toBe(false);
    expect(secondResult.status).toBe("ready");
    expect(secondResult.documentId).toBe(firstResult.documentId);
    expect(secondResult.replacedVersion).toBeNull();

    // Verify no new document was created
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("documents")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), document.key)
          )
        )
        .collect();
    });

    expect(allDocs).toHaveLength(1);
    expect(allDocs[0]._id).toBe(firstResult.documentId);
  });

  test("add creates new version when content hash changes", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    // First add
    const firstResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.replacedVersion).toBeNull();

    // Second add with different content hash
    const modifiedDocument = {
      ...document,
      contentHash: "hash456", // Different hash
    };

    const secondResult = await t.mutation(api.documents.add, {
      document: modifiedDocument,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.documentId).not.toBe(firstResult.documentId);
    // When creating a document as "ready" initially, replacedVersion is null
    // Replacement only happens during pending -> ready transitions
    expect(secondResult.replacedVersion).toBeNull();

    // Verify both documents exist with different versions
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("documents")
        .filter((q) =>
          q.and(
            q.eq(q.field("namespaceId"), namespaceId),
            q.eq(q.field("key"), document.key)
          )
        )
        .collect();
    });

    expect(allDocs).toHaveLength(2);

    const versions = allDocs.map((doc) => doc.version).sort();
    expect(versions).toEqual([0, 1]);
  });

  test("add creates new version when importance changes", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    // First add
    const firstResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    // Second add with different importance
    const modifiedDocument = {
      ...document,
      importance: 0.8, // Changed from 0.5
    };

    const secondResult = await t.mutation(api.documents.add, {
      document: modifiedDocument,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.documentId).not.toBe(firstResult.documentId);
    expect(secondResult.replacedVersion).toBeNull();

    // Verify new version was created
    const newDoc = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.documentId);
    });

    expect(newDoc!.version).toBe(1);
    expect(newDoc!.importance).toBe(0.8);
  });

  test("add creates new version when filter values change", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t, ["category"]); // Add filter name

    const document = createTestDocument(namespaceId);

    // First add
    const firstResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    // Second add with different filter values
    const modifiedDocument = {
      ...document,
      filterValues: [{ name: "category", value: "test" }],
    };

    const secondResult = await t.mutation(api.documents.add, {
      document: modifiedDocument,
      allChunks: [],
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.documentId).not.toBe(firstResult.documentId);
    expect(secondResult.replacedVersion).toBeNull();

    // Verify new version was created with correct filter values
    const newDoc = await t.run(async (ctx) => {
      return ctx.db.get(secondResult.documentId);
    });

    expect(newDoc!.version).toBe(1);
    expect(newDoc!.filterValues).toHaveLength(1);
    expect(newDoc!.filterValues[0].name).toBe("category");
    expect(newDoc!.filterValues[0].value).toBe("test");
  });

  test("add without allChunks creates pending document", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    const result = await t.mutation(api.documents.add, {
      document,
      // No allChunks provided
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.replacedVersion).toBeNull();

    // Verify the document was created with pending status
    const createdDoc = await t.run(async (ctx) => {
      return ctx.db.get(result.documentId);
    });

    expect(createdDoc!.status.kind).toBe("pending");
  });

  test("multiple documents with different keys can coexist", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document1 = createTestDocument(namespaceId, "doc1");
    const document2 = createTestDocument(namespaceId, "doc2");

    const result1 = await t.mutation(api.documents.add, {
      document: document1,
      allChunks: [],
    });

    const result2 = await t.mutation(api.documents.add, {
      document: document2,
      allChunks: [],
    });

    expect(result1.created).toBe(true);
    expect(result2.created).toBe(true);
    expect(result1.documentId).not.toBe(result2.documentId);
    expect(result1.replacedVersion).toBeNull();
    expect(result2.replacedVersion).toBeNull();

    // Verify both documents exist
    const allDocs = await t.run(async (ctx) => {
      return ctx.db
        .query("documents")
        .filter((q) => q.eq(q.field("namespaceId"), namespaceId))
        .collect();
    });

    expect(allDocs).toHaveLength(2);
    const keys = allDocs.map((doc) => doc.key).sort();
    expect(keys).toEqual(["doc1", "doc2"]);
  });

  test("pending to ready transition populates replacedVersion", async () => {
    const t = convexTest(schema, modules);
    const namespaceId = await setupTestNamespace(t);

    const document = createTestDocument(namespaceId);

    // First add - create as ready
    const firstResult = await t.mutation(api.documents.add, {
      document,
      allChunks: [],
    });

    expect(firstResult.created).toBe(true);
    expect(firstResult.status).toBe("ready");
    expect(firstResult.replacedVersion).toBeNull();

    // Second add - create as pending (no allChunks)
    const modifiedDocument = {
      ...document,
      contentHash: "hash456",
    };

    const pendingResult = await t.mutation(api.documents.add, {
      document: modifiedDocument,
      // No allChunks - creates pending document
    });

    expect(pendingResult.created).toBe(true);
    expect(pendingResult.status).toBe("pending");
    expect(pendingResult.replacedVersion).toBeNull();

    // Promote to ready - this should replace the first document
    const promoteResult = await t.mutation(api.documents.promoteToReady, {
      documentId: pendingResult.documentId,
    });

    expect(promoteResult.replacedVersion).not.toBeNull();
    expect(promoteResult.replacedVersion!.documentId).toBe(
      firstResult.documentId
    );

    // Verify the first document is now replaced
    const firstDoc = await t.run(async (ctx) => {
      return ctx.db.get(firstResult.documentId);
    });
    expect(firstDoc!.status.kind).toBe("replaced");
  });
});
