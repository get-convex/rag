/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as embeddings_index from "../embeddings/index.js";
import type * as embeddings_tables from "../embeddings/tables.js";
import type * as lib from "../lib.js";

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
  "embeddings/index": typeof embeddings_index;
  "embeddings/tables": typeof embeddings_tables;
  lib: typeof lib;
}>;
export type Mounts = {
  embeddings: {
    index: {
      insertBatch: FunctionReference<
        "mutation",
        "public",
        {
          vectorDimension:
            | 128
            | 256
            | 512
            | 768
            | 1024
            | 1408
            | 1536
            | 2048
            | 3072
            | 4096;
          vectors: Array<{
            filters: Array<any>;
            namespace: string;
            vector: Array<number>;
          }>;
        },
        Array<
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
        >
      >;
    };
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
