import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { embed, embedMany, generateText, type CoreMessage } from "ai";
import { assert } from "convex-helpers";
import {
  createFunctionHandle,
  internalActionGeneric,
  internalMutationGeneric,
  type FunctionArgs,
  type FunctionHandle,
  type FunctionReturnType,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type PaginationOptions,
  type PaginationResult,
  type RegisteredAction,
  type RegisteredMutation,
} from "convex/server";
import { type Value } from "convex/values";
import {
  CHUNK_BATCH_SIZE,
  filterNamesContain,
  vChunkerArgs,
  vEntryId,
  vNamespaceId,
  vOnCompleteArgs,
  type Chunk,
  type CreateChunkArgs,
  type Entry,
  type EntryFilter,
  type EntryId,
  type Namespace,
  type NamespaceId,
  type SearchEntry,
  type SearchResult,
  type Status,
} from "../shared.js";
import {
  type RAGComponent,
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
import { defaultChunker } from "./defaultChunker.js";

export { defaultChunker, vEntryId, vNamespaceId };
export type {
  ChunkerAction,
  Entry,
  EntryId,
  RAGComponent,
  NamespaceId,
  OnComplete,
  OnCompleteNamespace,
  SearchEntry,
  SearchResult,
  Status,
};

export {
  type VEntry,
  type VSearchEntry,
  type EntryFilter,
  vEntry,
  vSearchEntry,
  vSearchResult,
  vOnCompleteArgs,
} from "../shared.js";
export {
  contentHashFromArrayBuffer,
  guessMimeTypeFromExtension,
  guessMimeTypeFromContents,
} from "./fileUtils.js";

const DEFAULT_SEARCH_LIMIT = 10;

// This is 0-1 with 1 being the most important and 0 being totally irrelevant.
// Used for vector search weighting.
type Importance = number;

export class RAG<
  FitlerSchemas extends Record<string, Value> = Record<string, Value>,
  EntryMetadata extends Record<string, Value> = Record<string, Value>,
> {
  /**
   * A component to use for Retrieval-Augmented Generation.
   * Create one for each model and embedding dimension you want to use.
   * When migrating between models / embedding lengths, create multiple
   * instances and do your `add`s with the appropriate instance, and searches
   * against the appropriate instance to get results with those parameters.
   *
   * The filterNames need to match the names of the filters you provide when
   * adding and when searching. Use the type parameter to make this type safe.
   *
   * The second type parameter makes the entry metadata type safe. E.g. you can
   * do rag.add(ctx, {
   *   namespace: "my-namespace",
   *   metadata: {
   *     source: "website" as const,
   *   },
   * })
   * and then entry results will have the metadata type `{ source: "website" }`.
   */
  constructor(
    public component: RAGComponent,
    public options: {
      embeddingDimension: number;
      textEmbeddingModel: EmbeddingModelV1<string>;
      filterNames?: FilterNames<FitlerSchemas>;
    }
  ) {}

  /**
   * Add an entry to the store. It will chunk the text with the `defaultChunker`
   * if you don't provide chunks, and embed the chunks with the default model
   * if you don't provide chunk embeddings.
   *
   * If you provide a key, it will replace an existing entry with the same key.
   * If you don't provide a key, it will always create a new entry.
   * If you provide a contentHash, it will deduplicate the entry if it already exists.
   * The filterValues you provide can be used later to search for it.
   */
  async add(
    ctx: RunMutationCtx,
    args: NamespaceSelection &
      EntryArgs<FitlerSchemas, EntryMetadata> &
      (
        | {
            /**
             * You can provide your own chunks to finely control the splitting.
             * These can also include your own provided embeddings, so you can
             * control what content is embedded, which can differ from the content
             * in the chunks.
             */
            chunks: Iterable<InputChunk> | AsyncIterable<InputChunk>;
            /** @deprecated You cannot specify both chunks and text currently. */
            text?: undefined;
          }
        | {
            /**
             * If you don't provide chunks, we will split the text into chunks
             * using the default chunker and embed them with the default model.
             */
            text: string;
            /** @deprecated You cannot specify both chunks and text currently. */
            chunks?: undefined;
          }
      )
  ): Promise<{
    entryId: EntryId;
    status: Status;
    created: boolean;
    replacedEntry: Entry<FitlerSchemas, EntryMetadata> | null;
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

    const chunks = args.chunks ?? defaultChunker(args.text);
    let allChunks: CreateChunkArgs[] | undefined;
    if (Array.isArray(chunks) && chunks.length < CHUNK_BATCH_SIZE) {
      allChunks = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        chunks
      );
    }

    const onComplete =
      args.onComplete && (await createFunctionHandle(args.onComplete));

    const { entryId, status, created, replacedEntry } = await ctx.runMutation(
      this.component.entries.add,
      {
        entry: {
          key: args.key,
          namespaceId,
          title: args.title,
          metadata: args.metadata,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
        },
        onComplete,
        allChunks,
      }
    );
    if (status === "ready") {
      return {
        entryId: entryId as EntryId,
        status,
        created,
        replacedEntry: replacedEntry as Entry<
          FitlerSchemas,
          EntryMetadata
        > | null,
      };
    }

    // break chunks up into batches, respecting soft limit
    let startOrder = 0;
    let isPending = false;
    for await (const batch of batchIterator(chunks, CHUNK_BATCH_SIZE)) {
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
            replacedEntry: null,
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
      replacedEntry: promoted.replacedEntry as Entry<
        FitlerSchemas,
        EntryMetadata
      > | null,
      created: true,
    };
  }

  /**
   * Add an entry to the store asynchronously.
   *
   * This is useful if you want to chunk the entry in a separate process,
   * or if you want to chunk the entry in a separate process.
   *
   * The chunkerAction is a function that splits the entry into chunks and
   * embeds them. It should be passed as internal.foo.myChunkerAction
   * e.g.
   * ```ts
   * export const myChunkerAction = rag.defineChunkerAction(async (ctx, args) => {
   *   // ...
   *   return { chunks: [chunk1, chunk2, chunk3] };
   * });
   *
   * // in your mutation
   *   const entryId = await rag.addAsync(ctx, {
   *     key: "myfile.txt",
   *     namespace: "my-namespace",
   *     chunkerAction: internal.foo.myChunkerAction,
   *   });
   * ```
   */
  async addAsync(
    ctx: RunMutationCtx,
    args: NamespaceSelection &
      EntryArgs<FitlerSchemas, EntryMetadata> & {
        /**
         * A function that splits the entry into chunks and embeds them.
         * This should be passed as internal.foo.myChunkerAction
         * e.g.
         * ```ts
         * export const myChunkerAction = rag.defineChunkerAction();
         *
         * // in your mutation
         *   const entryId = await rag.addAsync(ctx, {
         *     key: "myfile.txt",
         *     namespace: "my-namespace",
         *     chunker: internal.foo.myChunkerAction,
         *   });
         */
        chunkerAction: ChunkerAction;
      }
  ): Promise<{ entryId: EntryId; status: "ready" | "pending" }> {
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
          metadata: args.metadata,
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

  /**
   * Search for entries in a namespace with configurable filters.
   * You can provide a query string or target embedding, as well as search
   * parameters to filter and constrain the results.
   */
  async search(
    ctx: RunActionCtx,
    args: {
      /**
       * The namespace to search in. e.g. a userId if entries are per-user.
       * Note: it will only match entries in the namespace that match the
       * modelId, embedding dimension, and filterNames of the RAG instance.
       */
      namespace: string;
      /**
       * The query to search for. Optional if embedding is provided.
       */
      query: string | Array<number>;
    } & SearchOptions<FitlerSchemas>
  ): Promise<{
    results: SearchResult[];
    text: string;
    entries: SearchEntry<FitlerSchemas, EntryMetadata>[];
  }> {
    const {
      namespace,
      filters = [],
      limit = DEFAULT_SEARCH_LIMIT,
      chunkContext = { before: 0, after: 0 },
      vectorScoreThreshold,
    } = args;
    let embedding = Array.isArray(args.query) ? args.query : undefined;
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
            text += "\n\n...\n\n";
          } else {
            text += "\n";
          }
        }
        text += range.content.map((c) => c.text).join("\n");
        previousEnd = range.startOrder + range.content.length;
      }
      return { ...e, text } as SearchEntry<FitlerSchemas, EntryMetadata>;
    });

    return {
      results: results as SearchResult[],
      text: entriesWithTexts
        .map((e) => (e.title ? `## ${e.title}:\n\n${e.text}` : e.text))
        .join(`\n\n---\n\n`),
      entries: entriesWithTexts,
    };
  }

  /**
   * Generate text based on Retrieval-Augmented Generation.
   *
   * This will search for entries in the namespace based on the prompt and use
   * the results as context to generate text, using the search options args.
   * You can override the default "system" message to provide instructions on
   * using the context and answering in the appropriate style.
   * You can provide "messages" in addition to the prompt to provide
   * extra context / conversation history.
   */
  async generateText(
    ctx: RunActionCtx,
    args: {
      /**
       * The search options to use for context search, including the namespace.
       */
      search: SearchOptions<FitlerSchemas> & {
        /**
         * The namespace to search in. e.g. a userId if entries are per-user.
         */
        namespace: string;
        /**
         * The text or embedding to search for. If provided, it will be used
         * instead of the prompt for vector search.
         */
        query?: string | Array<number>;
      };
      /**
       * Required. The prompt to use for context search, as well as the final
       * message to the LLM when generating text.
       * Can be used along with "messages"
       */
      prompt: string;
      /**
       * Additional messages to add to the context. Can be provided in addition
       * to the prompt, in which case it will precede the prompt.
       */
      messages?: CoreMessage[];
    } & Parameters<typeof generateText>[0]
  ): Promise<
    Awaited<ReturnType<typeof generateText>> & {
      context: {
        results: SearchResult[];
        text: string;
        entries: SearchEntry<FitlerSchemas, EntryMetadata>[];
      };
    }
  > {
    const {
      search: { namespace, ...searchOpts },
      prompt,
      ...aiSdkOpts
    } = args;
    const context = await this.search(ctx, {
      namespace,
      query: prompt,
      ...searchOpts,
    });
    let contextHeader =
      "Use the following context to respond to the user's question:\n";
    let contextContents = context.text;
    let contextFooter = "\n--------------------------------\n";
    let userQuestionHeader = "";
    let userQuestionFooter = "";
    let userPrompt = prompt;
    switch (aiSdkOpts.model.provider) {
      case "openai":
        userQuestionHeader = '**User question:**\n"""';
        userQuestionFooter = '"""';
        break;
      case "meta":
        userQuestionHeader = "**User question:**\n";
        break;
      case "google":
        userQuestionHeader = "<question>";
        userQuestionFooter = "</question>";
      // fallthrough
      case "anthropic":
        contextHeader = "<context>";
        contextContents = context.entries
          .map((e) =>
            e.title
              ? `<document title="${e.title}">${e.text}</document>`
              : `<document>${e.text}</document>`
          )
          .join("\n");
        contextFooter = "</context>";
        userPrompt = prompt.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        break;
      default:
    }
    const promptWithContext = [
      contextHeader,
      contextContents,
      contextFooter,
      "\n",
      userQuestionHeader,
      userPrompt,
      userQuestionFooter,
    ]
      .join("\n")
      .trim();

    const result = (await generateText({
      system:
        "You use the context provided only to produce a response. Do not preface the response with acknowledgement of the context.",
      ...aiSdkOpts,
      messages: [
        ...(args.messages ?? []),
        {
          role: "user",
          content: promptWithContext,
        },
      ],
    })) as Awaited<ReturnType<typeof generateText>> & {
      context: {
        results: SearchResult[];
        text: string;
        entries: SearchEntry<FitlerSchemas, EntryMetadata>[];
      };
    };
    result.context = context;
    return result;
  }

  /**
   * List all entries in a namespace.
   */
  async list(
    ctx: RunQueryCtx,
    args: {
      namespaceId?: NamespaceId;
      paginationOpts: PaginationOptions;
      order?: "desc" | "asc";
      status?: Status;
    }
  ): Promise<PaginationResult<Entry<FitlerSchemas, EntryMetadata>>> {
    const results = await ctx.runQuery(this.component.entries.list, {
      namespaceId: args.namespaceId,
      paginationOpts: args.paginationOpts,
      order: args.order ?? "asc",
      status: args.status ?? "ready",
    });
    return results as PaginationResult<Entry<FitlerSchemas, EntryMetadata>>;
  }

  /**
   * Get entry metadata by its id.
   */
  async getEntry(
    ctx: RunQueryCtx,
    args: {
      entryId: EntryId;
    }
  ): Promise<Entry<FitlerSchemas, EntryMetadata> | null> {
    const entry = await ctx.runQuery(this.component.entries.get, {
      entryId: args.entryId,
    });
    return entry as Entry<FitlerSchemas, EntryMetadata> | null;
  }

  /**
   * Find an existing entry by its content hash, which you can use to copy
   * new results into a new entry when migrating, or avoiding duplicating work
   * when updating content.
   */
  async findEntryByContentHash(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      key: string;
      /** The hash of the entry contents to try to match. */
      contentHash: string;
    }
  ): Promise<Entry<FitlerSchemas, EntryMetadata> | null> {
    const entry = await ctx.runQuery(this.component.entries.findByContentHash, {
      namespace: args.namespace,
      dimension: this.options.embeddingDimension,
      filterNames: this.options.filterNames ?? [],
      modelId: this.options.textEmbeddingModel.modelId,
      key: args.key,
      contentHash: args.contentHash,
    });
    return entry as Entry<FitlerSchemas, EntryMetadata> | null;
  }

  /**
   * Get a namespace that matches the modelId, embedding dimension, and
   * filterNames of the RAG instance. If it doesn't exist, it will be created.
   */
  async getOrCreateNamespace(
    ctx: RunMutationCtx,
    args: {
      /**
       * The namespace to get or create. e.g. a userId if entries are per-user.
       */
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

  /**
   * Get a namespace that matches the modelId, embedding dimension, and
   * filterNames of the RAG instance. If it doesn't exist, it will return null.
   */
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

  /**
   * List all chunks for an entry, paginated.
   */
  async listChunks(
    ctx: RunQueryCtx,
    args: {
      paginationOpts: PaginationOptions;
      entryId: EntryId;
      order?: "desc" | "asc";
    }
  ): Promise<PaginationResult<Chunk>> {
    return ctx.runQuery(this.component.chunks.list, {
      entryId: args.entryId,
      paginationOpts: args.paginationOpts,
      order: args.order ?? "asc",
    });
  }

  /**
   * Delete an entry and all its chunks.
   */
  async delete(ctx: RunMutationCtx, args: { entryId: EntryId }) {
    await ctx.runMutation(this.component.entries.deleteAsync, {
      entryId: args.entryId,
      startOrder: 0,
    });
  }

  /**
   * Define a function that can be provided to the `onComplete` parameter of
   * `add` or `addAsync` like:
   * ```ts
   * const onComplete = rag.defineOnComplete(async (ctx, args) => {
   *   // ...
   * });
   *
   * // in your mutation
   *   await rag.add(ctx, {
   *     namespace: "my-namespace",
   *     onComplete: internal.foo.onComplete,
   *   });
   * ```
   * It will be called when the entry is no longer "pending".
   * This is usually when it's "ready" but it can be "replaced" if a newer
   * entry is ready before this one.
   */
  defineOnComplete<DataModel extends GenericDataModel>(
    fn: (
      ctx: GenericMutationCtx<DataModel>,
      args: FunctionArgs<OnComplete<FitlerSchemas, EntryMetadata>>
    ) => Promise<void>
  ): RegisteredMutation<
    "internal",
    FunctionArgs<OnComplete<FitlerSchemas, EntryMetadata>>,
    null
  > {
    return internalMutationGeneric({
      args: vOnCompleteArgs,
      handler: fn,
    });
  }

  /**
   * Define a function that can be provided to the `chunkerAction` parameter of
   * `addAsync` like:
   * ```ts
   * const chunkerAction = rag.defineChunkerAction(async (ctx, args) => {
   *   // ...
   * });
   *
   * // in your mutation
   *   const entryId = await rag.addAsync(ctx, {
   *     key: "myfile.txt",
   *     namespace: "my-namespace",
   *     chunkerAction: internal.foo.myChunkerAction,
   *   });
   * ```
   * It will be called when the entry is added, or when the entry is replaced
   * along the way.
   */
  defineChunkerAction<DataModel extends GenericDataModel>(
    fn: (
      ctx: GenericActionCtx<DataModel>,
      args: { namespace: Namespace; entry: Entry<FitlerSchemas, EntryMetadata> }
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
        if (namespace.modelId !== this.options.textEmbeddingModel.modelId) {
          console.error(
            `You are using a different embedding model ${this.options.textEmbeddingModel.modelId} for asynchronously ` +
              `generating chunks than the one provided when it was started: ${namespace.modelId}`
          );
          return;
        }
        if (namespace.dimension !== this.options.embeddingDimension) {
          console.error(
            `You are using a different embedding dimension ${this.options.embeddingDimension} for asynchronously ` +
              `generating chunks than the one provided when it was started: ${namespace.dimension}`
          );
          return;
        }
        if (
          !filterNamesContain(
            namespace.filterNames,
            this.options.filterNames ?? []
          )
        ) {
          console.error(
            `You are using a different filters (${this.options.filterNames?.join(", ")}) for asynchronously ` +
              `generating chunks than the one provided when it was started: ${namespace.filterNames.join(", ")}`
          );
          return;
        }
        const chunksPromise = fn(ctx, {
          namespace,
          entry: entry as Entry<FitlerSchemas, EntryMetadata>,
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
              FunctionArgs<RAGComponent["chunks"]["insert"]>,
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
      "You must provide filter names to RAG to add entries with filters."
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
      values: batch.map((b) => b.text.trim() || "<empty>"),
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

type FilterNames<FiltersSchemas extends Record<string, Value>> =
  (keyof FiltersSchemas & string)[];

type NamespaceSelection =
  | {
      /**
       * A namespace is an isolated search space - no search can access entities
       * in other namespaces. Often this is used to segment user documents from
       * each other, but can be an arbitrary delineation. All filters apply
       * within a namespace.
       */
      namespace: string;
    }
  | {
      /**
       * The namespaceId, which is returned when creating a namespace
       * or looking it up.
       * There can be multiple namespaceIds for the same namespace, e.g.
       * one for each modelId, embedding dimension, and filterNames.
       * Each of them have a separate "status" and only one is ever "ready" for
       * any given "namespace" (e.g. a userId).
       */
      namespaceId: NamespaceId;
    };

type EntryArgs<
  FitlerSchemas extends Record<string, Value>,
  EntryMetadata extends Record<string, Value>,
> = {
  /**
   * This key allows replacing an existing entry by key.
   * Within a namespace, there will only be one "ready" entry per key.
   * When adding a new one, it will start as "pending" and after all
   * chunks are added, it will be promoted to "ready".
   */
  key?: string | undefined;
  /**
   * The title of the entry. Used for default prompting to contextualize
   * the entry results. Also may be used for keyword search in the future.
   */
  title?: string;
  /**
   * Metadata about the entry that is not indexed or filtered or searched.
   * Provided as a convenience to store associated information, such as
   * the storageId or url to the source material.
   */
  metadata?: EntryMetadata;
  /**
   * Filters to apply to the entry. These can be OR'd together in search.
   * To represent AND logic, your filter can be an object or array with
   * multiple values. e.g. saving the result with:
   * `{ name: "categoryAndPriority", value: ["articles", "high"] }`
   * and searching with the same value will return entries that match that
   * value exactly.
   */
  filterValues?: EntryFilter<FitlerSchemas>[];
  /**
   * The importance of the entry. This is used to scale the vector search
   * score of each chunk.
   */
  importance?: Importance;
  /**
   * The hash of the entry contents. This is used to deduplicate entries.
   * You can look up existing entries by content hash within a namespace.
   * It will also return an existing entry if you add an entry with the
   * same content hash.
   */
  contentHash?: string;
  /**
   * A function that is called when the entry is added.
   */
  onComplete?: OnComplete;
};

type SearchOptions<FitlerSchemas extends Record<string, Value>> = {
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
  filters?: EntryFilter<FitlerSchemas>[];
  /**
   * The maximum number of messages to fetch. Default is 10.
   * This is the number *before* the chunkContext is applied.
   * e.g. { before: 2, after: 1 } means 4x the limit is returned.
   */
  limit?: number;
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
};
