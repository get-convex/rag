/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";
import type { GenericId as Id } from "convex/values";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
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
        entryId: Id<"entries">;
        startOrder: number;
      },
      { status: "pending" | "ready" | "replaced" }
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        entryId: Id<"entries">;
        order: "desc" | "asc";
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
      { entryId: Id<"entries">; startOrder: number },
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
          metadata?: Record<string, any>;
          namespaceId: Id<"namespaces">;
          title?: string;
        };
        onComplete?: string;
      },
      {
        created: boolean;
        entryId: Id<"entries">;
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
          metadata?: Record<string, any>;
          namespaceId: Id<"namespaces">;
          title?: string;
        };
        onComplete?: string;
      },
      { created: boolean; entryId: Id<"entries">; status: "pending" | "ready" }
    >;
    deleteAsync: FunctionReference<
      "mutation",
      "public",
      { entryId: Id<"entries">; startOrder: number },
      null
    >;
    deleteByKeyAsync: FunctionReference<
      "mutation",
      "public",
      { beforeVersion?: number; key: string; namespaceId: Id<"namespaces"> },
      null
    >;
    deleteByKeySync: FunctionReference<
      "action",
      "public",
      { key: string; namespaceId: Id<"namespaces"> },
      null
    >;
    deleteSync: FunctionReference<
      "action",
      "public",
      { entryId: Id<"entries"> },
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
        metadata?: Record<string, any>;
        replacedAt?: number;
        status: "pending" | "ready" | "replaced";
        title?: string;
      } | null
    >;
    get: FunctionReference<
      "query",
      "public",
      { entryId: Id<"entries"> },
      {
        contentHash?: string;
        entryId: string;
        filterValues: Array<{ name: string; value: any }>;
        importance: number;
        key?: string;
        metadata?: Record<string, any>;
        replacedAt?: number;
        status: "pending" | "ready" | "replaced";
        title?: string;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        namespaceId?: Id<"namespaces">;
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
          metadata?: Record<string, any>;
          replacedAt?: number;
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
      { entryId: Id<"entries"> },
      {
        replacedEntry: {
          contentHash?: string;
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          metadata?: Record<string, any>;
          replacedAt?: number;
          status: "pending" | "ready" | "replaced";
          title?: string;
        } | null;
      }
    >;
  };
  namespaces: {
    deleteNamespace: FunctionReference<
      "mutation",
      "public",
      { namespaceId: Id<"namespaces"> },
      {
        deletedNamespace: null | {
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
    deleteNamespaceSync: FunctionReference<
      "action",
      "public",
      { namespaceId: Id<"namespaces"> },
      null
    >;
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
        status: "pending" | "ready";
      },
      { namespaceId: Id<"namespaces">; status: "pending" | "ready" }
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
    listNamespaceVersions: FunctionReference<
      "query",
      "public",
      {
        namespace: string;
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
    lookup: FunctionReference<
      "query",
      "public",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
      },
      null | Id<"namespaces">
    >;
    promoteToReady: FunctionReference<
      "mutation",
      "public",
      { namespaceId: Id<"namespaces"> },
      {
        replacedNamespace: null | {
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
          metadata?: Record<string, any>;
          replacedAt?: number;
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

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  chunks: {
    deleteChunksPage: FunctionReference<
      "mutation",
      "internal",
      { entryId: Id<"entries">; startOrder: number },
      { isDone: boolean; nextStartOrder: number }
    >;
    getRangesOfChunks: FunctionReference<
      "query",
      "internal",
      {
        chunkContext: { after: number; before: number };
        embeddingIds: Array<
          | Id<"vectors_128">
          | Id<"vectors_256">
          | Id<"vectors_512">
          | Id<"vectors_768">
          | Id<"vectors_1024">
          | Id<"vectors_1408">
          | Id<"vectors_1536">
          | Id<"vectors_2048">
          | Id<"vectors_3072">
          | Id<"vectors_4096">
        >;
      },
      {
        entries: Array<{
          contentHash?: string;
          entryId: string;
          filterValues: Array<{ name: string; value: any }>;
          importance: number;
          key?: string;
          metadata?: Record<string, any>;
          replacedAt?: number;
          status: "pending" | "ready" | "replaced";
          title?: string;
        }>;
        ranges: Array<null | {
          content: Array<{ metadata?: Record<string, any>; text: string }>;
          entryId: Id<"entries">;
          order: number;
          startOrder: number;
        }>;
      }
    >;
  };
  entries: {
    _del: FunctionReference<
      "mutation",
      "internal",
      { entryId: Id<"entries"> },
      null
    >;
    addAsyncOnComplete: FunctionReference<
      "mutation",
      "internal",
      {
        context: Id<"entries">;
        result:
          | { kind: "success"; returnValue: any }
          | { error: string; kind: "failed" }
          | { kind: "canceled" };
        workId: string;
      },
      null
    >;
    getEntriesForNamespaceByKey: FunctionReference<
      "query",
      "internal",
      { beforeVersion?: number; key: string; namespaceId: Id<"namespaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"entries">;
        contentHash?: string;
        filterValues: Array<{ name: string; value: any }>;
        importance: number;
        key?: string;
        metadata?: Record<string, any>;
        namespaceId: Id<"namespaces">;
        status:
          | { kind: "pending"; onComplete?: string }
          | { kind: "ready" }
          | { kind: "replaced"; replacedAt: number };
        title?: string;
        version: number;
      }>
    >;
  };
  namespaces: {
    getCompatibleNamespace: FunctionReference<
      "query",
      "internal",
      {
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
      },
      null | {
        _creationTime: number;
        _id: Id<"namespaces">;
        dimension: number;
        filterNames: Array<string>;
        modelId: string;
        namespace: string;
        status:
          | { kind: "pending"; onComplete?: string }
          | { kind: "ready" }
          | { kind: "replaced"; replacedAt: number };
        version: number;
      }
    >;
  };
};

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
          limit?: number;
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
      enqueueBatch: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism: number;
          };
          items: Array<{
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
          }>;
        },
        Array<string>
      >;
      status: FunctionReference<
        "query",
        "internal",
        { id: string },
        | { previousAttempts: number; state: "pending" }
        | { previousAttempts: number; state: "running" }
        | { state: "finished" }
      >;
      statusBatch: FunctionReference<
        "query",
        "internal",
        { ids: Array<string> },
        Array<
          | { previousAttempts: number; state: "pending" }
          | { previousAttempts: number; state: "running" }
          | { state: "finished" }
        >
      >;
    };
  };
};
