import type {
  Expand,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  StorageActionWriter,
  StorageReader,
} from "convex/server";
import type { GenericId, Infer } from "convex/values";
import type { Mounts } from "../component/_generated/api.js";
import { brandedString } from "convex-helpers/validators";
import type { Source } from "../component/schema.js";

// Branded types for IDs, as components don't expose the internal ID types.
export const vNamespaceId = brandedString("NamespaceId");
export const vDocumentId = brandedString("DocumentId");
export type NamespaceId = Infer<typeof vNamespaceId>;
export type DocumentId = Infer<typeof vDocumentId>;

// UseApi<typeof api> is an alternative that has jump-to-definition but is
// less stable and reliant on types within the component files, which can cause
// issues where passing `components.foo` doesn't match the argument
export type DocumentSearchComponent = UseApi<Mounts>;

export type OnCompleteNamespace = FunctionReference<
  "mutation",
  "internal",
  {
    namespace: string;
    namespaceId: NamespaceId;
    previousNamespaceId: NamespaceId | null;
    success: boolean;
  },
  null,
  string
>;

export type OnCompleteDocument = FunctionReference<
  "mutation",
  "internal",
  {
    namespace: string;
    namespaceId: NamespaceId;
    key: string;
    documentId: DocumentId;
    previousDocumentId: DocumentId | null;
    success: boolean;
  },
  null,
  string
>;

export type ChunkerAction = FunctionReference<
  "action",
  "internal",
  {
    namespace: string;
    namespaceId: NamespaceId;
    key: string;
    documentId: DocumentId;
    source: Source;
  },
  null
>;

// Type utils follow

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runQuery: GenericMutationCtx<GenericDataModel>["runQuery"];
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
export type RunActionCtx = {
  runQuery: GenericActionCtx<GenericDataModel>["runQuery"];
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
  runAction: GenericActionCtx<GenericDataModel>["runAction"];
};
export type ActionCtx = RunActionCtx & {
  storage: StorageActionWriter;
};
export type QueryCtx = RunQueryCtx & {
  storage: StorageReader;
};

export type OpaqueIds<T> =
  T extends GenericId<infer _T>
    ? string
    : T extends (infer U)[]
      ? OpaqueIds<U>[]
      : T extends ArrayBuffer
        ? ArrayBuffer
        : T extends object
          ? {
              [K in keyof T]: OpaqueIds<T[K]>;
            }
          : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    "public",
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<
        FType,
        "internal",
        OpaqueIds<FArgs>,
        OpaqueIds<FReturnType>,
        FComponentPath
      >
    : UseApi<API[mod]>;
}>;
