import { defineApp } from "convex/server";
import memory from "@convex-dev/memory/convex.config";

const app = defineApp();
app.use(memory);

export default app;
