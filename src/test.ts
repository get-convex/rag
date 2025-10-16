import { TestConvex } from "convex-test";
import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");
function register(t: TestConvex<any>, name: string) {
  t.registerComponent(name, schema, modules);
}
export default { schema, modules, register };
