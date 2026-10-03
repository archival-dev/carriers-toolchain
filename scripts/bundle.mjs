#!/usr/bin/env node
// Writes dist/embedded.mjs: the toolchain and the node-builtin host in one
// file that imports nothing but node's own modules.

import esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await esbuild.build({
  entryPoints: [path.join(root, "src", "embedded.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  outfile: path.join(root, "dist", "embedded.mjs"),
  logLevel: "warning",
});
