import test from "node:test";
import assert from "node:assert/strict";
import {
  CarrierCompileError,
  carrierFunction,
  compileCarrier,
} from "../src/compile.mjs";
import { files, parse, strip } from "./support.mjs";

const compile = (entries) =>
  compileCarrier({ files: files(entries), strip, parse });

const fails = (entries, ...patterns) =>
  assert.throws(
    () => compile(entries),
    (error) => {
      assert.ok(error instanceof CarrierCompileError, String(error));
      for (const pattern of patterns) {
        assert.match(error.message, pattern);
      }
      return true;
    },
  );

/** Imports a compiled graph through data: urls, dependencies first. */
const load = async ({ entry, modules }) => {
  const urls = new Map();
  const link = (path) => {
    if (!urls.has(path)) {
      const directory = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      const code = modules
        .get(path)
        .replace(
          /((?:from|import)\s*\(?\s*")(\.\.?\/[^"]+)(")/g,
          (_, before, specifier, after) => {
            const parts = `${directory}/${specifier}`.split("/");
            const out = [];
            for (const part of parts) {
              if (part === "..") out.pop();
              else if (part && part !== ".") out.push(part);
            }
            return before + link(out.join("/")) + after;
          },
        );
      urls.set(
        path,
        "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
      );
    }
    return urls.get(path);
  };
  return import(link(entry));
};

test("a typescript carrier compiles to modules that run", async () => {
  const compiled = compile({
    "index.ts": `
      import type { Carrier } from "@archival/carrier";
      import { greet } from "./lib/greet";
      import { suffix } from "./lib/suffix.ts";
      import data from "./data.json";
      const carrier: Carrier = async (params) => ({ hello: greet(params.get("name")) + suffix, count: data.count });
      export default carrier;
    `,
    "lib/greet.ts": `export const greet = (name: string | null): string => "hi " + name;`,
    "lib/suffix.ts": `export const suffix: string = "!";`,
    "data.json": `{"count": 2}`,
  });
  assert.equal(compiled.entry, "index.ts.js");
  assert.deepEqual([...compiled.modules.keys()].sort(), [
    "data.json.js",
    "index.ts.js",
    "lib/greet.ts.js",
    "lib/suffix.ts.js",
  ]);
  const index = compiled.modules.get("index.ts.js");
  assert.match(index, /from "\.\/lib\/greet\.ts\.js"/);
  assert.match(index, /from "\.\/data\.json\.js"/);
  assert.doesNotMatch(index, /@archival\/carrier/);
  const carrier = carrierFunction(await load(compiled));
  assert.deepEqual(await carrier(new URLSearchParams("name=sam")), {
    hello: "hi sam!",
    count: 2,
  });
});

test("stripping keeps every line where it was", () => {
  const source = `import type { Carrier } from "@archival/carrier";\n\nconst carrier: Carrier = async () => {\n  throw new Error("boom");\n};\nexport default carrier;\n`;
  const { modules } = compile({ "index.ts": source });
  const compiled = modules.get("index.ts.js");
  assert.equal(compiled.split("\n").length, source.split("\n").length);
  assert.equal(compiled.split("\n")[3], `  throw new Error("boom");`);
});

test("the entry follows package.json main, falling back across extensions", () => {
  assert.equal(
    compile({
      "package.json": `{"main":"src/main.js"}`,
      "src/main.ts": `export default () => 1;`,
    }).entry,
    "src/main.ts.js",
  );
  fails({ "readme.md": "" }, /main file/);
});

test("an es module dependency is linked from node_modules", async () => {
  const compiled = compile({
    "index.ts": `
      import { slug } from "tiny-slug";
      import { deep } from "@scope/pkg/deep";
      export default () => slug("A B") + deep;
    `,
    "node_modules/tiny-slug/package.json": `{"name":"tiny-slug","type":"module","exports":{"node":"./node.cjs","browser":"./web.js","default":"./index.js"}}`,
    "node_modules/tiny-slug/web.js": `import { lower } from "./lower.js";\nexport const slug = (s) => lower(s).replace(/ /g, "-");`,
    "node_modules/tiny-slug/lower.js": `export const lower = (s) => s.toLowerCase();`,
    "node_modules/tiny-slug/index.js": `import crypto from "node:crypto";\nexport const slug = () => crypto;`,
    "node_modules/tiny-slug/node.cjs": `module.exports = {};`,
    "node_modules/@scope/pkg/package.json": `{"name":"@scope/pkg","exports":{"./*":{"import":"./esm/*.mjs"}}}`,
    "node_modules/@scope/pkg/esm/deep.mjs": `export const deep = "!";`,
  });
  assert.match(
    compiled.modules.get("index.ts.js"),
    /from "\.\/node_modules\/tiny-slug\/web\.js"/,
  );
  assert.ok(compiled.modules.has("node_modules/tiny-slug/lower.js"));
  assert.ok(!compiled.modules.has("node_modules/tiny-slug/index.js"));
  assert.equal(carrierFunction(await load(compiled))(), "a-b!");
});

test("a package without exports resolves through module, then main", () => {
  const compiled = compile({
    "index.js": `import a from "legacy"; import b from "legacy/extra"; export default () => a + b;`,
    "node_modules/legacy/package.json": `{"main":"cjs.js","module":"esm.js"}`,
    "node_modules/legacy/esm.js": `export default 1;`,
    "node_modules/legacy/cjs.js": `module.exports = 1;`,
    "node_modules/legacy/extra.js": `export default 2;`,
  });
  assert.ok(compiled.modules.has("node_modules/legacy/esm.js"));
  assert.ok(compiled.modules.has("node_modules/legacy/extra.js"));
});

test("a nested copy of a package wins over the hoisted one", () => {
  const compiled = compile({
    "index.js": `import a from "a"; export default () => a;`,
    "node_modules/a/package.json": `{"type":"module","main":"index.js"}`,
    "node_modules/a/index.js": `import b from "b"; export default b;`,
    "node_modules/a/node_modules/b/package.json": `{"type":"module","main":"index.js"}`,
    "node_modules/a/node_modules/b/index.js": `export default "nested";`,
    "node_modules/b/package.json": `{"type":"module","main":"index.js"}`,
    "node_modules/b/index.js": `export default "hoisted";`,
  });
  assert.ok(compiled.modules.has("node_modules/a/node_modules/b/index.js"));
  assert.ok(!compiled.modules.has("node_modules/b/index.js"));
  assert.match(
    compiled.modules.get("node_modules/a/index.js"),
    /from "\.\/node_modules\/b\/index\.js"/,
  );
});

test("modules that import each other compile once each", () => {
  const compiled = compile({
    "index.js": `import { b } from "./b.js"; export const a = 1; export default () => b;`,
    "b.js": `import { a } from "./index.js"; export const b = () => a;`,
  });
  assert.equal(compiled.modules.size, 2);
});

test("a dynamic import and an import attribute are rewritten", () => {
  const { modules } = compile({
    "index.js": `import data from "./data.json" with { type: "json" };\nexport default async () => (await import("./late")).value + data.n;`,
    "late.js": `export const value = 1;`,
    "data.json": `{"n":1}`,
  });
  const index = modules.get("index.js");
  assert.match(index, /import data from "\.\/data\.json\.js";/);
  assert.match(index, /import\("\.\/late\.js"\)/);
});

test("an import computed at runtime is refused, in a carrier or in a package", () => {
  fails(
    {
      "index.js": `export default async () => (await import(["cloudflare", "workers"].join(":"))).env;`,
    },
    /index\.js/,
    /\["cloudflare", "workers"\]\.join\(":"\)/,
    /computed when it runs/,
  );
  fails(
    {
      "index.js":
        "const scheme = 'cloudflare';\nexport default () => import(`${scheme}:workers`);",
    },
    /computed when it runs/,
  );
  fails(
    {
      "index.js": `const name = "./late.js";\nexport default () => import(name);`,
      "late.js": `export default 1;`,
    },
    /computed when it runs/,
  );
  fails(
    {
      "index.ts": `import sneaky from "sneaky"; export default () => sneaky;`,
      "node_modules/sneaky/package.json": `{"type":"module","main":"index.js"}`,
      "node_modules/sneaky/index.js": `export default (m) => import.source(m);`,
    },
    /sneaky/,
    /computed when it runs/,
  );
});

test("import.meta is not an import", async () => {
  const carrier = await load(
    compile({
      "index.js": `const url = import.meta.url;\nexport default () => typeof import.meta.url + typeof url;`,
    }),
  );
  assert.equal(carrier.default(), "stringstring");
});

test("a commonjs dependency is refused by name", () => {
  fails(
    {
      "index.ts": `import old from "old-pkg"; export default () => old;`,
      "node_modules/old-pkg/package.json": `{"main":"index.js"}`,
      "node_modules/old-pkg/index.js": `const x = require("./x");\nmodule.exports = x;`,
    },
    /old-pkg/,
    /CommonJS/,
  );
  fails({ "index.cjs": `module.exports = () => 1;` }, /CommonJS/);
  fails({ "index.js": `module.exports = () => 1;` }, /index\.js/, /CommonJS/);
});

test("a node built-in is refused, in a carrier or in a package", () => {
  fails(
    {
      "index.ts": `import { readFileSync } from "node:fs"; export default () => readFileSync;`,
    },
    /node:fs/,
    /Node built-in/,
  );
  fails(
    {
      "index.ts": `import hash from "hasher"; export default () => hash;`,
      "node_modules/hasher/package.json": `{"type":"module","main":"index.js"}`,
      "node_modules/hasher/index.js": `import crypto from "crypto"; export default crypto;`,
    },
    /hasher/,
    /"crypto"/,
    /Node built-in/,
  );
});

test("a package that is not installed says how to install it", () => {
  fails(
    {
      "index.ts": `import { marked } from "marked"; export default () => marked("x");`,
    },
    /"marked"/,
    /package-lock\.json/,
  );
});

test("an export a package does not offer as an es module is refused", () => {
  fails(
    {
      "index.js": `import x from "cjs-only"; export default () => x;`,
      "node_modules/cjs-only/package.json": `{"exports":{"require":"./index.cjs"}}`,
      "node_modules/cjs-only/index.cjs": `module.exports = 1;`,
    },
    /cjs-only/,
    /ES module/,
  );
});

test("syntax that needs more than stripping is reported with its file", () => {
  fails({ "index.ts": `enum A { X }\nexport default () => A.X;` }, /index\.ts/);
  fails(
    { "index.ts": `import "./missing"; export default () => 1;` },
    /"\.\/missing"/,
  );
  fails(
    {
      "index.js": `import x from "https://example.com/x.js"; export default x;`,
    },
    /https:/,
  );
});

test("a carrier without a function default export is reported", () => {
  assert.equal(carrierFunction({ default: 42 }), null);
  assert.equal(carrierFunction({}), null);
  assert.equal(carrierFunction(undefined), null);
});
