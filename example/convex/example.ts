import { internalMutation, query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { FileSearch } from "@convex-dev/file-search";

const fileSearch = new FileSearch(components.fileSearch, {});

export const addOne = mutation({
  args: {},
  handler: async (ctx, _args) => {
    await fileSearch.add(ctx, "accomplishments");
  },
});

// Direct re-export of component's API.
export const { add, count } = fileSearch.api();
