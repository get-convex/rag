/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as example from "../example.js";

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
  example: typeof example;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  documentSearch: {
    chunks: {
      insert: FunctionReference<
        "mutation",
        "internal",
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
        "internal",
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
        "internal",
        { documentId: string; startOrder: number },
        { isDone: boolean; nextStartOrder: number }
      >;
    };
    documents: {
      deleteDocumentAsync: FunctionReference<
        "mutation",
        "internal",
        { documentId: string; startOrder: number },
        any
      >;
      get: FunctionReference<
        "query",
        "internal",
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
        } | null
      >;
      list: FunctionReference<
        "query",
        "internal",
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
            status: "pending" | "ready" | "replaced";
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      promoteToReady: FunctionReference<
        "mutation",
        "internal",
        { documentId: string },
        any
      >;
      upsert: FunctionReference<
        "mutation",
        "internal",
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
        },
        { documentId: string; status: "pending" | "ready" | "replaced" }
      >;
      upsertAsync: FunctionReference<
        "mutation",
        "internal",
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
        { documentId: string; status: "pending" | "ready" | "replaced" }
      >;
    };
    namespaces: {
      get: FunctionReference<
        "query",
        "internal",
        { namespaceId: string },
        { namespace: string; status: "pending" | "ready" | "replaced" }
      >;
      getOrCreate: FunctionReference<
        "mutation",
        "internal",
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
        "internal",
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
            status: "pending" | "ready" | "replaced";
            version: number;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
    search: {
      search: FunctionReference<
        "action",
        "internal",
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
};
