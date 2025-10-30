import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  StorageActionWriter,
  StorageReader,
} from "convex/server";

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
