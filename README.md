# Convex RAG Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Frag.svg)](https://badge.fury.io/js/@convex-dev%2Frag)

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

### Add context to RAG

Add content with text chunks. Each call to `add` will create a new **entry**.
It will embed the chunks automatically if you don't provide them.

```ts
export const add = action({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    // Add the text to a namespace shared by all users.
    await rag.add(ctx, {
      namespace: "all-users",
      text,
    });
  },
});
```

See below for how to add content asynchronously, e.g. to handle large files.

### Generate a response based on RAG context

You can use the `generateText` function to generate a response based on RAG context. This will automatically search for relevant entries and use them as context for the LLM, using default formatting.

The arguments to `generateText` are compatible with all arguments to `generateText` from the AI SDK.

To have more control over the context and prompting, you can use the `search` function to get the context, and then use any model to generate a response.
See below for more details.

```ts
export const askQuestion = action({
  args: {
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const { text, context } = await rag.generateText(ctx, {
      search: { namespace: userId, limit: 10 },
      prompt: args.prompt,
      model: openai.chat("gpt-4o-mini"),
    });
    return { answer: text, context };
  },
```

Note: You can specify any of the search options available on `rag.search`.
See below for more details.

### Using your own content splitter

By default, the component uses the `defaultChunker` to split the content into chunks.
You can pass in your own content chunks to the `add` or `addAsync` functions.

```ts
const chunks = await textSplitter.split(content);
await rag.add(ctx, { namespace: "global", chunks });
```

Note: The `textSplitter` here could be LangChain, Mastra, or something custom.
The simplest version makes an array of strings like `content.split("\n")`.

Note: you can pass in an async iterator instead of an array to handle large content.

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

### Using keys to gracefully replace content

When you add content to a namespace, you can provide a `key` to uniquely identify the content.
If you add content with the same key, it will replace the existing content.

```ts
await rag.add(ctx, { namespace: userId, key: "my-file.txt", text });
```

When a new document is added, it will start with a status of "pending" while
it chunks, embeds, and inserts the data into the database.
Once all data is inserted, it will iterate over the chunks and swap the old
content embeddings with the new ones, and then update the status to "ready",
marking the previous version as "replaced".

The old content is kept around by default, so in-flight searches will get
results for old vector search results.
See below for more details on deleting.

This means that if searches are happening while the document is being added,
they will see the old content results
This is useful if you want to add content to a namespace and then immediately
search for it, or if you want to add content to a namespace and then immediately
add more content to the same namespace.

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

### Providing custom embeddings per-chunk

In addition to the text, you can provide your own embeddings for each chunk.

This can be beneficial if you want to embed something other than the chunk
contents, e.g. a summary of each chunk.

```ts
const chunks = await textSplitter.split(content);
const chunksWithEmbeddings = await Promise.all(chunks.map(async chunk => {
  return {
    ...chunk,
    embedding: await embedSummary(chunk)
  }
}));
await rag.add(ctx, { namespace: "global", chunks });
```

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
      onComplete: internal.foo.docComplete, // See next section
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

export default cors.http;
```

You can upload files directly to a Convex action, httpAction, or upload url.
See the [docs](https://docs.convex.dev/file-storage/upload-files) for details.

### OnComplete Handling

You can register an `onComplete` handler when adding content that will be called
when the entry is ready, or if there was an error or it was replaced before it
finished.

```ts
// in an action
await rag.add(ctx, { namespace, text, onComplete: internal.foo.docComplete });

// in convex/foo.ts
export const docComplete = rag.defineOnComplete<DataModel>(
  async (ctx, { replacedEntry, entry, namespace, error }) => {
    if (error) {
      await rag.delete(ctx, { entryId: entry.entryId });
      return;
    }
    if (replacedEntry) {
      await rag.delete(ctx, { entryId: replacedEntry.entryId });
    }
    // You can associate the entry with your own data here. This will commit
    // in the same transaction as the entry becoming ready.
  }
);
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

### Lifecycle Management

You can delete the old content by calling `rag.delete` with the entryId of the
old version.

Generally you'd do this:

1. When using `rag.add` with a key returns a `replacedEntry`.
1. When your `onComplete` handler provides a non-null `replacedEntry` argument.
1. Periodically by querying:

```ts
const toDelete = await rag.list(ctx, {
  status: "replaced",
  paginationOpts: { cursor: null, numItems: 100 }
});

for (const entry of toDelete) {
  assert(entry.status === "replaced");
  if (entry.replacedAt >= Date.now() - ONE_WEEK_MS) {
    break;
  }
  await rag.delete(ctx, { entryId: entry.entryId });
}
```

### Example Usage

See more example usage in [example.ts](./example/convex/example.ts).

### Running the example

Run the example with `npm i && npm run setup && npm run example`.
<!-- END: Include on https://convex.dev/components -->
