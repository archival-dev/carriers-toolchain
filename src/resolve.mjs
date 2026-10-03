// Where an import lands, over a carrier's own files and the packages installed
// beside them. Every lookup is against a map of path to source, so the same
// resolution runs wherever the map can be built.

const TS_EXTENSIONS = [".ts", ".mts"];
const JS_EXTENSIONS = [".js", ".mjs"];
export const MAIN_EXTENSIONS = [...TS_EXTENSIONS, ...JS_EXTENSIONS];
const IMPORT_EXTENSIONS = [...MAIN_EXTENSIONS, ".json"];

// The conditions a package's `exports` are read under. `browser` is what
// selects a web-crypto build over a node one; neither `node` nor `require` is
// ever satisfied, since nothing here can load CommonJS or a node builtin.
const CONDITIONS = new Set([
  "worker",
  "browser",
  "import",
  "module",
  "default",
]);

const NODE_BUILTINS = new Set(
  (
    "assert async_hooks buffer child_process cluster console constants crypto dgram " +
    "diagnostics_channel dns domain events fs http http2 https inspector module net os " +
    "path perf_hooks process punycode querystring readline repl stream string_decoder " +
    "sys timers tls tty url util v8 vm worker_threads zlib"
  ).split(" "),
);

export const isTypeScript = (path) =>
  TS_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));

export const normalize = (path) => {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
};

export const dirname = (path) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

const stripExtension = (path) => {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
};

/**
 * The entry file to import, or null. Mirrors archival's own resolution: the
 * `main` a package.json declares, then the same name under every supported
 * extension (`npm init` writes `index.js` into TypeScript carriers), then
 * `index.*`.
 */
export const resolveEntry = (files, pkgMain) => {
  const candidates = [];
  if (pkgMain) {
    const main = normalize(pkgMain);
    candidates.push(main);
    const base = stripExtension(main);
    candidates.push(...MAIN_EXTENSIONS.map((ext) => `${base}${ext}`));
  } else {
    candidates.push(...MAIN_EXTENSIONS.map((ext) => `index${ext}`));
  }
  return candidates.find((candidate) => files.has(candidate)) ?? null;
};

const readJson = (files, path) => {
  const source = files.get(path);
  if (source === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

/** The `main` in a carrier's package.json, or null when there is none. */
export const packageMain = (files) => {
  const main = readJson(files, "package.json")?.main;
  return typeof main === "string" ? main : null;
};

/**
 * The file a path names, or null. An extensionless path is probed under every
 * supported extension and as a directory index, and one written with a `.js`
 * suffix is resolved to the TypeScript file it compiles from, which is how
 * TypeScript's own resolution reads it.
 */
const probe = (files, target, directoryOnly = false) => {
  const candidates = [];
  if (!directoryOnly) {
    candidates.push(target);
    if (JS_EXTENSIONS.some((ext) => target.endsWith(ext))) {
      const base = stripExtension(target);
      candidates.push(...TS_EXTENSIONS.map((ext) => `${base}${ext}`));
    }
    candidates.push(...IMPORT_EXTENSIONS.map((ext) => `${target}${ext}`));
  }
  candidates.push(...MAIN_EXTENSIONS.map((ext) => `${target}/index${ext}`));
  return candidates.find((candidate) => files.has(candidate)) ?? null;
};

export const isRelative = (specifier) =>
  specifier.startsWith("./") || specifier.startsWith("../");

export const resolveRelative = (files, fromPath, specifier) =>
  probe(
    files,
    normalize(`${dirname(fromPath)}/${specifier}`),
    specifier.endsWith("/"),
  );

export const isNodeBuiltin = (specifier) =>
  specifier.startsWith("node:") || NODE_BUILTINS.has(specifier.split("/")[0]);

/** A bare specifier's package name and the subpath within it (`.` or `./x`). */
export const splitPackageSpecifier = (specifier) => {
  const parts = specifier.split("/");
  const length = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, length).join("/");
  const rest = parts.slice(length).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
};

/** The directory of the nearest installed copy of `name`, walking up from the importer. */
const packageDirectory = (files, fromPath, name) => {
  let directory = dirname(fromPath);
  for (;;) {
    const candidate = normalize(`${directory}/node_modules/${name}`);
    if (files.has(`${candidate}/package.json`)) {
      return candidate;
    }
    if (!directory) {
      return null;
    }
    directory = dirname(directory);
  }
};

/** The directory of the package a file belongs to, or null for a carrier's own file. */
export const owningPackage = (files, path) => {
  let directory = dirname(path);
  while (directory.includes("node_modules/")) {
    if (files.has(`${directory}/package.json`)) {
      return directory;
    }
    directory = dirname(directory);
  }
  return null;
};

const target = (value, star) => {
  if (typeof value === "string") {
    return value.startsWith("./") ? value.replaceAll("*", star) : null;
  }
  if (Array.isArray(value)) {
    for (const option of value) {
      const hit = target(option, star);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [condition, option] of Object.entries(value)) {
      if (CONDITIONS.has(condition)) {
        const hit = target(option, star);
        if (hit) {
          return hit;
        }
      }
    }
  }
  return null;
};

/** What a package's `exports` or `imports` map gives for one key, or null. */
const mapped = (map, key) => {
  if (Object.hasOwn(map, key)) {
    return target(map[key], "");
  }
  let best = null;
  for (const pattern of Object.keys(map)) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      continue;
    }
    const [head, tail] = [pattern.slice(0, star), pattern.slice(star + 1)];
    if (
      key.startsWith(head) &&
      key.endsWith(tail) &&
      key.length >= pattern.length - 1 &&
      (!best || head.length > best.head.length)
    ) {
      best = { head, tail, pattern };
    }
  }
  return best
    ? target(
        map[best.pattern],
        key.slice(best.head.length, key.length - best.tail.length),
      )
    : null;
};

const exportsMap = (exports) => {
  const subpaths =
    exports &&
    typeof exports === "object" &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith("."));
  return subpaths ? exports : { ".": exports };
};

/**
 * The file a bare import names, as `{ file }`, or `{ missing }` saying whether
 * the package is absent or does not offer the subpath.
 */
export const resolvePackage = (files, fromPath, specifier) => {
  const { name, subpath } = splitPackageSpecifier(specifier);
  const directory = packageDirectory(files, fromPath, name);
  if (!directory) {
    return { missing: "package", name };
  }
  const manifest = readJson(files, `${directory}/package.json`) ?? {};
  let relative;
  if (manifest.exports !== undefined) {
    relative = mapped(exportsMap(manifest.exports), subpath);
    if (!relative) {
      return { missing: "export", name };
    }
    const file = normalize(`${directory}/${relative}`);
    return files.has(file) ? { file } : { missing: "export", name };
  }
  if (subpath === ".") {
    const main =
      [manifest.module, manifest.main].find((m) => typeof m === "string") ??
      "index.js";
    relative = main;
  } else {
    relative = subpath;
  }
  const file = probe(files, normalize(`${directory}/${relative}`));
  return file ? { file } : { missing: "export", name };
};

/** The file a `#name` import names within the importer's own package, or null. */
export const resolvePackageImport = (files, fromPath, specifier) => {
  const directory = owningPackage(files, fromPath) ?? "";
  const manifest = readJson(
    files,
    directory ? `${directory}/package.json` : "package.json",
  );
  const imports = manifest?.imports;
  if (!imports || typeof imports !== "object") {
    return null;
  }
  const relative = mapped(imports, specifier);
  if (!relative) {
    return null;
  }
  const file = normalize(`${directory}/${relative}`);
  return files.has(file) ? file : probe(files, file);
};
