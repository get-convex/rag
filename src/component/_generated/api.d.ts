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
import type * as embeddings_importance from "../embeddings/importance.js";
import type * as embeddings_index from "../embeddings/index.js";
import type * as embeddings_tables from "../embeddings/tables.js";
import type * as entries from "../entries.js";
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
  "embeddings/importance": typeof embeddings_importance;
  "embeddings/index": typeof embeddings_index;
  "embeddings/tables": typeof embeddings_tables;
  entries: typeof entries;
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
          searchableText?: string;
        }>;
        entryId: string;
        startOrder: number;
      },
      { status: "pending" | "ready" | "replaced" }
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        entryId: string;
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
      { entryId: string; startOrder: number },
      { nextStartOrder: number; status: "pending" | "ready" | "replaced" }
    >;
  };
  entries: {
    add: FunctionReference<
      "mutation",
      "public",
      {
        allChunks?: Array<{
          content: { metadata?: Record<string, any>; text: string };
          embedding: Array<number>;
          searchableText?: string;
        }>;
        entry: {
          contentHash?: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          namespaceId: string;
          title?: string;
        };
        onComplete?: string;
      },
      {
        created: boolean;
        entryId: string;
        replacedVersion: {
          contentHash?: string;
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          status: "pending" | "ready" | "replaced";
          title?: string;
        } | null;
        status: "pending" | "ready" | "replaced";
      }
    >;
    addAsync: FunctionReference<
      "mutation",
      "public",
      {
        chunker: string;
        entry: {
          contentHash?: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          namespaceId: string;
          title?: string;
        };
        onComplete?: string;
      },
      {
        created: boolean;
        entryId: string;
        status: "pending" | "ready" | "replaced";
      }
    >;
    deleteAsync: FunctionReference<
      "mutation",
      "public",
      { entryId: string; startOrder: number },
      null
    >;
    findByContentHash: FunctionReference<
      "query",
      "public",
      {
        contentHash: string;
        dimension: number;
        filterNames: Array<string>;
        key: string;
        modelId: string;
        namespace: string;
      },
      {
        contentHash?: string;
        entryId: string;
        filterValues: Array<{ name: string; value: any }>;
        importance: number;
        key?: string;
        status: "pending" | "ready" | "replaced";
        title?: string;
      } | null
    >;
    get: FunctionReference<
      "query",
      "public",
      { entryId: string },
      {
        contentHash?: string;
        entryId: string;
        filterValues: Array<{ name: string; value: any }>;
        importance: number;
        key?: string;
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
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
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
      { entryId: string },
      {
        replacedVersion: {
          contentHash?: string;
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          status: "pending" | "ready" | "replaced";
          title?: string;
        } | null;
      }
    >;
  };
  namespaces: {
    get: FunctionReference<
      "query",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
      },
      null | {
        createdAt: number;
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
        namespaceId: string;
        status: "pending" | "ready" | "replaced";
        version: number;
      }
    >;
    getOrCreate: FunctionReference<
      "mutation",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
        onComplete?: string;
        status: "pending" | "ready" | "replaced";
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
    promoteToReady: FunctionReference<
      "mutation",
      "public",
      { namespaceId: string },
      {
        replacedVersion: null | {
          createdAt: number;
          dimension: number;
          filterNames: Array<string>;
          modelId: string;
          namespace: string;
          namespaceId: string;
          status: "pending" | "ready" | "replaced";
          version: number;
        };
      }
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
        entries: Array<{
          contentHash?: string;
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          status: "pending" | "ready" | "replaced";
          title?: string;
        }>;
        results: Array<{
          content: Array<{ metadata?: Record<string, any>; text: string }>;
          entryId: string;
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

export declare const components: {
  workpool: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
        },
        any
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        {
          before?: number;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
        },
        any
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism: number;
          };
          fnArgs: any;
          fnHandle: string;
          fnName: string;
          fnType: "action" | "mutation" | "query";
          onComplete?: { context?: any; fnHandle: string };
          retryBehavior?: {
            base: number;
            initialBackoffMs: number;
            maxAttempts: number;
          };
          runAt: number;
        },
        string
      >;
      status: FunctionReference<
        "query",
        "internal",
        { id: string },
        | { previousAttempts: number; state: "pending" }
        | { previousAttempts: number; state: "running" }
        | { state: "finished" }
      >;
    };
  };
};
