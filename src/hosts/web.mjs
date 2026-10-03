// swc and the lexer for a page or a Worker. The wasm is handed over rather
// than located, because where it lives is the host's concern: a page passes a
// url or a fetch of one, a Worker passes the module it imported.

import initSwc, { initSync, transformSync } from "@swc/wasm-typescript-esm";
import { init, parse } from "es-module-lexer/js";

const strip = (code, filename) =>
  transformSync(code, { mode: "strip-only", filename }).code;

/**
 * Starts swc from a url, a `Response`, a promise of one, or bytes, and
 * answers the `{ strip, parse }` pair the toolchain takes.
 */
export const createWebHost = async (wasm) => {
  await Promise.all([initSwc({ module_or_path: wasm }), init]);
  return { strip, parse };
};

/**
 * The same, from a compiled `WebAssembly.Module`. A Worker cannot compile
 * wasm from bytes at run time, so it imports the module and starts from that.
 */
export const createWebHostFromModule = async (module) => {
  initSync({ module });
  await init;
  return { strip, parse };
};
