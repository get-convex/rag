import { internalMutation, query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { DocumentSearch } from "@convex-dev/document-search";

const documentSearch = new DocumentSearch(components.documentSearch, {});

export const addOne = mutation({
  args: {},
  handler: async (ctx, _args) => {
    await documentSearch.add(ctx, "accomplishments");
  },
});

// Direct re-export of component's API.
export const { add, count } = documentSearch.api();
