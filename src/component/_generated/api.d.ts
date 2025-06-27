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
import type * as filters from "../filters.js";
import type * as namespaces from "../namespaces.js";
import type * as search from "../search.js";

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
  filters: typeof filters;
  namespaces: typeof namespaces;
  search: typeof search;
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
      { status: "pending" | "ready" | "replaced" }
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
          state: "pending" | "ready" | "replaced";
          text: string;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    replaceChunksPage: FunctionReference<
      "mutation",
      "public",
      { documentId: string; startOrder: number },
      { nextStartOrder: number; status: "pending" | "ready" | "replaced" }
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
        status: "pending" | "ready" | "replaced";
        title?: string;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        namespaceId: string;
        order?: "desc" | "asc";
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        status: "pending" | "ready" | "replaced";
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
          status: "pending" | "ready" | "replaced";
          title?: string;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    promoteToReady: FunctionReference<
      "mutation",
      "public",
      { documentId: string },
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
          title?: string;
        };
        onComplete?: string;
      },
      { documentId: string; status: "pending" | "ready" | "replaced" }
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
          title?: string;
        };
        onComplete?: string;
      },
      { documentId: string; status: "pending" | "ready" | "replaced" }
    >;
  };
  namespaces: {
    get: FunctionReference<
      "query",
      "public",
      { namespaceId: string },
      { namespace: string; status: "pending" | "ready" | "replaced" }
    >;
    getOrCreate: FunctionReference<
      "mutation",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
        status:
          | { kind: "pending"; onComplete?: string }
          | { kind: "ready" }
          | { kind: "replaced"; replacedAt: number };
      },
      { namespaceId: string; status: "pending" | "ready" | "replaced" }
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
        status: "pending" | "ready" | "replaced";
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
          status: "pending" | "ready" | "replaced";
          version: number;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    lookup: FunctionReference<
      "query",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
      },
      null | string
    >;
  };
  search: {
    search: FunctionReference<
      "action",
      "public",
      {
        chunkContext?: { after: number; before: number };
        embedding: Array<number>;
        filters: Array<{ name: string; value: any }>;
        limit: number;
        modelId: string;
        namespace: string;
        vectorScoreThreshold?: number;
      },
      {
        documents: Array<{
          contentHash?: string;
          documentId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key: string;
          source:
            | { kind: "_storage"; storageId: string }
            | { kind: "url"; url: string };
          status: "pending" | "ready" | "replaced";
          title?: string;
        }>;
        results: Array<{
          content: Array<{ metadata?: Record<string, any>; text: string }>;
          documentId: string;
          order: number;
          score: number;
          startOrder: number;
        }>;
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
