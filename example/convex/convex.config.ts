import { defineApp } from "convex/server";
import documentSearch from "@convex-dev/document-search/convex.config";

const app = defineApp();
app.use(documentSearch);

export default app;
