import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import * as node from "../src/hosts/node.mjs";
import * as builtin from "../src/hosts/node-builtin.mjs";
import { buildCarrier, carrierFunction } from "../src/index.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = `import type { Carrier } from "@archival/carrier";\n\nconst carrier: Carrier = async (params: URLSearchParams) => ({\n  name: params.get("name") as string,\n});\nexport default carrier;\n`;

const dirs = [];
test.after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Bundles one of this package's modules the way a web consumer would. */
const bundled = async (entry, platform) => {
  const dir = mkdtempSync(path.join(tmpdir(), "carriers-toolchain-"));
  dirs.push(dir);
  const outfile = path.join(dir, "out.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform,
    outfile,
    define: platform === "browser" ? { "import.meta.url": '""' } : {},
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
};

test("the node host strips with the swc this package pins", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf-8"),
  );
  assert.equal(
    node.swcVersion,
    manifest.dependencies["@swc/wasm-typescript-esm"],
  );
  const stripped = node.strip(SOURCE, "index.ts");
  assert.equal(stripped.length, SOURCE.length, "positions are preserved");
  assert.doesNotMatch(stripped, /Carrier|URLSearchParams\)|as string/);
  assert.equal(node.parse(stripped)[0].length, 0);
});

test(
  "node's own stripper agrees with swc",
  { skip: !builtin.supported && "this Node cannot strip types" },
  () => {
    assert.equal(builtin.strip(SOURCE), node.strip(SOURCE, "index.ts"));
    assert.throws(() => builtin.strip("enum A { X }"));
    assert.throws(() => node.strip("enum A { X }", "index.ts"));
  },
);

test("the web host starts from wasm bytes or a compiled module", async () => {
  const web = await bundled("src/hosts/web.mjs", "browser");
  const wasm = readFileSync(node.swcWasmPath);
  const fromBytes = await web.createWebHost(wasm);
  assert.equal(
    fromBytes.strip(SOURCE, "index.ts"),
    node.strip(SOURCE, "index.ts"),
  );
  const fromModule = await web.createWebHostFromModule(
    new WebAssembly.Module(wasm),
  );
  assert.equal(
    fromModule.strip(SOURCE, "index.ts"),
    node.strip(SOURCE, "index.ts"),
  );
  const compiled = await buildCarrier({
    files: new Map([["index.ts", SOURCE]]),
    ...fromBytes,
  });
  assert.equal(compiled.entry, "index.ts.js");
});

test(
  "the embedded bundle builds a carrier with nothing installed",
  { skip: !builtin.supported && "this Node cannot strip types" },
  async () => {
    const embedded = await bundled("src/embedded.mjs", "node");
    const compiled = await embedded.buildCarrier({
      files: new Map([["index.ts", SOURCE]]),
      strip: embedded.strip,
      parse: embedded.parse,
    });
    const dir = mkdtempSync(path.join(tmpdir(), "carriers-toolchain-"));
    dirs.push(dir);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    for (const [name, code] of compiled.modules) {
      writeFileSync(path.join(dir, name), code);
    }
    const carrier = carrierFunction(
      await import(pathToFileURL(path.join(dir, compiled.entry)).href),
    );
    assert.deepEqual(await carrier(new URLSearchParams("name=sam")), {
      name: "sam",
    });
    assert.equal(typeof embedded.carrierFunction, "function");
  },
);

test("the package exports what its consumers import", async () => {
  const index = await import("../src/index.mjs");
  for (const name of [
    "buildCarrier",
    "compileCarrier",
    "carrierFunction",
    "CarrierCompileError",
    "installPackages",
    "runtimePackages",
    "LockfileError",
    "parseRequestBody",
    "toResponse",
    "serializeResponse",
  ]) {
    assert.ok(name in index, name);
  }
});
