import {
  v,
  type Infer,
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
import type { NumberedFilter } from "../component/embeddings/tables.js";
import { vSource, type Source } from "../component/schema.js";
import type { Chunk, Status } from "../shared.js";
import { brandedString } from "convex-helpers/validators";
import type { Id } from "../component/_generated/dataModel.js";
import {
  createFunctionHandle,
  type FunctionArgs,
  type FunctionHandle,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import { internalAction } from "../component/_generated/server.js";
import type { CreateChunkArgs } from "../component/chunks.js";
import { assert } from "convex-helpers";

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

export type InputChunk = (MastraChunk | LangChainChunk) & {
  // In the future we can add per-chunk metadata if it's useful.
  // importance?: Importance;
  // filters?: NamedFilter<FitlerNames>[];
};

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
      onComplete?: OnCompleteDocument;
    } & (
      | {
          allChunks?: InputChunk[];
          splitAndEmbedAction?: undefined;
        }
      | {
          allChunks?: undefined;
          splitAndEmbedAction: ChunkerAction;
        }
    ) &
      ({ namespace: string } | { namespaceId: NamespaceId }) &
      ({ storageId: Id<"_storage"> } | { url: string })
  ) {
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
    if ("storageId" in args) {
      source = { kind: "_storage", storageId: args.storageId };
    } else {
      source = { kind: "url", url: args.url };
    }
    const onComplete = args.onComplete
      ? await createFunctionHandle(args.onComplete)
      : undefined;
    const splitAndEmbed = args.splitAndEmbedAction
      ? await createFunctionHandle(args.splitAndEmbedAction)
      : undefined;

    return await ctx.runMutation(this.component.documents.upsert, {
      document: {
        key: args.key,
        namespaceId,
        source,
        filterValues: args.filterValues ?? [],
        importance: args.importance ?? 1,
        contentHash: args.contentHash,
      },
      onComplete,
      splitAndEmbed,
      allChunks: args.allChunks
        ? await Promise.all(args.allChunks.map(this._chunkToCreateChunkArgs))
        : undefined,
    });
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
    ctx: RunActionCtx,
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
    const text = "text" in chunk ? chunk.text : chunk.pageContent;
    let embedding: number[];
    if (chunk.embedding) {
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
    return { embedding, content: { text, metadata: chunk.metadata } };
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
    return internalAction({
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
