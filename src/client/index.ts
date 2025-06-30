import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";
import { assert } from "convex-helpers";
import {
  createFunctionHandle,
  internalActionGeneric,
  type FunctionArgs,
  type FunctionHandle,
  type FunctionReturnType,
  type PaginationOptions,
  type PaginationResult,
  type RegisteredAction,
} from "convex/server";
import { type Value } from "convex/values";
import {
  CHUNK_BATCH_SIZE,
  vChunkerArgs,
  vEntryId,
  vNamespaceId,
  type Chunk,
  type CreateChunkArgs,
  type Entry,
  type EntryFilterValues,
  type EntryId,
  type Namespace,
  type NamespaceId,
  type SearchResult,
  type Status,
} from "../shared.js";
import {
  type ActionCtx,
  type MemoryComponent,
  type RunActionCtx,
  type RunMutationCtx,
  type RunQueryCtx,
} from "./types.js";
import {
  type ChunkerAction,
  type OnComplete,
  type OnCompleteNamespace,
} from "../shared.js";
import type { NamedFilter } from "../component/filters.js";

export { vEntry, vSearchResult, type VEntry } from "../shared.js";
export { vEntryId, vNamespaceId };
export {
  contentHashFromBlob,
  guessMimeTypeFromExtension,
  guessMimeTypeFromContents,
} from "./fileUtils.js";

export type {
  ChunkerAction,
  Entry,
  EntryId,
  MemoryComponent,
  NamespaceId,
  OnComplete,
  OnCompleteNamespace,
  SearchResult,
  Status,
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
      // Space-delimited keywords to text search on.
      // TODO: implement text search
      keywords?: string;
      // In the future we can add per-chunk metadata if it's useful.
      // importance?: Importance;
      // filters?: EntryFilterValues<FitlerSchemas>[];
    });

export class Memory<
  FitlerSchemas extends Record<FilterNames, Value> = Record<string, Value>,
  FilterNames extends string = string,
