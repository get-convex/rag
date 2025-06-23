/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chunks from "../chunks.js";
import type * as documents from "../documents.js";
import type * as embeddings_importance from "../embeddings/importance.js";
import type * as embeddings_index from "../embeddings/index.js";
import type * as embeddings_tables from "../embeddings/tables.js";
import type * as namespaces from "../namespaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  chunks: typeof chunks;
  documents: typeof documents;
  "embeddings/importance": typeof embeddings_importance;
  "embeddings/index": typeof embeddings_index;
  "embeddings/tables": typeof embeddings_tables;
  namespaces: typeof namespaces;
}>;
export type Mounts = {
  chunks: {
    insert: FunctionReference<
      "mutation",
      "public",
      {
        chunks: Array<{
          content: { metadata?: Record<string, any>; text: string };
          embedding: Array<number>;
        }>;
        documentId: string;
        startOrder: number;
      },
      any
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        documentId: string;
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          metadata?: Record<string, any>;
          order: number;
          state: "pending" | "ready" | "deleted";
          text: string;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    replaceChunksAsync: FunctionReference<
      "mutation",
      "public",
      {
        documentId: string;
        embeddingIds: Array<
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
        >;
        startOrder: number;
      },
      any
    >;
  };
  documents: {
    deleteDocumentAsync: FunctionReference<
      "mutation",
      "public",
      { documentId: string; startOrder: number },
      any
    >;
    get: FunctionReference<
      "query",
      "public",
      { documentId: string },
      {
        contentHash?: string;
        documentId: string;
        filterValues: Array<{ name: string; value: any }>;
        importance: number;
        key: string;
        source:
          | { kind: "_storage"; storageId: string }
          | { kind: "url"; url: string };
        status: "pending" | "ready";
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        key?: string;
        namespaceId: string;
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          contentHash?: string;
          documentId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key: string;
          source:
            | { kind: "_storage"; storageId: string }
            | { kind: "url"; url: string };
          status: "pending" | "ready";
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    updateStatus: FunctionReference<
      "mutation",
      "public",
      { documentId: string; status: "pending" | "ready" },
      any
    >;
    upsert: FunctionReference<
      "mutation",
      "public",
      {
        allChunks?: Array<{
          content: { metadata?: Record<string, any>; text: string };
          embedding: Array<number>;
        }>;
        document: {
          contentHash?: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key: string;
          namespaceId: string;
          source:
            | { kind: "_storage"; storageId: string }
            | { kind: "url"; url: string };
        };
        onComplete?: string;
        splitAndEmbed?: string;
      },
      {
        documentId: string;
        lastChunk: null | {
          metadata?: Record<string, any>;
          order: number;
          state: "pending" | "ready" | "deleted";
          text: string;
        };
      }
    >;
    upsertAsync: FunctionReference<
      "mutation",
      "public",
      {
        chunker: string;
        document: {
          contentHash?: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key: string;
          namespaceId: string;
          source:
            | { kind: "_storage"; storageId: string }
            | { kind: "url"; url: string };
        };
        onComplete?: string;
      },
      { documentId: string; status: "pending" | "ready" }
    >;
  };
  namespaces: {
    get: FunctionReference<
      "query",
      "public",
      { namespaceId: string },
      { namespace: string; status: "pending" | "ready" }
    >;
    getOrCreate: FunctionReference<
      "mutation",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
        status: { kind: "pending"; onComplete?: string } | { kind: "ready" };
      },
      { namespaceId: string; status: "pending" | "ready" }
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          createdAt: number;
          dimension: number;
          filterNames: Array<string>;
          modelId: string;
          namespace: string;
          namespaceId: string;
          status: "pending" | "ready";
          version: number;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
