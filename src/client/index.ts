import {
  v,
  type GenericId,
  type Validator,
  type Value,
  type VString,
} from "convex/values";
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
import { embed } from "ai";
import { vSource, type Source } from "../component/schema.js";
import {
  BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT,
  estimateCreateChunkSize,
  type Chunk,
  type Status,
} from "../shared.js";
import {
  createFunctionHandle,
  internalActionGeneric,
  type FunctionArgs,
  type FunctionHandle,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import type { CreateChunkArgs } from "../shared.js";

export { vNamespaceId, vDocumentId } from "./types.js";

export type {
  DocumentSearchComponent,
  Source,
  Status,
  NamespaceId,
  DocumentId,
  OnCompleteNamespace,
};

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

type SearchOptions = {
  /**
   * The maximum number of messages to fetch. Default is 10.
   */
  limit: number;
  /**
   * What chunks around the search results to include.
   * Default: { before: 0, after: 0 }
   * Note, this is after the limit is applied.
   * e.g. { before: 2, after: 1 } means 2 chunks before and 1 chunk after.
   * This would result in up to (4 * limit) items returned.
   */
  chunkRange?: { before: number; after: number };
};

type NamedFilter<FilterNames extends string = string, ValueType = Value> = {
  name: FilterNames;
  value: ValueType;
};

// Add this type guard function after the imports
function hasDoEmbed(
  model: EmbeddingModelV1<string> | { modelId: string }
): model is EmbeddingModelV1<string> {
  return "doEmbed" in model;
}

export class DocumentSearch<
  FitlerSchemas extends Record<
    FilterNames,
    Validator<Value, "required", string>
  > = Record<string, never>,
  FilterNames extends string = string,
> {
  constructor(
    public component: DocumentSearchComponent,
    public options: {
      embeddingDimension: number;
      textEmbeddingModel: EmbeddingModelV1<string> | { modelId: string };
      filterNames?: FilterNames[];
      // Common parameters:
      // logLevel
    }
  ) {}

  async upsertDocument(
    ctx: RunActionCtx,
    args: {
      key: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: NamedFilter<FilterNames>[];
      importance?: number;
      contentHash?: string;
      chunks: InputChunk[];
      splitAndEmbedAction?: undefined;
    } & ({ namespace: string } | { namespaceId: NamespaceId }) &
      (
        | { source: { storageId: GenericId<"_storage"> } }
        | { source: { url: string } }
      )
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
    let source: Source;
    if ("storageId" in args.source) {
      source = { kind: "_storage", storageId: args.source.storageId };
    } else {
      source = { kind: "url", url: args.source.url };
    }
    // break chunks up into batches, respecting soft limit
    const batches: CreateChunkArgs[][] = []; //chunk(args.chunks, this.component.chunks.insert.softLimit);
    let batchBytes = 0;
    let batch: CreateChunkArgs[] = [];
    for (const chunk of args.chunks ?? []) {
      const createChunkArgs = await this._chunkToCreateChunkArgs(chunk);
      batch.push(createChunkArgs);
      const size = estimateCreateChunkSize(createChunkArgs);
      batchBytes += size;
      if (batchBytes > BANDWIDTH_PER_TRANSACTION_SOFT_LIMIT) {
        batches.push(batch);
        batch = [];
        batchBytes = 0;
      }
    }
    if (batch.length > 0) {
      batches.push(batch);
    }

    const { documentId, status } = await ctx.runMutation(
      this.component.documents.upsert,
      {
        document: {
          key: args.key,
          namespaceId,
          source,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
        },
        allChunks: batches.length === 1 ? batches[0] : undefined,
      }
    );
    if (status !== "ready" && batches.length > 1) {
      let startOrder = 0;
      for (const batch of batches) {
        await ctx.runMutation(this.component.chunks.insert, {
          documentId,
          startOrder,
          chunks: batch,
        });
        startOrder += batch.length;
      }
      await ctx.runMutation(this.component.documents.updateStatus, {
        documentId,
        status: "ready",
      });
    }
    return { documentId: documentId as DocumentId, status: "ready" as const };
  }

  async upsertDocumentAsync(
    ctx: RunActionCtx,
    args: {
      key: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: NamedFilter<FilterNames>[];
      importance?: number;
      contentHash?: string;
      onComplete?: OnCompleteDocument;
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
    } & ({ namespace: string } | { namespaceId: NamespaceId }) &
      (
        | { source: { storageId: GenericId<"_storage"> } }
        | { source: { url: string } }
      )
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
    let source: Source;
    if ("storageId" in args.source) {
      source = { kind: "_storage", storageId: args.source.storageId };
    } else {
      source = { kind: "url", url: args.source.url };
    }
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
          source,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
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
      query: string;
      namespace: string;
      namespaceVersion?: number;
      filters?: NamedFilter<FilterNames>[];
      searchOptions?: SearchOptions;
    }
  ) {
    const { query, namespace, namespaceVersion, filters } = args;
    // const namespaceId = await this.component.lib.search(ctx, {
    //   vectors: [],
    //   namespace,
    //   vector: [],
    //   filters: [],
    // });
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
    status: "pending" | "ready";
  }> {
    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
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

  async _chunkToCreateChunkArgs(chunk: InputChunk): Promise<CreateChunkArgs> {
    const text =
      typeof chunk === "string"
        ? chunk
        : "text" in chunk
          ? chunk.text
          : chunk.pageContent;
    let embedding: number[];
    if (typeof chunk !== "string" && chunk.embedding) {
      embedding = chunk.embedding;
    } else if (hasDoEmbed(this.options.textEmbeddingModel)) {
      ({ embedding } = await embed({
        model: this.options.textEmbeddingModel,
        value: text,
      }));
    } else {
      throw new Error(
        "No embedding provided and textEmbeddingModel doesn't support embedding"
      );
    }
    const metadata =
      typeof chunk === "string"
        ? {}
        : "metadata" in chunk
          ? chunk.metadata
          : {};
    return { embedding, content: { text, metadata } };
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
        chunkBatchSize: v.number(),
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
        let batch: CreateChunkArgs[] = [];
        let batchOrder = 0;
        for await (const chunk of chunkIterator) {
          batch.push(await this._chunkToCreateChunkArgs(chunk));
          if (batch.length >= args.chunkBatchSize) {
            await ctx.runMutation(args.insertChunksHandle, {
              documentId,
              startOrder: batchOrder,
              chunks: batch,
            });
            batch = [];
            batchOrder += args.chunkBatchSize;
          }
        }
      },
    });
  }
}
