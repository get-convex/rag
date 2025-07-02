# Convex Agent RAG Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fmemory.svg)](https://badge.fury.io/js/@convex-dev%2Fmemory)

<!-- START: Include on https://convex.dev/components -->

A component for semantic search, usually used to look up context for LLMs.
Use with an Agent for Retrieval-Augmented Generation (RAG).

## ✨ Key Features

- **Add Content**: Add or replace content with text chunks and embeddings.
- **Semantic Search**: Vector-based search using configurable embedding models
- **Namespaces**: Organize content into namespaces for per-user search.
- **Custom Filtering**: Filter content with custom indexed fields.
- **Importance Weighting**: Weight content by providing a 0 to 1 "importance".
- **Chunk Context**: Get surrounding chunks for better context.
- **Graceful Migrations**: Migrate content or whole namespaces without disruption.

Found a bug? Feature request? [File it here](https://github.com/get-convex/rag/issues).

## Pre-requisite: Convex

You'll need an existing Convex project to use the component.
Convex is a hosted backend platform, including a database, serverless functions,
and a ton more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```ts
npm install @convex-dev/rag
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config";

const app = defineApp();
app.use(rag);

export default app;
```

## Basic Setup

```ts
// convex/example.ts
import { components } from "./_generated/api";
import { RAG } from "@convex-dev/rag";
// Any AI SDK model that supports embeddings will work.
import { openai } from "@ai-sdk/openai";

const rag = new RAG<FilterTypes>(components.rag, {
  filterNames: ["category", "contentType", "categoryAndType"],
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

// Optional: Add type safety to your filters.
type FilterTypes = {
  category: string;
  contentType: string;
  categoryAndType: { category: string; contentType: string };
};
```

## Usage Examples

### Add RAG Entries

Add content with text chunks.
It will embed the chunks automatically if you don't provide them.

```ts
export const add = action({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    // Add the text to a namespace shared by all users.
    await rag.add(ctx, {
      namespace: "all-users",
      chunks: text.split("\n\n"),
    });
  },
});
```

### Add Entries with filters from a URL

Here's a simple example fetching content from a URL to add.

It also adds filters to the entry, so you can search for it later by
category, contentType, or both.

```ts
export const add = action({
  args: { url: v.string(), category: v.string() },
  handler: async (ctx, { url, category }) => {
    const response = await fetch(url);
    const content = await response.text();
    const contentType = response.headers.get("content-type");

    const { entryId } = await rag.add(ctx, {
      namespace: "global", // namespace can be any string
      key: url,
      chunks: content.split("\n\n"),
      filterValues: [
        { name: "category", value: category },
        { name: "contentType", value: contentType },
        // To get an AND filter, use a filter with a more complex value.
        { name: "categoryAndType", value: { category, contentType } },
      ],
    });

    return { entryId };
  },
});
```

Note: The `textSplitter` here could be LangChain, Mastra, or otherwise.
See below for more details.

### Add Entries Asynchronously using File Storage

For large files, you can upload them to file storage, then provide a chunker
action to split them into chunks.

In `convex/http.ts`:
```ts
import { corsRouter } from "convex-helpers/server/cors";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api.js";
import { DataModel } from "./_generated/dataModel.js";
import { httpAction } from "./_generated/server.js";
import { rag } from "./example.js";

const cors = corsRouter(httpRouter());

cors.route({
  path: "/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const storageId = await ctx.storage.store(await request.blob());
    await rag.addAsync(ctx, {
      namespace: "all-files",
      chunkerAction: internal.http.chunkerAction,
      onComplete: internal.http.handleEntryComplete,
      metadata: { storageId },
    });
    return new Response();
  }),
});

export const chunkerAction = rag.defineChunkerAction(async (ctx, args) => {
  const storageId = args.entry.metadata!.storageId;
  const file = await ctx.storage.get(storageId);
  const text = await new TextDecoder().decode(await file!.arrayBuffer());
  return { chunks: text.split("\n\n") };
});

export const handleEntryComplete = rag.defineOnComplete<DataModel>(
  async (ctx, { replacedEntry, entry, namespace, error }) => {
    if (error) {
      await rag.delete(ctx, { entryId: entry.entryId });
      return;
    }
    // You can associate the entry with your own data here. This will commit
    // in the same transaction as the entry becoming ready.
  }
);

export default cors.http;
```

You can upload files directly to a Convex action, httpAction, or upload url.
See the [docs](https://docs.convex.dev/file-storage/upload-files) for details.

### Semantic Search

Search across content with vector similarity

- `text` is a string with the full content of the results, for convenience.
  It is in order of the entries, with titles at each entry boundary, and
  separators between non-sequential chunks. See below for more details.
- `results` is an array of matching chunks with scores and more metadata.
- `entries` is an array of the entries that matched the query.
  Each result has a `entryId` referencing one of these source entries.

```ts
export const search = action({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {

    const { results, text, entries } = await rag.search(ctx, {
      namespace: "global",
      query: args.query,
      limit: 10
      vectorScoreThreshold: 0.5, // Only return results with a score >= 0.5
    });

    return { results, text, entries };
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

    const results = await rag.search(ctx, {
      namespace: userId,
      query: args.query,
      filters: [{ name: "category", value: args.category }],
      limit: 10,
    });

    return results;
  },
});
```

### Add surrounding chunks to results for context

Instead of getting just the single matching chunk, you can request
surrounding chunks so there's more context to the result.

Note: If there are results that have overlapping ranges, it will not return
duplicate chunks, but instead give priority to adding the "before" context
to each chunk.
For example if you requested 2 before and 1 after, and your results were for
the same entryId indexes 1, 4, and 7, the results would be:
```ts
[
  // Only one before chunk available, and leaves chunk2 for the next result.
  { order: 1, content: [chunk0, chunk1], startOrder: 0, ... },
  // 2 before chunks available, but leaves chunk5 for the next result.
  { order: 4, content: [chunk2, chunk3, chunk4], startOrder: 2, ... },
  // 2 before chunks available, and includes one after chunk.
  { order: 7, content: [chunk5, chunk6, chunk7, chunk8], startOrder: 5, ... },
]
```

```ts
export const searchWithContext = action({
  args: {
    query: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const { results, text, entries } = await rag.search(ctx, {
      namespace: args.userId,
      query: args.query,
      chunkContext: { before: 2, after: 1 }, // Include 2 chunks before, 1 after
      limit: 5,
    });

    return { results, text, entries };
  },
});
```

### Formatting results

Formatting the results for use in a prompt depends a bit on the use case.
By default, the results will be sorted by score, not necessarily in the order
they appear in the original text. You may want to sort them by the order they
appear in the original text so they follow the flow of the original document.

For convenienct, the `text` field of the search results is a string formatted
with `...` separating non-sequential chunks, `---` separating entries, and
`# Title:` at each entry boundary (if titles are available).

```ts
const { text } = await rag.search(ctx, { ... });
console.log(text);
```

```txt
# Title 1:
Chunk 1 contents
Chunk 2 contents
...
Chunk 8 contents
Chunk 9 contents
---
# Title 2:
Chunk 4 contents
Chunk 5 contents
```

There is also a `text` field on each entry that is the full text of the entry,
similarly formatted with `...` separating non-sequential chunks, if you want
to format each entry differently.

For a fully custom format, you can use the `results` field and entries directly:

```ts
const { results, text, entries } = await rag.search(ctx, {
  namespace: args.userId,
  query: args.query,
  chunkContext: { before: 2, after: 1 }, // Include 2 chunks before, 1 after
  limit: 5,
  vectorScoreThreshold: 0.5, // Only return results with a score >= 0.5
});

// Get results in the order of the entries (highest score first)
const contexts = entries.map((e) => {
  const ranges = results
    .filter((r) => r.entryId === e.entryId)
    .sort((a, b) => a.startOrder - b.startOrder);
  let text = (e.title ?? "") + ":\n\n";
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.startOrder !== previousEnd) {
      text += "\n...\n";
    }
    text += range.content.map((c) => c.text).join("\n");
    previousEnd = range.startOrder + range.content.length;
  }
  return {
    ...e,
    entryId: e.entryId as EntryId,
    filterValues: e.filterValues as EntryFilterValues<FitlerSchemas>[],
    text,
  };
}).map((e) => (e.title ? `# ${e.title}:\n${e.text}` : e.text));

await generateText({
  model: openai.chat("gpt-4o-mini"),
  prompt: "Use the following context:\n\n" + contexts.join("\n---\n") +
    "\n\n---\n\n Based on the context, answer the question:\n\n" + args.query,
});
```

### Lifecycle Management

Delete an entry:

```ts
export const delete = mutation({
  args: { entryId: vEntry },
  handler: async (ctx, args) => {
    await rag.delete(ctx, {
      entryId: args.entryId,
    });
  },
});
```

See more example usage in [example.ts](./example/convex/example.ts).

Run the example with `npm i && npm run example`.
<!-- END: Include on https://convex.dev/components -->
