import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { addFileAsync } from "./example.js";
import { corsRouter } from "convex-helpers/server/cors";

const cors = corsRouter(httpRouter(), {
  allowedHeaders: [
    "x-filename",
    "x-category",
    "x-global-namespace",
    "Content-Type",
  ],
});

cors.route({
  path: "/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    await addFileAsync(ctx, {
      globalNamespace: Boolean(request.headers.get("x-global-namespace")),
      filename: request.headers.get("x-filename")!,
      blob: await request.blob(),
      category: request.headers.get("x-category") || null,
    });
    return new Response();
  }),
});

// Convex expects the router to be the default export of `convex/http.js`.
export default cors.http;
