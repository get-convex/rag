import { internalMutation, query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { DocumentSearch } from "@convex-dev/document-search";

const documentSearch = new DocumentSearch(components.documentSearch, {});
