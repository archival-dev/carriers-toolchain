// Turns a carrier into the ES modules that run it: its own files with their
// types stripped, and every package file they reach, each with its imports
// rewritten to the relative path of the module they name. Nothing is bundled,
// so what loads is the module graph the carrier wrote.
//
// `strip` removes TypeScript syntax and `parse` is es-module-lexer's; both are
// passed in so this runs wherever those two do.

import {
  dirname,
  isNodeBuiltin,
  isRelative,
  isTypeScript,
  owningPackage,
  packageMain,
  resolveEntry,
  resolvePackage,
  resolvePackageImport,
  resolveRelative,
} from "./resolve.mjs";

export class CarrierCompileError extends Error {
  constructor(message) {
    super(message);
    this.name = "CarrierCompileError";
  }
}

// Types only, with an empty runtime: resolving it to nothing is what the
// published package does too.
const TYPES_ONLY_PACKAGE = "@archival/carrier";
const TYPES_ONLY_MODULE = "__archival_carrier.js";

const COMMONJS = /\b(?:module\.exports|exports\.[A-Za-z_$]|require\s*\()/;

// The name a module is served or uploaded under. A workerd upload types a
// module by its name, so everything that is not already JavaScript by name
// gains a suffix rather than a new extension, which cannot collide with a
// sibling file.
const emittedPath = (path) =>
  isTypeScript(path) || path.endsWith(".json") ? `${path}.js` : path;

const relativeSpecifier = (from, to) => {
  const fromParts = dirname(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < toParts.length - 1 &&
    fromParts[shared] === toParts[shared]
  ) {
    shared++;
  }
  const up = fromParts.length - shared;
  const rest = toParts.slice(shared).join("/");
  return up === 0 ? `./${rest}` : `${"../".repeat(up)}${rest}`;
};

const describe = (files, path) => {
  const directory = owningPackage(files, path);
  return directory
    ? `${directory.slice(directory.lastIndexOf("node_modules/") + "node_modules/".length)} (${path})`
    : path;
};

const resolveImport = (files, from, specifier) => {
  if (specifier === TYPES_ONLY_PACKAGE) {
    return TYPES_ONLY_MODULE;
  }
  if (isRelative(specifier)) {
    const file = resolveRelative(files, from, specifier);
    if (!file) {
      throw new CarrierCompileError(
        `${describe(files, from)} imports "${specifier}", which does not exist`,
      );
    }
    return file;
  }
  if (specifier.startsWith("#")) {
    const file = resolvePackageImport(files, from, specifier);
    if (!file) {
      throw new CarrierCompileError(
        `${describe(files, from)} imports "${specifier}", which its package.json does not map`,
      );
    }
    return file;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(specifier) &&
    !specifier.startsWith("node:")
  ) {
    throw new CarrierCompileError(
      `${describe(files, from)} imports "${specifier}"; a carrier can only import its own files and installed packages`,
    );
  }
  const resolved = resolvePackage(files, from, specifier);
  if (resolved.file) {
    return resolved.file;
  }
  if (resolved.missing === "package" && isNodeBuiltin(specifier)) {
    throw new CarrierCompileError(
      `${describe(files, from)} imports "${specifier}", a Node built-in. Carriers run on web APIs only`,
    );
  }
  throw new CarrierCompileError(
    resolved.missing === "package"
      ? `${describe(files, from)} imports "${specifier}", which is not installed. Add ${resolved.name} to the carrier's dependencies and commit its package-lock.json`
      : `${describe(files, from)} imports "${specifier}", which ${resolved.name} does not export as an ES module`,
  );
};

const compileModule = (files, path, { strip, parse }) => {
  const source = files.get(path);
  if (path.endsWith(".json")) {
    try {
      JSON.parse(source);
    } catch {
      throw new CarrierCompileError(
        `${describe(files, path)} is not valid JSON`,
      );
    }
    return { code: `export default ${source.trim()};\n`, imports: [] };
  }
  if (/\.c[jt]s$/.test(path)) {
    throw new CarrierCompileError(
      `${describe(files, path)} is CommonJS. Carriers and their dependencies must be ES modules`,
    );
  }
  let code = source;
  if (isTypeScript(path)) {
    try {
      code = strip(source, path);
    } catch (error) {
      throw new CarrierCompileError(
        `${describe(files, path)}: ${(error && error.message) || error}`,
      );
    }
  }
  let imports;
  let hasModuleSyntax;
  try {
    [imports, , , hasModuleSyntax] = parse(code, path);
  } catch (error) {
    throw new CarrierCompileError(
      `${describe(files, path)} could not be parsed: ${(error && error.message) || error}`,
    );
  }
  if (!hasModuleSyntax && COMMONJS.test(code)) {
    throw new CarrierCompileError(
      `${describe(files, path)} is CommonJS. Carriers and their dependencies must be ES modules`,
    );
  }
  const edits = [];
  const targets = [];
  for (const found of imports) {
    if (typeof found.specifier !== "string") {
      continue;
    }
    const file = resolveImport(files, path, found.specifier);
    targets.push(file);
    // A dynamic import's range includes its quotes; a static one's does not.
    const quoted = /["'`]/.test(code[found.start]);
    const [start, end] = quoted
      ? [found.start + 1, found.end - 1]
      : [found.start, found.end];
    edits.push([start, end, relativeSpecifier(path, emittedPath(file))]);
    // A JSON file is emitted as a module of its own, so the attribute that
    // asked for JSON no longer describes what is imported.
    if (found.type !== "dynamic" && found.attributesStart > -1) {
      edits.push([end + 1, found.importEnd, ""]);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [start, end, replacement] of edits) {
    code = code.slice(0, start) + replacement + code.slice(end);
  }
  return { code, imports: targets };
};

/**
 * Compiles the carrier whose files (its own and its installed packages') are
 * `files`. Answers the entry's module path and every module of the graph,
 * keyed by the path it is served or uploaded under.
 */
export const compileCarrier = ({ files, strip, parse }) => {
  const entry = resolveEntry(files, packageMain(files));
  if (!entry) {
    const commonjs = ["index.cjs", "index.cts"].find((file) => files.has(file));
    if (commonjs) {
      throw new CarrierCompileError(
        `${commonjs} is CommonJS. Carriers and their dependencies must be ES modules`,
      );
    }
    throw new CarrierCompileError(
      'Couldn\'t find a main file: expected index.ts or index.js, or the "main" package.json declares',
    );
  }
  const modules = new Map();
  const pending = [entry];
  while (pending.length) {
    const path = pending.pop();
    const emitted = emittedPath(path);
    if (modules.has(emitted)) {
      continue;
    }
    if (path === TYPES_ONLY_MODULE) {
      modules.set(emitted, "export {};\n");
      continue;
    }
    const { code, imports } = compileModule(files, path, { strip, parse });
    modules.set(emitted, code);
    pending.push(...imports);
  }
  return { entry: emittedPath(entry), modules };
};

/** The default export of a carrier's entry module, which must be a function. */
export const carrierFunction = (namespace) =>
  namespace && typeof namespace.default === "function"
    ? namespace.default
    : null;
