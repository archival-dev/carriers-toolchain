// The carrier build toolchain. A carrier is built the same way wherever it
// runs: the packages its lockfile names are installed, TypeScript's types are
// stripped, and every import is rewritten to the module it resolves to.
//
// Everything here is free of platform APIs beyond the web's own, and takes
// the two things a platform supplies (`strip` and `parse`) as arguments. A
// host module (`./hosts/*.mjs`) provides that pair for one platform.

export { buildCarrier } from "./build.mjs";
export {
  CarrierCompileError,
  carrierFunction,
  compileCarrier,
} from "./compile.mjs";
export { installPackages, matchesIntegrity } from "./install.mjs";
export { LockfileError, runtimePackages } from "./lockfile.mjs";
export { gunzip, untar } from "./tar.mjs";
export {
  errorResponse,
  fromBase64,
  parseRequestBody,
  serializeResponse,
  toBase64,
  toResponse,
} from "./protocol.mjs";
