// swc and the lexer for a Node host, pinned to the swc this package depends
// on. The swc package's node entry is missing from what it publishes, so its
// browser module is loaded by path and handed the wasm, which is also how a
// web host starts it.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { init, parse } from "es-module-lexer/js";

const PACKAGE = "node_modules/@swc/wasm-typescript-esm";

const findSwc = () => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(directory, PACKAGE);
    if (existsSync(path.join(candidate, "wasm.js"))) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`${PACKAGE} is not installed`);
    }
    directory = parent;
  }
};

const swcDirectory = findSwc();

/** The wasm a web host is handed, for a build that ships one. */
export const swcWasmPath = path.join(swcDirectory, "wasm_bg.wasm");

/** The swc version this host strips with. */
export const swcVersion = JSON.parse(
  readFileSync(path.join(swcDirectory, "package.json"), "utf-8"),
).version;

const swc = await import(
  pathToFileURL(path.join(swcDirectory, "wasm.js")).href
);
swc.initSync({ module: readFileSync(swcWasmPath) });
await init;

export const strip = (code, filename) =>
  swc.transformSync(code, { mode: "strip-only", filename }).code;

export { parse };
