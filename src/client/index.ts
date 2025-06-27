import { v, type Value, type VString } from "convex/values";
import {
  type ActionCtx,
  type DocumentSearchComponent,
  type RunMutationCtx,
  type RunQueryCtx,
  type OnCompleteNamespace,
  type NamespaceId,
  type DocumentId,
  type RunActionCtx,
  type OnCompleteDocument,
  vDocumentId,
  vNamespaceId,
  type ChunkerAction,
} from "./types.js";
import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";
import { vSource, type Source } from "../component/schema.js";
import { CHUNK_BATCH_SIZE, type Chunk, type Status } from "../shared.js";
import {
  createFunctionHandle,
  internalActionGeneric,
  type FunctionArgs,
  type FunctionHandle,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import type { CreateChunkArgs, Document } from "../shared.js";
import { assert } from "convex-helpers";
import type { SearchResult } from "../component/search.js";

export { vNamespaceId, vDocumentId } from "./types.js";

export type {
  Document,
  DocumentSearchComponent,
  SearchResult,
  Source,
  Status,
  NamespaceId,
  DocumentId,
  OnCompleteNamespace,
};

const DEFAULT_SEARCH_LIMIT = 10;

// This is 0-1 with 1 being the most important and 0 being totally irrelevant.
// Used for vector search weighting.
type Importance = number;

type MastraChunk = {
  text: string;
  metadata: Record<string, Value>;
  embedding?: Array<number>;
};

type LangChainChunk = {
  id?: string;
  pageContent: string;
  metadata: Record<string, Value>; //{ loc: { lines: { from: number; to: number } } };
  embedding?: Array<number>;
};

export type InputChunk =
  | string
  | ((MastraChunk | LangChainChunk) & {
      // In the future we can add per-chunk metadata if it's useful.
      // importance?: Importance;
      // filters?: NamedFilter<FitlerNames>[];
    });

type NamedFilter<FilterNames extends string = string, ValueType = Value> = {
  name: FilterNames;
  value: ValueType;
};

export class DocumentSearch<
  // FitlerSchemas extends Record<
  //   FilterNames,
  //   Validator<Value, "required", string>
  // > = Record<string, never>,
  FilterNames extends string = string,
> {
  constructor(
    public component: DocumentSearchComponent,
    public options: {
      embeddingDimension: number;
      textEmbeddingModel: EmbeddingModelV1<string>;
      filterNames?: FilterNames[];
      // Common parameters:
      // logLevel
    }
  ) {}

  async upsertDocument(
    ctx: ActionCtx,
    args: ({ namespace: string } | { namespaceId: NamespaceId }) & {
      key: string;
      chunks: Iterable<InputChunk> | AsyncIterable<InputChunk>;
      source: Source;
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: NamedFilter<FilterNames>[];
      importance?: Importance;
      contentHash?: string;
    }
  ): Promise<{ documentId: DocumentId; status: Status }> {
    let namespaceId: NamespaceId;
    if ("namespaceId" in args) {
      namespaceId = args.namespaceId;
    } else {
      const namespace = await this.getOrCreateNamespace(ctx, {
        namespace: args.namespace,
        status: "ready",
      });
      namespaceId = namespace.namespaceId;
    }

    validateUpsertFilterValues(args.filterValues, this.options.filterNames);

    const { source, contentHash } = await getSource(ctx, args.source);

    let allChunks: CreateChunkArgs[] | undefined;
    if (Array.isArray(args.chunks) && args.chunks.length < CHUNK_BATCH_SIZE) {
      allChunks = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        args.chunks
      );
    }

    const { documentId, status } = await ctx.runMutation(
      this.component.documents.upsert,
      {
        document: {
          key: args.key,
          namespaceId,
          source,
          title: args.title,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash,
        },
        allChunks,
      }
    );
    if (status === "ready") {
      return { documentId: documentId as DocumentId, status };
    }

    // break chunks up into batches, respecting soft limit
    let startOrder = 0;
    let isPending = false;
    for await (const batch of batchIterator(args.chunks, CHUNK_BATCH_SIZE)) {
      const createChunkArgs = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        batch
      );
      const { status } = await ctx.runMutation(this.component.chunks.insert, {
        documentId,
        startOrder,
        chunks: createChunkArgs,
      });
      startOrder += createChunkArgs.length;
      if (status === "pending") {
        isPending = true;
      }
    }
    if (isPending) {
      let startOrder = 0;
      // replace any older version of the document with the new one
      while (true) {
        const { status, nextStartOrder } = await ctx.runMutation(
          this.component.chunks.replaceChunksPage,
          { documentId, startOrder }
        );
        if (status === "ready") {
          break;
        } else if (status === "replaced") {
          return {
            documentId: documentId as DocumentId,
            status: "replaced" as const,
          };
        }
        startOrder = nextStartOrder;
      }
    }
    await ctx.runMutation(this.component.documents.promoteToReady, {
      documentId,
    });
    return { documentId: documentId as DocumentId, status: "ready" as const };
  }

  async upsertDocumentAsync(
    ctx: ActionCtx,
    args: ({ namespace: string } | { namespaceId: NamespaceId }) & {
      key: string;
      source: Source;
      /**
       * A function that splits the document into chunks and embeds them.
       * This should be passed as internal.foo.myChunkerAction
       * e.g.
       * ```ts
       * export const myChunkerAction = documentSearch.defineChunkerAction();
       *
       * // in your mutation
       *   const documentId = await documentSearch.upsertDocumentAsync(ctx, {
       *     key: "myfile.txt",
       *     namespace: "my-namespace",
       *     source: { url: "https://my-url.com" },
       *     chunker: internal.foo.myChunkerAction,
       *   });
       */
      chunkerAction: ChunkerAction;
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: NamedFilter<FilterNames>[];
      importance?: Importance;
      contentHash?: string;
      onComplete?: OnCompleteDocument;
    }
  ): Promise<{ documentId: DocumentId; status: Status }> {
    let namespaceId: NamespaceId;
    if ("namespaceId" in args) {
      namespaceId = args.namespaceId;
    } else {
      const namespace = await this.getOrCreateNamespace(ctx, {
        namespace: args.namespace,
        status: "ready",
      });
      namespaceId = namespace.namespaceId;
    }

    validateUpsertFilterValues(args.filterValues, this.options.filterNames);

    const { source, contentHash } = await getSource(ctx, args.source);
    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
    const chunker = await createFunctionHandle(args.chunkerAction);

    const { documentId, status } = await ctx.runMutation(
      this.component.documents.upsertAsync,
      {
        document: {
          key: args.key,
          namespaceId,
          title: args.title,
          source,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash,
        },
        onComplete,
        chunker,
      }
    );
    return { documentId: documentId as DocumentId, status };
  }

  async search(
    ctx: RunActionCtx,
    args: {
      /** The search query. */
      query: string;
      /** The namespace to search in. e.g. a userId if documents are per-user. */
      namespace: string;
      /**
       * Filters to apply to the search. These are OR'd together. To represent
       * AND logic, your filter can be an object or array with multiple values.
       * e.g. `[{ category: "articles" }, { priority: "high" }]` will return
       * documents that have "articles" category OR "high" priority.
       * `[{ category_priority: ["articles", "high"] }]` will return
       * documents that have "articles" category AND "high" priority.
       * This requires inserting the documents with these filter values exactly.
       * e.g. if you insert a document with
       * `{ team_user: { team: "team1", user: "user1" } }`, it will not match
       * `{ team_user: { team: "team1" } }` but it will match
       */
      filters?: NamedFilter<FilterNames>[];
      /**
       * The maximum number of messages to fetch. Default is 10.
       * This is the number *before* the chunkContext is applied.
       * e.g. { before: 2, after: 1 } means 4x the limit is returned.
       */
      limit: number;
      /**
       * What chunks around the search results to include.
       * Default: { before: 0, after: 0 }
       * e.g. { before: 2, after: 1 } means 2 chunks before + 1 chunk after.
       * If `chunk4` was the only result, the results returned would be:
       * `[{ content: [chunk2, chunk3, chunk4, chunk5], score, ... }]`
       * The results don't overlap, and bias toward giving "before" context.
       * So if `chunk7` was also a result, the results returned would be:
       * `[
       *   { content: [chunk2, chunk3, chunk4], score, ... }
       *   { content: [chunk5, chunk6, chunk7, chunk8], score, ... },
       * ]`
       */
      chunkContext?: { before: number; after: number };
    }
  ): Promise<{
    results: SearchResult[];
    text: string[];
    documents: Document[];
  }> {
    const {
      namespace,
      filters = [],
      limit = DEFAULT_SEARCH_LIMIT,
      chunkContext = { before: 0, after: 0 },
    } = args;
    const { embedding } = await embed({
      model: this.options.textEmbeddingModel,
      value: args.query,
    });
    const { results, documents } = await ctx.runAction(
      this.component.search.search,
      {
        embedding,
        namespace,
        modelId: this.options.textEmbeddingModel.modelId,
        filters,
        limit,
        chunkContext,
      }
    );
    return {
      results: results as SearchResult[],
      text: results.map((r) => r.content.map((c) => c.text).join("\n")),
      documents: documents as Document[],
    };
  }

  async getOrCreateNamespace(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      status?: Status;
      onComplete?: OnCompleteNamespace;
    }
  ): Promise<{
    namespaceId: NamespaceId;
    status: "pending" | "ready" | "replaced";
  }> {
    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
    assert(
      args.status !== "replaced",
      "Creating replaced namespaces is not supported"
    );
    const { namespaceId, status } = await ctx.runMutation(
      this.component.namespaces.getOrCreate,
      {
        namespace: args.namespace,
        status:
          args.status === "pending"
            ? { kind: "pending", onComplete }
            : { kind: "ready" },
        modelId: this.options.textEmbeddingModel.modelId,
        dimension: this.options.embeddingDimension,
        filterNames: this.options.filterNames ?? [],
      }
    );
    return { namespaceId: namespaceId as NamespaceId, status };
  }

  async getNamespaceStatus(
    ctx: RunQueryCtx,
    args: {
      namespaceId: NamespaceId;
    }
  ): Promise<{ status: Status }> {
    const { status } = await ctx.runQuery(this.component.namespaces.get, {
      namespaceId: args.namespaceId,
    });
    return { status };
  }

  async listChunks(
    ctx: RunQueryCtx,
    args: {
      paginationOpts: PaginationOptions;
      documentId: DocumentId;
    }
  ): Promise<PaginationResult<Chunk>> {
    return ctx.runQuery(this.component.chunks.list, {
      documentId: args.documentId,
      paginationOpts: args.paginationOpts,
    });
  }

  async deleteDocument(
    ctx: RunMutationCtx,
    args: {
      documentId: DocumentId;
    }
  ) {
    await ctx.runMutation(this.component.documents.deleteDocumentAsync, {
      documentId: args.documentId,
      startOrder: 0,
    });
  }

  defineChunkerAction(
    // TODO: make this optional if you want to use the default chunker
    fn: (
      ctx: ActionCtx,
      args: {
        namespace: string;
        namespaceId: NamespaceId;
        key: string; // document key
        documentId: DocumentId;
        source: Source;
      }
    ) => AsyncIterable<InputChunk> | Promise<{ chunks: InputChunk[] }>
  ) {
    return internalActionGeneric({
      args: v.object({
        namespace: v.string(),
        namespaceId: vNamespaceId,
        key: v.string(),
        documentId: vDocumentId,
        source: vSource,
        insertChunksHandle: v.string() as VString<
          FunctionHandle<
            "mutation",
            FunctionArgs<DocumentSearchComponent["chunks"]["insert"]>,
            null
          >
        >,
        importance: v.number(),
      }),
      handler: async (ctx, args) => {
        const { namespace, namespaceId, key, documentId, source } = args;
        const chunksPromise = fn(ctx, {
          namespace,
          namespaceId,
          key,
          documentId,
          source,
        });
        let chunkIterator: AsyncIterable<InputChunk>;
        if (chunksPromise instanceof Promise) {
          const chunks = await chunksPromise;
          chunkIterator = {
            [Symbol.asyncIterator]: async function* () {
              yield* chunks.chunks;
            },
          };
        } else {
          chunkIterator = chunksPromise;
        }
        let batchOrder = 0;
        for await (const batch of batchIterator(
          chunkIterator,
          CHUNK_BATCH_SIZE
        )) {
          const createChunkArgs = await createChunkArgsBatch(
            this.options.textEmbeddingModel,
            batch
          );
          await ctx.runMutation(args.insertChunksHandle, {
            documentId,
            startOrder: batchOrder,
            chunks: createChunkArgs,
          });
          batchOrder += createChunkArgs.length;
        }
      },
    });
  }
}

