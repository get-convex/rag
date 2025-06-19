import { internalMutation, query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { RAG } from "@convex-dev/rag";

const rag = new RAG(components.rag, {});

export const addOne = mutation({
  args: {},
  handler: async (ctx, _args) => {
    await rag.add(ctx, "accomplishments");
  },
});

// Direct re-export of component's API.
export const { add, count } = rag.api();
