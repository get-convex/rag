import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vDocumentId } from "@convex-dev/document-search";

export default defineSchema({
  // We can use a table with extra metadata to track extra things
  fileMetadata: defineTable({
    global: v.boolean(),
    filename: v.string(),
    storageId: v.id("_storage"),
    documentId: vDocumentId,
    uploadedBy: v.string(),
    category: v.optional(v.string()),
  })
    .index("global_category", ["global", "category"])
    .index("documentId", ["documentId"]),
  // Any tables used by the example app go here.
});
