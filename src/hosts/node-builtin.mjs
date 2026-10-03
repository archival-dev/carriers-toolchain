// A Node host that strips types with Node's own `stripTypeScriptTypes`, which
// is swc's type stripper as that Node release bundles it. It needs no wasm,
// which is what suits a host that embeds this toolchain rather than installing
// it; the cost is that the swc version follows the Node it runs on instead of
// this package's pin. Needs Node 22.13 or later.

import * as nodeModule from "node:module";
import { init, parse } from "es-module-lexer/js";

await init;

/** Whether this Node can strip types itself. */
export const supported = typeof nodeModule.stripTypeScriptTypes === "function";

export const strip = (code) => {
  if (!supported) {
    throw new Error(
      `Node ${process.versions.node} cannot strip TypeScript types; 22.13 or later is needed`,
    );
  }
  return nodeModule.stripTypeScriptTypes(code, { mode: "strip" });
};

export { parse };
