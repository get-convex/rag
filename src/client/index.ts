import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { Mounts } from "../component/_generated/api";
import type { UseApi, RunMutationCtx, RunQueryCtx } from "./types";

// UseApi<typeof api> is an alternative that has jump-to-definition but is
// less stable and reliant on types within the component files, which can cause
// issues where passing `components.foo` doesn't match the argument
export type DocumentSearchComponent = UseApi<Mounts>;

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
  metadata: { loc: { lines: { from: number; to: number } } };
  embedding?: Array<number>;
};

type ChunkMetadata = {
  id?: string;
  namespaces?: Array<Value>;
  // importance?: Importance;
  // keywords?: Array<string>;
  // summary?: string;
};

export class DocumentSearch {
  constructor(
    public component: DocumentSearchComponent,
    public options?: {
      shards?: Shards;
      defaultShards?: number;
      // Common parameters:
      // logLevel
    }
  ) {}
  async add<Name extends string = keyof Shards & string>(
    ctx: RunMutationCtx,
    name: Name,
    count: number = 1
  ) {
    const shards = this.options?.shards?.[name] ?? this.options?.defaultShards;
    return ctx.runMutation(this.component.lib.add, {
      name,
      count,
      shards,
    });
  }
  async count<Name extends string = keyof Shards & string>(
    ctx: RunQueryCtx,
    name: Name
  ) {
    return ctx.runQuery(this.component.lib.count, { name });
  }
  /**
   * For easy re-exporting.
   * Apps can do
   * ```ts
   * export const { add, count } = fileSearch.api();
   * ```
   */
  api() {
    return {
      add: mutationGeneric({
        args: { name: v.string() },
        handler: async (ctx, args) => {
          await this.add(ctx, args.name);
        },
      }),
      count: queryGeneric({
        args: { name: v.string() },
        handler: async (ctx, args) => {
          return await this.count(ctx, args.name);
        },
      }),
    };
  }
}