> {
  constructor(
    public component: MemoryComponent,
    public options: {
      embeddingDimension: number;
      textEmbeddingModel: EmbeddingModelV1<string>;
      filterNames?: FilterNames[];
      // Common parameters:
      // logLevel
    }
  ) {}

  async add(
    ctx: RunMutationCtx,
    args: ({ namespace: string } | { namespaceId: NamespaceId }) & {
      key?: string | undefined;
      chunks: Iterable<InputChunk> | AsyncIterable<InputChunk>;
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: EntryFilterValues<FitlerSchemas>[];
      importance?: Importance;
      contentHash?: string;
    }
  ): Promise<{
    entryId: EntryId;
    status: Status;
    created: boolean;
    replacedVersion: Entry | null;
  }> {
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

    validateAddFilterValues(args.filterValues, this.options.filterNames);

    let allChunks: CreateChunkArgs[] | undefined;
    if (Array.isArray(args.chunks) && args.chunks.length < CHUNK_BATCH_SIZE) {
      allChunks = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        args.chunks
      );
    }

    const { entryId, status, created, replacedVersion } = await ctx.runMutation(
      this.component.entries.add,
      {
        entry: {
          key: args.key,
          namespaceId,
          title: args.title,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
        },
        allChunks,
      }
    );
    if (status === "ready") {
      return {
        entryId: entryId as EntryId,
        status,
        created,
        replacedVersion: replacedVersion as Entry | null,
      };
    }

    // break chunks up into batches, respecting soft limit
    let startOrder = 0;
    let isPending = false;
    for await (const batch of batchIterator(args.chunks, CHUNK_BATCH_SIZE)) {
      const chunks = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        batch
      );
      const { status } = await ctx.runMutation(this.component.chunks.insert, {
        entryId,
        startOrder,
        chunks,
      });
      startOrder += chunks.length;
      if (status === "pending") {
        isPending = true;
      }
    }
    if (isPending) {
      let startOrder = 0;
      // replace any older version of the entry with the new one
      while (true) {
        const { status, nextStartOrder } = await ctx.runMutation(
          this.component.chunks.replaceChunksPage,
          { entryId, startOrder }
        );
        if (status === "ready") {
          break;
        } else if (status === "replaced") {
          return {
            entryId: entryId as EntryId,
            status: "replaced" as const,
            created: false,
            replacedVersion: null,
          };
        }
        startOrder = nextStartOrder;
      }
    }
    const promoted = await ctx.runMutation(
      this.component.entries.promoteToReady,
      { entryId }
    );
    return {
      entryId: entryId as EntryId,
      status: "ready" as const,
      replacedVersion: promoted.replacedVersion as Entry | null,
      created: true,
    };
  }

  async addAsync(
    ctx: RunMutationCtx,
    args: ({ namespace: string } | { namespaceId: NamespaceId }) & {
      key: string;
      /**
       * A function that splits the entry into chunks and embeds them.
       * This should be passed as internal.foo.myChunkerAction
       * e.g.
       * ```ts
       * export const myChunkerAction = memory.defineChunkerAction();
       *
       * // in your mutation
       *   const entryId = await memory.addAsync(ctx, {
       *     key: "myfile.txt",
       *     namespace: "my-namespace",
       *     chunker: internal.foo.myChunkerAction,
       *   });
       */
      chunkerAction: ChunkerAction;
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: EntryFilterValues<FitlerSchemas>[];
      importance?: Importance;
      contentHash?: string;
      onComplete?: OnComplete;
    }
  ): Promise<{ entryId: EntryId; status: Status }> {
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

    validateAddFilterValues(args.filterValues, this.options.filterNames);

    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
    const chunker = await createFunctionHandle(args.chunkerAction);

    const { entryId, status } = await ctx.runMutation(
      this.component.entries.addAsync,
      {
        entry: {
          key: args.key,
          namespaceId,
          title: args.title,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
        },
        onComplete,
        chunker,
      }
    );
    return { entryId: entryId as EntryId, status };
  }

  async search(
    ctx: RunActionCtx,
    args: (
      | {
          /**
           * The query to search for. Optional if embedding is provided.
           */
          query: string;
          /**
           * You may specify an embedding or query, but not both for now.
           */
          embedding?: undefined;
        }
      | {
          /**
           * The embedding to search for.
           */
          embedding: Array<number>;
          /**
           * You may specify an embedding or query, but not both for now.
           */
          query?: undefined;
        }
    ) & {
      /** The namespace to search in. e.g. a userId if entries are per-user. */
      namespace: string;
      /**
       * Filters to apply to the search. These are OR'd together. To represent
       * AND logic, your filter can be an object or array with multiple values.
       * e.g. `[{ category: "articles" }, { priority: "high" }]` will return
       * entries that have "articles" category OR "high" priority.
       * `[{ category_priority: ["articles", "high"] }]` will return
       * entries that have "articles" category AND "high" priority.
       * This requires inserting the entries with these filter values exactly.
       * e.g. if you insert a entry with
       * `{ team_user: { team: "team1", user: "user1" } }`, it will not match
       * `{ team_user: { team: "team1" } }` but it will match
       */
      filters?: EntryFilterValues<FitlerSchemas>[];
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
      /**
       * The minimum score to return a result.
       */
      vectorScoreThreshold?: number;
    }
  ): Promise<{
    results: SearchResult[];
    text: string;
    entries: (Entry<FitlerSchemas> & { text: string })[];
  }> {
    const {
      namespace,
      filters = [],
      limit = DEFAULT_SEARCH_LIMIT,
      chunkContext = { before: 0, after: 0 },
      vectorScoreThreshold,
    } = args;
    let embedding = args.embedding;
    if (!embedding) {
      const embedResult = await embed({
        model: this.options.textEmbeddingModel,
        value: args.query,
      });
      embedding = embedResult.embedding;
    }
    const { results, entries } = await ctx.runAction(
      this.component.search.search,
      {
        embedding,
        namespace,
        modelId: this.options.textEmbeddingModel.modelId,
        filters,
        limit,
        vectorScoreThreshold,
        chunkContext,
      }
    );
    const entriesWithTexts = entries.map((e) => {
      const ranges = results
        .filter((r) => r.entryId === e.entryId)
        .sort((a, b) => a.startOrder - b.startOrder);
      let text = "";
      let previousEnd = 0;
      for (const range of ranges) {
        if (previousEnd !== 0) {
          if (range.startOrder !== previousEnd) {
            text += "\n...\n";
          } else {
            text += "\n";
          }
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
    });

    return {
      results: results as SearchResult[],
      text: entriesWithTexts
        .map((e) => (e.title ? `# ${e.title}:\n${e.text}` : e.text))
        .join(`\n---\n`),
      entries: entriesWithTexts,
    };
  }

  async list(
    ctx: RunQueryCtx,
    args: {
      namespaceId: NamespaceId;
      paginationOpts: PaginationOptions;
      order?: "desc" | "asc";
      status?: Status;
    }
  ): Promise<PaginationResult<Entry<FitlerSchemas>>> {
    const results = await ctx.runQuery(this.component.entries.list, {
      namespaceId: args.namespaceId,
      paginationOpts: args.paginationOpts,
      order: args.order ?? "asc",
      status: args.status ?? "ready",
    });
    return results as PaginationResult<Entry<FitlerSchemas>>;
  }

  async getEntry(
    ctx: RunQueryCtx,
    args: {
      entryId: EntryId;
    }
  ): Promise<Entry<FitlerSchemas> | null> {
    const entry = await ctx.runQuery(this.component.entries.get, {
      entryId: args.entryId,
    });
    return entry as Entry<FitlerSchemas> | null;
  }

  async findExistingEntryByContentHash(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      key: string;
      /** The hash of the entry contents to try to match. */
      contentHash: string;
    }
  ): Promise<Entry<FitlerSchemas> | null> {
    const entry = await ctx.runQuery(this.component.entries.findByContentHash, {
      namespace: args.namespace,
      dimension: this.options.embeddingDimension,
      filterNames: this.options.filterNames ?? [],
      modelId: this.options.textEmbeddingModel.modelId,
      key: args.key,
      contentHash: args.contentHash,
    });
    return entry as Entry<FitlerSchemas> | null;
  }

  async getOrCreateNamespace(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      /**
       * If it isn't in existence, what the new namespace status should be.
       */
      status?: "pending" | "ready";
      /**
       * This will be called when then namespace leaves the "pending" state.
       * Either if the namespace is created or if the namespace is replaced
       * along the way.
       */
      onComplete?: OnCompleteNamespace;
    }
  ): Promise<{
    namespaceId: NamespaceId;
    status: "pending" | "ready";
  }> {
    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
    assert(
      !onComplete || args.status === "pending",
      "You can only supply an onComplete handler for pending namespaces"
    );
    const { namespaceId, status } = await ctx.runMutation(
      this.component.namespaces.getOrCreate,
      {
        namespace: args.namespace,
        status: args.status ?? "ready",
        onComplete,
        modelId: this.options.textEmbeddingModel.modelId,
        dimension: this.options.embeddingDimension,
        filterNames: this.options.filterNames ?? [],
      }
    );
    return { namespaceId: namespaceId as NamespaceId, status };
  }

  async getNamespace(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
    }
  ): Promise<Namespace | null> {
    return ctx.runQuery(this.component.namespaces.get, {
      namespace: args.namespace,
      modelId: this.options.textEmbeddingModel.modelId,
      dimension: this.options.embeddingDimension,
      filterNames: this.options.filterNames ?? [],
    }) as Promise<Namespace | null>;
  }

  async listChunks(
    ctx: RunQueryCtx,
    args: {
      paginationOpts: PaginationOptions;
      entryId: EntryId;
    }
  ): Promise<PaginationResult<Chunk>> {
    return ctx.runQuery(this.component.chunks.list, {
      entryId: args.entryId,
      paginationOpts: args.paginationOpts,
    });
  }

  async delete(ctx: RunMutationCtx, args: { entryId: EntryId }) {
    await ctx.runMutation(this.component.entries.deleteAsync, {
      entryId: args.entryId,
      startOrder: 0,
    });
  }

  defineChunkerAction(
    // TODO: make this optional if you want to use the default chunker
    fn: (
      ctx: ActionCtx,
      args: { namespace: Namespace; entry: Entry }
    ) => AsyncIterable<InputChunk> | Promise<{ chunks: InputChunk[] }>
  ): RegisteredAction<
    "internal",
    FunctionArgs<ChunkerAction>,
    FunctionReturnType<ChunkerAction>
  > {
    return internalActionGeneric({
      args: vChunkerArgs,
      handler: async (ctx, args) => {
        const { namespace, entry } = args;
        const chunksPromise = fn(ctx, {
          namespace,
          entry,
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
          await ctx.runMutation(
            args.insertChunks as FunctionHandle<
              "mutation",
              FunctionArgs<MemoryComponent["chunks"]["insert"]>,
              null
            >,
            {
              entryId: entry.entryId,
              startOrder: batchOrder,
              chunks: createChunkArgs,
            }
          );
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

function validateAddFilterValues(
  filterValues: NamedFilter[] | undefined,
  filterNames: string[] | undefined
) {
  if (!filterValues) {
    return;
  }
  if (!filterNames) {
    throw new Error(
      "You must provide filter names to Memory to add entries with filters."
    );
  }
  const seen = new Set<string>();
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
      const { text, metadata, keywords: searchableText } = chunk;
      return {
        content: { text, metadata },
        embedding: chunk.embedding,
        searchableText,
      };
    } else if ("pageContent" in chunk) {
      const { pageContent: text, metadata, keywords: searchableText } = chunk;
      return {
        content: { text, metadata },
        embedding: chunk.embedding,
        searchableText,
      };
    } else {
      throw new Error("Invalid chunk: " + JSON.stringify(chunk));
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
