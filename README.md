# @archival/carriers-toolchain

Builds [archival](https://archival.dev) carriers: the small server side
functions a site keeps under `carriers/`. A carrier is built the same way
everywhere it runs, and this is that build.

1. **Install.** The packages the carrier's `package-lock.json` names are
   downloaded, checked against their hash and unpacked in memory.
2. **Strip.** [swc](https://swc.rs) removes TypeScript's types.
3. **Link.** Every import is resolved and rewritten to the relative path of the
   module it names.

Nothing is bundled and nothing is executed. The result is a map of module path
to source, plus the entry's path, ready to be written to disk, uploaded as an
unbundled Worker, or served to a page.

## What a carrier can be

The toolchain refuses anything that would not run identically everywhere, and
names the file or package when it does.

- **ES modules only.** A CommonJS file, or a package that only publishes
  CommonJS, is refused.
- **Web APIs only.** A Node built-in (`node:fs`, `crypto`, `buffer`) is refused.
- **Dependencies come from the lockfile.** Development and optional packages
  are left out, install scripts never run, and dependencies with no lockfile
  are refused. The lockfile must be version 2 or later.
- **TypeScript that erases.** Types are stripped, not transformed, which is
  the rule Node applies: no `enum`, no `namespace`, no parameter properties,
  and a type-only import must say `import type`. Positions are preserved, so a
  stack trace names the line the author wrote with no source map.

Relative imports may name a file with or without its extension, and a `.json`
file is imported as its value. Where a package offers a `browser` build beside
a `node` one, the `browser` build is linked.

## Use

```sh
npm install @archival/carriers-toolchain
```

The toolchain takes two functions from the platform it runs on: `strip`, which
removes types, and `parse`, which finds a module's imports. A host module
supplies the pair.

### In Node

```js
import { buildCarrier } from "@archival/carriers-toolchain";
import { parse, strip } from "@archival/carriers-toolchain/node";

const { entry, modules } = await buildCarrier({
  // The carrier's own files, by path relative to its directory.
  files: new Map([["index.ts", "export default async () => ({ ok: true });"]]),
  strip,
  parse,
  fetch,
});
// entry === "index.ts.js"; modules is a Map of path -> JavaScript.
```

`@archival/carriers-toolchain/node` strips with the swc version this package
pins. `@archival/carriers-toolchain/node-builtin` strips with Node's own
`stripTypeScriptTypes` instead (Node 22.13 or later), which is the same
stripper as that Node release bundles it.

### In a page or a Worker

```js
import { buildCarrier } from "@archival/carriers-toolchain";
import { createWebHost } from "@archival/carriers-toolchain/web";

const host = await createWebHost(fetch("/swc.wasm"));
const built = await buildCarrier({ files, fetch, ...host });
```

The wasm is `wasm_bg.wasm` from `@swc/wasm-typescript-esm`; the node host
exports its location as `swcWasmPath` for a build step that copies it. A Worker
cannot compile wasm at run time, so it imports the file as a module and calls
`createWebHostFromModule` with it.

### Embedded in another program

`@archival/carriers-toolchain/embedded` is the toolchain and the node-builtin
host bundled into one file that imports nothing but Node's own modules, for a
program that ships the toolchain inside itself. `npm run bundle` writes it to
`dist/embedded.mjs`.

## The API

|                                                          |                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildCarrier({ files, strip, parse, fetch, install? })` | Installs the lockfile's packages, then compiles. `install` replaces the download, for a host that caches installs.                                          |
| `compileCarrier({ files, strip, parse })`                | Compiles files that already include their installed packages under `node_modules/`. `files` needs only `has` and `get`, so it can be a view of a directory. |
| `installPackages({ lockfile, fetch })`                   | The loadable files of every runtime package, keyed by the path they would have on disk.                                                                     |
| `runtimePackages(lockfileText)`                          | What a lockfile says to install.                                                                                                                            |
| `carrierFunction(namespace)`                             | The default export of a loaded entry module, or `null` when it is not a function.                                                                           |
| `parseRequestBody(method, headers, bytes)`               | The second argument a carrier receives.                                                                                                                     |
| `toResponse(result)`                                     | Maps what a carrier returned onto a `Response`.                                                                                                             |
| `serializeResponse(response)`, `fromBase64`, `toBase64`  | A response as JSON, for a host that runs carriers across a boundary.                                                                                        |

A refusal is a `CarrierCompileError`, or a `LockfileError` for a lockfile that
cannot be installed from.

## Development

```sh
npm install
npm test
npm run format
```

The tests run under Node's own test runner. They build tarballs in memory and
stand in for the registry, so nothing is downloaded.

## Releasing

`swc` is pinned to an exact version in `package.json`, and every consumer gets
that version through this package, so bumping it here is what moves all of
them. Tagging `v<version>` publishes the package from CI.

## License

AGPL-3.0-or-later
