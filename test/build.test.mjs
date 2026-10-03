import test from "node:test";
import assert from "node:assert/strict";
import { buildCarrier } from "../src/build.mjs";
import { files, integrityOf, parse, strip, tarball } from "./support.mjs";

const tiny = await tarball({
  "package.json": `{"name":"tiny","type":"module","exports":"./index.js"}`,
  "index.js": "export const one = 1;",
});
const lockfile = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": {},
    "node_modules/tiny": {
      resolved: "https://r.example/tiny.tgz",
      integrity: await integrityOf(tiny),
    },
  },
});
const source = {
  "index.ts": `import { one } from "tiny"; export default (): number => one;`,
  "package.json": `{"dependencies":{"tiny":"1.0.0"}}`,
};

test("a build installs what the lockfile names, then compiles", async () => {
  const requested = [];
  const compiled = await buildCarrier({
    files: files({ ...source, "package-lock.json": lockfile }),
    strip,
    parse,
    fetch: async (url) => {
      requested.push(url);
      return new Response(tiny);
    },
  });
  assert.deepEqual(requested, ["https://r.example/tiny.tgz"]);
  assert.ok(compiled.modules.has("node_modules/tiny/index.js"));
  assert.equal(compiled.entry, "index.ts.js");
});

test("a shrinkwrap is read in preference to a lockfile", async () => {
  const seen = [];
  await buildCarrier({
    files: files({
      ...source,
      "npm-shrinkwrap.json": lockfile,
      "package-lock.json": "{}",
    }),
    strip,
    parse,
    install: async (text) => {
      seen.push(text);
      return files({
        "node_modules/tiny/package.json": `{"type":"module","exports":"./index.js"}`,
        "node_modules/tiny/index.js": "export const one = 1;",
      });
    },
  });
  assert.deepEqual(seen, [lockfile]);
});

test("dependencies without a lockfile are refused", async () => {
  await assert.rejects(
    buildCarrier({
      files: files(source),
      strip,
      parse,
      fetch: async () => new Response(""),
    }),
    /package-lock\.json/,
  );
});

test("a carrier with no dependencies never installs", async () => {
  const compiled = await buildCarrier({
    files: files({
      "index.ts": `export default (): number => 1;`,
      "package.json": `{"devDependencies":{"typescript":"^5"}}`,
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/typescript": {
            resolved: "https://r.example/t.tgz",
            integrity: "sha512-x",
            dev: true,
          },
        },
      }),
    }),
    strip,
    parse,
    fetch: async () => {
      throw new Error("nothing should be downloaded");
    },
  });
  assert.equal(compiled.modules.size, 1);
});
