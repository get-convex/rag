# Convex Memory Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fmemory.svg)](https://badge.fury.io/js/@convex-dev%2Fmemory)

<!-- START: Include on https://convex.dev/components -->

A component for semantic search over documents, often to provide context to
LLMs, e.g. for Retrieval-Augmented Generation (RAG).

## ✨ Key Features

- **Document Add**: Add or replace documents with automatic text chunking and embedding.
- **Semantic Search**: Vector-based search using configurable embedding models
- **Namespaces**: Organize documents into namespaces for per-user search.
- **Custom Filtering**: Filter documents with custom indexed fields.
- **Importance Weighting**: Weight documents by providing a 0 to 1 "importance".
- **Chunk Context**: Get surrounding chunks for better context.
- **Graceful Migrations**: Migrate documents or whole namespaces to new content, models, etc. without disruption.

Found a bug? Feature request? [File it here](https://github.com/get-convex/memory/issues).

## Pre-requisite: Convex

You'll need an existing Convex project to use the component.
Convex is a hosted backend platform, including a database, serverless functions,
and a ton more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```ts
npm install @convex-dev/memory
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import memory from "@convex-dev/memory/convex.config";

const app = defineApp();
app.use(memory);

export default app;
```

## Basic Setup

```ts
// convex/documents.ts
import { components } from "./_generated/api";
import { Memory } from "@convex-dev/memory";
// Any AI SDK model that supports embeddings will work.
import { openai } from "@ai-sdk/openai";

const memory = new Memory(components.memory, {
  filterNames: ["category", "documentType", "categoryAndType"],
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});
```

## Usage Examples

### Document Upload and Chunking

Upload documents with automatic text chunking and embedding:

```ts
export const add = action({
  args: {
    url: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const { url, category } = args;
    const response = await fetch(url);
    const content = await response.text();
    const chunks = await textSplitter.splitText(content);
    const documentType = response.headers.get("content-type");

    const { documentId } = await memory.add(ctx, {
      namespace: "global", // namespace can be any string
      key: url,
      chunks,
      source: { kind: "url", url },
      filterValues: [
        { name: "category", value: category },
        { name: "documentType", value: documentType },
        // To get an AND filter, use a filter with a more complex value.
        { name: "categoryAndType", value: { category, documentType } },
      ],
    });

    return { documentId };
  },
});
```

Note: The `textSplitter` here could be LangChain, Mastra, or otherwise.
See below for more details.

### File Upload with Storage

Upload files directly to a Convex action, httpAction, or upload url. See the
[docs](https://docs.convex.dev/file-storage/upload-files) for more details.

```ts
export const uploadFile = action({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const { filename, mimeType, bytes, category } = args;
    // Store file in Convex storage
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );

    // Extract and chunk text content
    const textContent = new TextDecoder().decode(bytes);
    const chunks = await textSplitter.splitText(textContent);

    const { documentId } = await memory.add(ctx, {
      namespace: userId, // per-user namespace
      key: filename,
      title: filename,
      chunks,
      source: { kind: "_storage", storageId },
      filterValues: [
        { name: "category", value: category },
        { name: "documentType", value: mimeType },
        { name: "categoryAndType", value: { category, documentType: mimeType } },
      ],
    });

    return { documentId, url: await ctx.storage.getUrl(storageId) };
  },
});
```

### Semantic Search

Search across documents with vector similarity

- `text` is the plain text content of the results concatenated together.
- `results` is an array of matching chunks with scores and more metadata.
- `sources` is an array of the documents that matched the query.
   Each result has a `documentId` referencing one of these source documents.

```ts
export const searchDocuments = action({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {

    const { results, text, sources } = await memory.search(ctx, {
      namespace: "global",
      query: args.query,
      limit: 10
    });

    return { results, text, sources };
  },
});
```

### Filtered Search

Search with metadata filters:

```ts
export const searchByCategory = action({
  args: {
    query: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const results = await memory.search(ctx, {
      namespace: userId,
      query: args.query,
      filters: [{ name: "category", value: args.category }],
      limit: 10,
    });

    return results;
  },
});
```

### Search with Context

Get surrounding chunks for better context:

```ts
export const searchWithContext = action({
  args: {
    query: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await memory.search(ctx, {
      namespace: args.userId,
      query: args.query,
      chunkContext: { before: 2, after: 1 }, // Include 2 chunks before, 1 after
      limit: 5,
    });

    return results;
  },
});
```

### Document Management

Delete a document:

```ts
export const deleteDocument = mutation({
  args: { documentId: vDocumentId },
  handler: async (ctx, args) => {
    await memory.deleteDocument(ctx, {
      documentId: args.documentId,
    });
  },
});
```

### Asynchronous Document Processing

For large documents, use async processing:

```ts
export const chunkerAction = memory.defineChunkerAction(
  async (ctx, args) => {
    // Custom chunking logic for large documents
    // This can be an async iterator if you can't fit it all in memory at once.
    const chunks = await processLargeDocument(args.source);
    return { chunks };
  }
);

export const uploadLargeDocument = action({
  args: {
    filename: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const { documentId } = await memory.addDocumentAsync(ctx, {
      namespace: userId,
      key: args.filename,
      source: { kind: "url", url: args.url },
      chunkerAction: internal.example.chunkerAction,
    });

    return { documentId };
  },
});
```

See more example usage in [example.ts](./example/convex/example.ts).

Run the example with `npm i && npm run example`.
<!-- END: Include on https://convex.dev/components -->
