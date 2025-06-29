import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";
import { assert } from "convex-helpers";
import {
  createFunctionHandle,
  internalActionGeneric,
  type FunctionArgs,
  type FunctionHandle,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import { v, type Value, type VString } from "convex/values";
import {
  CHUNK_BATCH_SIZE,
  vDocumentId,
  vNamespaceId,
  type Chunk,
  type CreateChunkArgs,
  type Document,
  type DocumentFilterValues,
  type DocumentId,
  type Namespace,
  type NamespaceId,
  type SearchResult,
  type Status,
} from "../shared.js";
import {
  type ActionCtx,
  type ChunkerAction,
  type DocumentSearchComponent,
  type OnCompleteDocument,
  type OnCompleteNamespace,
  type RunActionCtx,
  type RunMutationCtx,
  type RunQueryCtx,
} from "./types.js";
import type { NamedFilter } from "../component/filters.js";

export {
  vDocument,
  vSearchResult,
  contentHashFromBlob,
  type VDocument,
} from "../shared.js";
export { vDocumentId, vNamespaceId };

export type {
  ChunkerAction,
  Document,
  DocumentId,
  DocumentSearchComponent,
  NamespaceId,
  OnCompleteDocument,
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
      // filters?: DocumentFilterValues<FitlerSchemas>[];
    });

