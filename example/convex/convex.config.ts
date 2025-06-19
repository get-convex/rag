import { defineApp } from "convex/server";
import fileSearch from "@convex-dev/file-search/convex.config";

const app = defineApp();
app.use(fileSearch);

export default app;
