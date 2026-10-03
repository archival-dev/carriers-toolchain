// Everything a Node program needs to build carriers, as one module with no
// dependency to install: the toolchain, and the host that strips types with
// Node itself. `npm run bundle` writes it to dist/embedded.mjs as a single
// file, for a program that carries the toolchain inside it.

export * from "./index.mjs";
export { parse, strip, supported } from "./hosts/node-builtin.mjs";
