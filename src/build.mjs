// A carrier's whole build, as every place that runs one performs it: install
// what its lockfile names, then compile. The lockfile is what makes an install
// the same list of files everywhere, so dependencies without one are refused
// rather than resolved afresh.

import { compileCarrier } from "./compile.mjs";
import { installPackages } from "./install.mjs";
import { runtimePackages } from "./lockfile.mjs";

// npm reads a shrinkwrap in preference to a lockfile when a package has both.
const LOCKFILES = ["npm-shrinkwrap.json", "package-lock.json"];

const declaresDependencies = (files) => {
  try {
    const manifest = JSON.parse(files.get("package.json") ?? "{}");
    return Object.keys(manifest.dependencies ?? {}).length > 0;
  } catch {
    return false;
  }
};

/**
 * Builds the carrier whose own files are `files`, by path. `install` is given
 * the lockfile's text and answers the installed files; it defaults to a fresh
 * download through `fetch`. Answers what `compileCarrier` does.
 */
export const buildCarrier = async ({
  files,
  strip,
  parse,
  fetch,
  install = (lockfile) => installPackages({ lockfile, fetch }),
}) => {
  const all = new Map(files);
  const lockfile = LOCKFILES.map((name) => files.get(name)).find(
    (text) => text !== undefined,
  );
  if (lockfile === undefined) {
    if (declaresDependencies(files)) {
      throw new Error(
        "package.json has dependencies and there is no package-lock.json. Commit one so they can be installed",
      );
    }
  } else if (runtimePackages(lockfile).length > 0) {
    for (const [path, source] of await install(lockfile)) {
      all.set(path, source);
    }
  }
  return compileCarrier({ files: all, strip, parse });
};