async function* batchIterator<T>(
  iterator: Iterable<T> | AsyncIterable<T>,
  batchSize: number
): AsyncIterable<T[]> {
  let batch: T[] = [];
  for await (const item of iterator) {
    batch.push(item);
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

function validateUpsertFilterValues<FilterNames extends string = string>(
  filterValues: NamedFilter<FilterNames>[] | undefined,
  filterNames: FilterNames[] | undefined
) {
  if (!filterValues) {
    return;
  }
  if (!filterNames) {
    throw new Error(
      "You must provide filter names to DocumentSearch to upsert documents with filters."
    );
  }
  const seen = new Set<FilterNames>();
  for (const filterValue of filterValues) {
    if (seen.has(filterValue.name)) {
      throw new Error(
        `You cannot provide the same filter name twice: ${filterValue.name}.`
      );
    }
    seen.add(filterValue.name);
  }
  for (const filterName of filterNames) {
    if (!seen.has(filterName)) {
      throw new Error(
        `Filter name ${filterName} is not valid (one of ${filterNames.join(", ")}).`
      );
    }
  }
}

function makeBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

async function createChunkArgsBatch(
  embedModel: EmbeddingModelV1<string>,
  chunks: InputChunk[]
): Promise<CreateChunkArgs[]> {
  const argsMaybeMissingEmbeddings: (Omit<CreateChunkArgs, "embedding"> & {
    embedding?: number[];
  })[] = chunks.map((chunk) => {
    if (typeof chunk === "string") {
      return { content: { text: chunk } };
    } else if ("text" in chunk) {
      return {
        content: { text: chunk.text, metadata: chunk.metadata },
        embedding: chunk.embedding,
      };
    } else if ("pageContent" in chunk) {
      return {
        content: { text: chunk.pageContent, metadata: chunk.metadata },
        embedding: chunk.embedding,
      };
    } else {
      throw new Error("Invalid chunk");
    }
  });
  const missingEmbeddingsWithIndex = argsMaybeMissingEmbeddings
    .map((arg, index) =>
      arg.embedding
        ? null
        : {
            text: arg.content.text,
            index,
          }
    )
    .filter((b) => b !== null);
  for (const batch of makeBatches(missingEmbeddingsWithIndex, 100)) {
    const { embeddings } = await embedMany({
      model: embedModel,
      values: batch.map((b) => b.text),
    });
    for (const [index, embedding] of embeddings.entries()) {
      argsMaybeMissingEmbeddings[batch[index].index].embedding = embedding;
    }
  }
  return argsMaybeMissingEmbeddings.filter((a) => {
    if (a.embedding === undefined) {
      throw new Error("Embedding is undefined for chunk " + a.content.text);
    }
    return true;
  }) as CreateChunkArgs[];
}

async function getSource(
  ctx: ActionCtx,
  {
    storageId,
    url,
    contentHash,
  }: { storageId?: string; url?: string; contentHash?: string }
): Promise<{ source: Source; contentHash: string }> {
  assert(storageId || url, "Either storageId or url must be provided");
  if (storageId) {
    const metadata = await ctx.storage.getMetadata(storageId);
    assert(metadata, "Storage metadata not found for storageId " + storageId);
    return {
      source: { kind: "_storage", storageId },
      contentHash: metadata.sha256,
    };
  } else {
    assert(url);
    return { source: { kind: "url", url }, contentHash: contentHash ?? url };
  }
}

/**
 * Rank results from multiple results, e.g. from vector search and text search.
 * Uses the "Recriprocal Rank Fusion" algorithm.
 * @param sortedResults The results arrays ordered by most important first.
 */
export function hybridRank<T extends string>(
  sortedResults: T[][],
  opts?: {
    /**
     * A constant used to change the bias of the top results in each list vs.
     * results in the middle of multiple lists.
     * A higher k means less of a bias toward the top few results.
     */
    k: number;
    /**
     * The weights of each sortedResults array.
     * Used to prefer results from one sortedResults array over another.
     */
    weights: number[];
    /**
     * The cutoff score for a result to be returned.
     */
    cutoffScore?: number;
  }
): T[] {
  const k = opts?.k ?? 10;
  const scores: Map<T, number> = new Map();
  for (const [i, results] of sortedResults.entries()) {
    const weight = opts?.weights?.[i] ?? 1;
    for (let j = 0; j < results.length; j++) {
      const key = results[j];
      scores.set(key, (scores.get(key) ?? 0) + weight / (k + j));
    }
  }
  const sortedScores = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  return sortedScores
    .filter(([_, score]) => score >= (opts?.cutoffScore ?? 0))
    .map(([key]) => key);
}