export class DocumentSearch<
  FitlerSchemas extends Record<FilterNames, Value> = Record<string, Value>,
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
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: DocumentFilterValues<FitlerSchemas>[];
      importance?: Importance;
      contentHash?: string;
    }
  ): Promise<{
    documentId: DocumentId;
    status: Status;
    created: boolean;
    replacedVersion: Document | null;
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

    validateUpsertFilterValues(args.filterValues, this.options.filterNames);

    let allChunks: CreateChunkArgs[] | undefined;
    if (Array.isArray(args.chunks) && args.chunks.length < CHUNK_BATCH_SIZE) {
      console.debug("All chunks at once", args.chunks.length);
      allChunks = await createChunkArgsBatch(
        this.options.textEmbeddingModel,
        args.chunks
      );
    }

    const { documentId, status, created, replacedVersion } =
      await ctx.runMutation(this.component.documents.upsert, {
        document: {
          key: args.key,
          namespaceId,
          title: args.title,
          filterValues: args.filterValues ?? [],
          importance: args.importance ?? 1,
          contentHash: args.contentHash,
        },
        allChunks,
      });
    if (status === "ready") {
      return {
        documentId: documentId as DocumentId,
        status,
        created,
        replacedVersion: replacedVersion as Document | null,
      };
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
            created: false,
            replacedVersion: null,
          };
        }
        startOrder = nextStartOrder;
      }
    }
    const promoted = await ctx.runMutation(
      this.component.documents.promoteToReady,
      { documentId }
    );
    return {
      documentId: documentId as DocumentId,
      status: "ready" as const,
      replacedVersion: promoted.replacedVersion as Document | null,
      created: true,
    };
  }

  async upsertDocumentAsync(
    ctx: ActionCtx,
    args: ({ namespace: string } | { namespaceId: NamespaceId }) & {
      key: string;
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
       *     chunker: internal.foo.myChunkerAction,
       *   });
       */
      chunkerAction: ChunkerAction;
      title?: string;
      // mimeType: string;
      // metadata?: Record<string, Value>;
      filterValues?: DocumentFilterValues<FitlerSchemas>[];
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
      filters?: DocumentFilterValues<FitlerSchemas>[];
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
    documents: Document<FitlerSchemas>[];
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
      documents: documents as Document<FitlerSchemas>[],
    };
  }

  async listDocuments(
    ctx: RunQueryCtx,
    args: {
      namespaceId: NamespaceId;
      paginationOpts: PaginationOptions;
      order?: "desc" | "asc";
      status?: Status;
    }
  ): Promise<PaginationResult<Document<FitlerSchemas>>> {
    const results = await ctx.runQuery(this.component.documents.list, {
      namespaceId: args.namespaceId,
      paginationOpts: args.paginationOpts,
      order: args.order ?? "asc",
      status: args.status ?? "ready",
    });
    return results as PaginationResult<Document<FitlerSchemas>>;
  }

  async getDocument(
    ctx: RunQueryCtx,
    args: {
      documentId: DocumentId;
    }
  ): Promise<Document<FitlerSchemas> | null> {
    const document = await ctx.runQuery(this.component.documents.get, {
      documentId: args.documentId,
    });
    return document as Document<FitlerSchemas> | null;
  }

  async findExistingDocumentByContentHash(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      key: string;
      /** The hash of the document contents to try to match. */
      contentHash: string;
    }
  ): Promise<Document<FitlerSchemas> | null> {
    const document = await ctx.runQuery(
      this.component.documents.findByContentHash,
      {
        namespace: args.namespace,
        dimension: this.options.embeddingDimension,
        filterNames: this.options.filterNames ?? [],
        modelId: this.options.textEmbeddingModel.modelId,
        key: args.key,
        contentHash: args.contentHash,
      }
    );
    return document as Document<FitlerSchemas> | null;
  }

  async getOrCreateNamespace(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      status?: Status;
      /**
       * This will be called when then namespace leaves the "pending" state.
       * Either if the namespace is created or if the namespace is replaced
       * along the way.
       */
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
      }
    ) => AsyncIterable<InputChunk> | Promise<{ chunks: InputChunk[] }>
  ) {
    return internalActionGeneric({
      args: v.object({
        namespace: v.string(),
        namespaceId: vNamespaceId,
        key: v.string(),
        documentId: vDocumentId,
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
        const { namespace, namespaceId, key, documentId } = args;
        const chunksPromise = fn(ctx, {
          namespace,
          namespaceId,
          key,
          documentId,
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

function validateUpsertFilterValues(
  filterValues: NamedFilter[] | undefined,
  filterNames: string[] | undefined
) {
  if (!filterValues) {
    return;
  }
  if (!filterNames) {
    throw new Error(
      "You must provide filter names to DocumentSearch to upsert documents with filters."
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

export function splitFilename(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  if (title.search(/\.[a-zA-Z0-9]+$/) === -1) {
    return title;
  }
  const parts = title.split(".");
  // split up camelCase into "camel Case"
  return parts
    .map((part) => {
      const words = part.split(" ");
      const camelCaseWords = words.map((word) => {
        const pieces = word.split(/(?=[A-Z])/);
        if (pieces.length === 1) {
          return word;
        }
        // include the full word and the split pieces
        return [word, ...pieces].join(" ");
      });
      return camelCaseWords.join(" ");
    })
    .join(" ");
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

export function guessMimeTypeFromExtension(
  filename: string
): string | undefined {
  const extension = filename.split(".").pop();
  if (!extension || extension.includes(" ")) {
    return undefined;
  }
  switch (extension.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "txt":
    case "rtf":
      return "text/plain";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "cjs":
    case "mjs":
    case "jsx":
    case "ts":
    case "tsx":
      return "text/javascript";
    case "md":
    case "mdx":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "zip":
      return "application/zip";
    case "apng":
      return "image/apng";
    case "png":
      return "image/png";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "tiff":
      return "image/tiff";
    case "ico":
      return "image/x-icon";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "mp1":
    case "mp2":
    case "mp3":
      return "audio/mpeg";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * Return a best-guess MIME type based on the magic-number signature
 * found at the start of an ArrayBuffer.
 *
 * @param buf – the source ArrayBuffer
 * @returns the detected MIME type, or `"application/octet-stream"` if unknown
 */
export function guessMimeTypeFromContents(buf: ArrayBuffer | string): string {
  if (typeof buf === "string") {
    if (buf.match(/^data:\w+\/\w+;base64/)) {
      return buf.split(";")[0].split(":")[1]!;
    }
    return "text/plain";
  }
  if (buf.byteLength < 4) return "application/octet-stream";

  // Read the first 12 bytes (enough for all signatures below)
  const bytes = new Uint8Array(buf.slice(0, 12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Helper so we can look at only the needed prefix
  const startsWith = (sig: string) => hex.startsWith(sig.toLowerCase());

  // --- image formats ---
  if (startsWith("89504e47")) return "image/png"; // PNG  - 89 50 4E 47
  if (
    startsWith("ffd8ffdb") ||
    startsWith("ffd8ffe0") ||
    startsWith("ffd8ffee") ||
    startsWith("ffd8ffe1")
  )
    return "image/jpeg"; // JPEG
  if (startsWith("47494638")) return "image/gif"; // GIF
  if (startsWith("424d")) return "image/bmp"; // BMP
  if (startsWith("52494646") && hex.substr(16, 8) === "57454250")
    return "image/webp"; // WEBP (RIFF....WEBP)
  if (startsWith("49492a00")) return "image/tiff"; // TIFF
  // <svg in hex is 3c 3f 78 6d 6c
  if (startsWith("3c737667")) return "image/svg+xml"; // <svg
  if (startsWith("3c3f786d")) return "image/svg+xml"; // <?xm

  // --- audio/video ---
  if (startsWith("494433")) return "audio/mpeg"; // MP3 (ID3)
  if (startsWith("000001ba") || startsWith("000001b3")) return "video/mpeg"; // MPEG container
  if (startsWith("1a45dfa3")) return "video/webm"; // WEBM / Matroska
  if (startsWith("00000018") && hex.substr(16, 8) === "66747970")
    return "video/mp4"; // MP4
  if (startsWith("4f676753")) return "audio/ogg"; // OGG / Opus

  // --- documents & archives ---
  if (startsWith("25504446")) return "application/pdf"; // PDF
  if (
    startsWith("504b0304") ||
    startsWith("504b0506") ||
    startsWith("504b0708")
  )
    return "application/zip"; // ZIP / DOCX / PPTX / XLSX / EPUB
  if (startsWith("52617221")) return "application/x-rar-compressed"; // RAR
  if (startsWith("7f454c46")) return "application/x-elf"; // ELF binaries
  if (startsWith("1f8b08")) return "application/gzip"; // GZIP
  if (startsWith("425a68")) return "application/x-bzip2"; // BZIP2
  if (startsWith("3c3f786d6c")) return "application/xml"; // XML

  // Plain text, JSON and others are trickier—fallback:
  return "application/octet-stream";
}
