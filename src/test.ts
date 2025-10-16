import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");
function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string
) {
  t.registerComponent(name, schema, modules);
}
export default { schema, modules, register };
