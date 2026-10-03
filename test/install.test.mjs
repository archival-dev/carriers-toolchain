import test from "node:test";
import assert from "node:assert/strict";
import { installPackages, matchesIntegrity } from "../src/install.mjs";
import { LockfileError, runtimePackages } from "../src/lockfile.mjs";
import { gunzip, untar } from "../src/tar.mjs";
import { integrityOf, tarball } from "./support.mjs";

const lockfile = (packages) =>
  JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });

test("runtime packages leave out dev, optional and bundled entries", () => {
  const packages = runtimePackages(
    lockfile({
      "node_modules/a": {
        resolved: "https://r.example/a.tgz",
        integrity: "sha512-x",
      },
      "node_modules/a/node_modules/b": {
        resolved: "https://r.example/b.tgz",
        integrity: "sha512-y",
      },
      "node_modules/typescript": {
        resolved: "https://r.example/t.tgz",
        integrity: "sha512-z",
        dev: true,
      },
      "node_modules/fsevents": {
        resolved: "https://r.example/f.tgz",
        integrity: "sha512-z",
        optional: true,
      },
      "node_modules/inner": { inBundle: true },
    }),
  );
  assert.deepEqual(
    packages.map((p) => p.path),
    ["node_modules/a", "node_modules/a/node_modules/b"],
  );
});

test("a lockfile the preview cannot install from says why", () => {
  assert.throws(() => runtimePackages("nope"), LockfileError);
  assert.throws(
    () => runtimePackages(`{"lockfileVersion":1,"dependencies":{}}`),
    /lockfileVersion 2/,
  );
  assert.throws(
    () =>
      runtimePackages(
        lockfile({
          "node_modules/g": {
            resolved: "git+ssh://git@github.com/x/y.git#abc",
          },
        }),
      ),
    /node_modules\/g/,
  );
  assert.throws(
    () =>
      runtimePackages(
        lockfile({ "node_modules/l": { resolved: "../l", link: true } }),
      ),
    /linked/,
  );
});

test("a tarball unpacks to its files without the package directory", async () => {
  const bytes = await tarball({
    "package.json": `{"name":"x"}`,
    "dist/index.js": "export default 1;",
  });
  const files = untar(await gunzip(bytes));
  assert.deepEqual([...files.keys()], ["package.json", "dist/index.js"]);
  assert.equal(
    new TextDecoder().decode(files.get("dist/index.js")),
    "export default 1;",
  );
});

test("integrity is checked against the strongest hash given", async () => {
  const bytes = new TextEncoder().encode("hello");
  const integrity = await integrityOf(bytes);
  assert.equal(await matchesIntegrity(bytes, integrity), true);
  assert.equal(await matchesIntegrity(bytes, `sha1-AAAA ${integrity}`), true);
  assert.equal(
    await matchesIntegrity(new TextEncoder().encode("other"), integrity),
    false,
  );
  assert.equal(await matchesIntegrity(bytes, "md5-abc"), false);
});

test("an install downloads, verifies and unpacks each runtime package", async () => {
  const pkg = await tarball({
    "package.json": `{"name":"tiny","type":"module","main":"index.js"}`,
    "index.js": "export default 1;",
    "index.d.ts": "declare const x: number; export default x;",
    "README.md": "# tiny",
  });
  const requested = [];
  const files = await installPackages({
    lockfile: lockfile({
      "node_modules/tiny": {
        resolved: "https://r.example/tiny.tgz",
        integrity: await integrityOf(pkg),
      },
      "node_modules/dev-only": {
        resolved: "https://r.example/dev.tgz",
        integrity: "sha512-x",
        dev: true,
      },
    }),
    fetch: async (url) => {
      requested.push(url);
      return new Response(pkg);
    },
  });
  assert.deepEqual(requested, ["https://r.example/tiny.tgz"]);
  assert.deepEqual([...files.keys()].sort(), [
    "node_modules/tiny/index.js",
    "node_modules/tiny/package.json",
  ]);
});

test("a tarball that does not match its lockfile hash is refused", async () => {
  const pkg = await tarball({ "index.js": "export default 1;" });
  await assert.rejects(
    installPackages({
      lockfile: lockfile({
        "node_modules/tiny": {
          resolved: "https://r.example/tiny.tgz",
          integrity: await integrityOf(new Uint8Array([1])),
        },
      }),
      fetch: async () => new Response(pkg),
    }),
    /integrity/,
  );
  await assert.rejects(
    installPackages({
      lockfile: lockfile({
        "node_modules/tiny": {
          resolved: "https://r.example/tiny.tgz",
          integrity: "sha512-x",
        },
      }),
      fetch: async () => new Response("no", { status: 404 }),
    }),
    /404/,
  );
});
