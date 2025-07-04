import { describe, expect, test } from "vitest";
import { RAG } from "./index.js";
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

// The schema for the tests
const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
// type DatabaseReader = GenericDatabaseReader<DataModel>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const rag = new RAG(components.rag, {
  embeddingDimension: 1536,
  textEmbeddingModel: openai.textEmbeddingModel("text-embedding-3-small"),
  filterNames: ["simpleString", "arrayOfStrings", "customObject"],
});

export const findExistingEntryByContentHash = query({
  args: { namespace: v.string(), key: v.string(), contentHash: v.string() },
  handler: async (ctx, args) => {
    return rag.findExistingEntryByContentHash(ctx, {
      namespace: args.namespace,
      key: args.key,
      contentHash: args.contentHash,
    });
  },
});

export const add = mutation({
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
    return rag.add(ctx, args);
  },
});

export const search = action({
  args: {
    embedding: v.array(v.number()),
    namespace: v.string(),
    limit: v.optional(v.number()),
    chunkContext: v.optional(
      v.object({
        before: v.number(),
        after: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { results, entries, text } = await rag.search(ctx, {
      embedding: args.embedding,
      namespace: args.namespace,
      limit: args.limit ?? 10,
      chunkContext: args.chunkContext ?? { before: 0, after: 0 },
    });

    return {
      results,
      text,
      entries,
    };
  },
});

const testApi: ApiFromModules<{
  fns: {
    findExistingEntryByContentHash: typeof findExistingEntryByContentHash;
    add: typeof add;
    search: typeof search;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}>["fns"] = anyApi["index.test"] as any;

function dummyEmbeddings(text: string) {
  return Array.from({ length: 1536 }, (_, i) =>
    i === 0 ? text.charCodeAt(0) / 256 : 0.1
  );
}

describe("RAG thick client", () => {
  test("should add a entry and be able to list it", async () => {
    const t = initConvexTest(schema);
    const { entryId, status } = await t.mutation(testApi.add, {
      key: "test",
      chunks: [
        { text: "A", metadata: {}, embedding: dummyEmbeddings("A") },
        { text: "B", metadata: {}, embedding: dummyEmbeddings("B") },
        { text: "C", metadata: {}, embedding: dummyEmbeddings("C") },
      ],
      namespace: "test",
    });
    expect(entryId).toBeDefined();
    expect(status).toBe("ready");
    await t.run(async (ctx) => {
      const { isDone, page } = await rag.listChunks(ctx, {
        entryId,
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
    await t.mutation(testApi.add, {
      key: "test",
      chunks: [
        { text: "A", metadata: {}, embedding: dummyEmbeddings("A") },
        { text: "B", metadata: {}, embedding: dummyEmbeddings("B") },
        { text: "C", metadata: {}, embedding: dummyEmbeddings("C") },
      ],
      namespace: "test",
    });
    // expect(result).toBe(1);
  });

  describe("text formatting validation", () => {
    test("should format single entry with sequential chunks correctly", async () => {
      const t = initConvexTest(schema);

      // Add entry with sequential chunks
      await t.mutation(testApi.add, {
        key: "sequential-test",
        chunks: [
          {
            text: "Chunk 1 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 1 content"),
          },
          {
            text: "Chunk 2 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 2 content"),
          },
          {
            text: "Chunk 3 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 3 content"),
          },
        ],
        namespace: "format-test",
        title: "Test Document",
      });

      // Search and verify text format
      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("content"),
        namespace: "format-test",
        limit: 10,
      });

      // Should match README format: "## Title:\n{entry.text}"
      expect(text).toContain("## Test Document:");
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe(
        "Chunk 1 content\nChunk 2 content\nChunk 3 content"
      );

      // Overall text should be: "## Test Document:\nChunk 1 content\nChunk 2 content\nChunk 3 content"
      expect(text).toBe(
        "## Test Document:\n\nChunk 1 content\nChunk 2 content\nChunk 3 content"
      );
    });

    test("should format single entry without title correctly", async () => {
      const t = initConvexTest(schema);

      // Add entry without title
      await t.mutation(testApi.add, {
        key: "no-title-test",
        chunks: [
          {
            text: "Content without title",
            metadata: {},
            embedding: dummyEmbeddings("Content without title"),
          },
        ],
        namespace: "format-test-notitle",
      });

      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("content"),
        namespace: "format-test-notitle",
        limit: 10,
      });

      // Should not have "## " prefix since no title
      expect(text).not.toContain("## ");
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe("Content without title");
      expect(text).toBe("Content without title");
    });

    test("should format non-sequential chunks with ellipsis separator", async () => {
      const t = initConvexTest(schema);

      // Add multiple entries to create potential non-sequential results
      await t.mutation(testApi.add, {
        key: "doc1",
        chunks: [
          {
            text: "Chunk 1 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 1 content"),
          },
          {
            text: "Chunk 2 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 2 content"),
          },
          {
            text: "Important chunk",
            metadata: {},
            embedding: dummyEmbeddings("A important chunk"),
          },
          {
            text: "Chunk 4 content",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 4 content"),
          },
          {
            text: "Another important chunk",
            metadata: {},
            // embedding hack uses first char to determine order
            embedding: dummyEmbeddings("B important chunk"),
          },
        ],
        namespace: "ellipsis-test",
        title: "Document with gaps",
      });

      // Search with chunk context to potentially get non-sequential results
      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("A important chunk"),
        namespace: "ellipsis-test",
        limit: 2,
        chunkContext: { before: 0, after: 0 }, // Just the matching chunks
      });

      expect(entries).toHaveLength(1);

      // If we get non-sequential chunks, they should be separated by "\n...\n"
      // The exact behavior depends on the search results, but we can at least verify structure
      expect(entries[0].text).toContain("Important chunk");
      expect(entries[0].text).toContain("Another important chunk");

      // The text might contain ellipsis if chunks are non-sequential
      expect(text).toMatch(/\n\.\.\.\n/);
    });

    test("should format multiple entries with separators", async () => {
      const t = initConvexTest(schema);

      // Add two separate entries
      await t.mutation(testApi.add, {
        key: "first-doc",
        chunks: [
          {
            text: "First document content",
            metadata: {},
            embedding: dummyEmbeddings("First document content"),
          },
        ],
        namespace: "multi-entry-test",
        title: "First Document",
      });

      await t.mutation(testApi.add, {
        key: "second-doc",
        chunks: [
          {
            text: "Second document content",
            metadata: {},
            embedding: dummyEmbeddings("Second document content"),
          },
        ],
        namespace: "multi-entry-test",
        title: "Second Document",
      });

      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("document"),
        namespace: "multi-entry-test",
        limit: 10,
      });

      // Should have entries separated by "\n---\n" as per README
      expect(text).toContain("---");
      expect(text).toMatch(/## .+:\n\n.+\n\n---\n\n## .+:\n\n.+/);

      // Should have both titles prefixed with "## "
      expect(text).toContain("## First Document:");
      expect(text).toContain("## Second Document:");

      expect(entries).toHaveLength(2);
    });

    test("should format mixed entries (with and without titles)", async () => {
      const t = initConvexTest(schema);

      // Add entry with title
      await t.mutation(testApi.add, {
        key: "titled-doc",
        chunks: [
          {
            text: "Content with title",
            metadata: {},
            embedding: dummyEmbeddings("Content with title"),
          },
        ],
        namespace: "mixed-test",
        title: "Titled Document",
      });

      // Add entry without title
      await t.mutation(testApi.add, {
        key: "untitled-doc",
        chunks: [
          {
            text: "Content without title",
            metadata: {},
            embedding: dummyEmbeddings("Content without title"),
          },
        ],
        namespace: "mixed-test",
      });

      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("content"),
        namespace: "mixed-test",
        limit: 10,
      });

      // Should properly handle mixed formatting
      expect(text).toContain("---"); // Entries should be separated
      expect(text).toContain("## Titled Document:"); // Titled entry should have prefix

      // One entry should have title format, one should not
      const parts = text.split("\n---\n");
      expect(parts).toHaveLength(2);

      const hasTitle = parts.some((part) => part.startsWith("## "));
      const hasNoTitle = parts.some((part) => !part.startsWith("## "));
      expect(hasTitle).toBe(true);
      expect(hasNoTitle).toBe(true);

      expect(entries).toHaveLength(2);
    });

    test("should match exact README format specification", async () => {
      const t = initConvexTest(schema);

      // Create the exact scenario from README example
      await t.mutation(testApi.add, {
        key: "title1-doc",
        chunks: [
          {
            text: "Chunk 1 contents",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 1 contents"),
          },
          {
            text: "Chunk 2 contents",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 2 contents"),
          },
        ],
        namespace: "readme-format-test",
        title: "Title 1",
      });

      await t.mutation(testApi.add, {
        key: "title2-doc",
        chunks: [
          {
            text: "Chunk 3 contents",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 3 contents"),
          },
          {
            text: "Chunk 4 contents",
            metadata: {},
            embedding: dummyEmbeddings("Chunk 4 contents"),
          },
        ],
        namespace: "readme-format-test",
        title: "Title 2",
      });

      const { text, entries } = await t.action(testApi.search, {
        embedding: dummyEmbeddings("contents"),
        namespace: "readme-format-test",
        limit: 10,
      });

      // Verify basic structure matches README
      expect(text).toContain("## Title 1:");
      expect(text).toContain("## Title 2:");
      expect(text).toContain("---");

      // Should have proper entry separation
      const parts = text.split("\n\n---\n\n");
      expect(parts).toHaveLength(2);

      // Each part should start with "## Title X:"
      parts.forEach((part) => {
        expect(part).toMatch(/^## Title \d+:/);
      });

      expect(entries).toHaveLength(2);

      // Individual entry texts should follow the pattern
      expect(text).toBe(
        `## Title 1:

Chunk 1 contents
Chunk 2 contents

---

## Title 2:

Chunk 3 contents
Chunk 4 contents`
      );
    });
  });
});
