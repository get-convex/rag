import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vEntryId } from "@convex-dev/rag";

export default defineSchema({
  // We can use a table with extra metadata to track extra things
  fileMetadata: defineTable({
    entryId: vEntryId,
    filename: v.string(),
    storageId: v.id("_storage"),
    global: v.boolean(),
    category: v.optional(v.string()),
    uploadedBy: v.string(),
  })
    .index("global_category", ["global", "category"])
    .index("entryId", ["entryId"]),
  // Any tables used by the example app go here.
});
