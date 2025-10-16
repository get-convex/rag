/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
export const modules = import.meta.glob("./**/*.*s");

// This is how users write tests that use your component.
import rag from "@convex-dev/rag/test";

export function initConvexTest() {
  const t = convexTest(schema, modules);
  rag.register(t, "rag");
  return t;
}

test("setup", () => {});
