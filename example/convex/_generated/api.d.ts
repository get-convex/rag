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
            importance: number;
          }>;
          documentId: string;
          startOrder: number;
        },
        any
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
            state: "pending" | "ready" | "deleted";
            text: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      replaceChunksAsync: FunctionReference<
        "mutation",
        "internal",
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
          status: "pending" | "ready";
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
            status: "pending" | "ready";
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      upsert: FunctionReference<
        "mutation",
        "internal",
        {
          allChunks?: Array<{
            content: { metadata?: Record<string, any>; text: string };
            embedding: Array<number>;
            importance: number;
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
        { chunkIds: Array<string> | null; documentId: string }
      >;
    };
    namespaces: {
      get: FunctionReference<
        "query",
        "internal",
        { namespaceId: string },
        { namespace: string; status: "pending" | "ready" }
      >;
      getOrCreate: FunctionReference<
        "mutation",
        "internal",
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
          page: Array<{ namespace: string; status: "pending" | "ready" }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
  };
};
