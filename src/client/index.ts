import { mutationGeneric, queryGeneric } from "convex/server";
import { v, type Value } from "convex/values";
import type { Mounts } from "../component/_generated/api";
import type {
  UseApi,
  RunMutationCtx,
  RunQueryCtx,
  RunActionCtx,
} from "./types";
import type { EmbeddingModelV1 } from "@ai-sdk/provider";

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
  metadata: Record<string, Value>; //{ loc: { lines: { from: number; to: number } } };
  embedding?: Array<number>;
};

type SearchOptions = {
  /**
   * The maximum number of messages to fetch. Default is 10.
   */
  limit: number;
  /**
   * What chunks around the search results to include.
   * Default: { before: 0, after: 0 }
   * Note, this is after the limit is applied.
   * e.g. { before: 2, after: 1 } means 2 chunks before and 1 chunk after.
   * This would result in up to (4 * limit) items returned.
   */
  chunkRange?: { before: number; after: number };
};

type Filter<FilterNames extends string = string, ValueType = Value> = {
  name: FilterNames;
  value: ValueType;
};

export class DocumentSearch<
  FitlerNames extends string = string,
> {
  constructor(
    public component: DocumentSearchComponent,
    public options?: {
      textEmbeddingModel: EmbeddingModelV1<string>;
      filterNames: FitlerNames[];
      // Common parameters:
      // logLevel
    }
  ) {}

  async upsert(
    ctx: RunActionCtx,
    args: {
      id: string;
      namespace: string;
      namespaceVersion?: number;
      chunks:
        | Iterable<MastraChunk | LangChainChunk>
        | AsyncIterable<MastraChunk | LangChainChunk>;
      mimeType: string;
      metadata?: Record<string, Value>;
      filterOptions?: Filter<FitlerNames>[];
    }
  ) {}

  async search(
    ctx: RunActionCtx,
    args: {
      query: string;
      namespace: string;
      namespaceVersion?: number;
      filters?: Filter<FitlerNames>[];
      searchOptions?: SearchOptions;
    }
  ) {
    const { query, namespace, namespaceVersion, filters } = args;
    const namespaceId = await this.component.createNamespace(ctx, {
      id: namespace,
      version: namespaceVersion,
    });
  }

  async delete(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      namespaceVersion?: number;
      id: string;
    }
  ) {}

  async deleteNamespaceAsync(
}
