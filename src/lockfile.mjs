// Which packages a carrier's package-lock.json says to install to run it. The
// lockfile names every tarball and its hash, so an install is a list of
// downloads rather than a resolution.

export class LockfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockfileError";
  }
}

/**
 * The packages a deployed carrier would have beside it: everything the
 * lockfile places under `node_modules/` that is not a development or optional
 * dependency. Each is `{ path, resolved, integrity }`, with `path` the
 * directory the lockfile gives it.
 */
export const runtimePackages = (lockfileText) => {
  let lock;
  try {
    lock = JSON.parse(lockfileText);
  } catch {
    throw new LockfileError("package-lock.json is not valid JSON");
  }
  const packages = lock && lock.packages;
  if (!packages || typeof packages !== "object") {
    throw new LockfileError(
      "package-lock.json has no packages map; it needs lockfileVersion 2 or later (npm 7 and up write one)",
    );
  }
  const out = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || !entry) {
      continue;
    }
    if (entry.dev || entry.optional || entry.devOptional || entry.inBundle) {
      continue;
    }
    if (entry.link) {
      throw new LockfileError(
        `${path} is a linked package, which a carrier build cannot install`,
      );
    }
    const { resolved, integrity } = entry;
    if (
      typeof resolved !== "string" ||
      !resolved.startsWith("https://") ||
      typeof integrity !== "string"
    ) {
      throw new LockfileError(
        `${path} is not installed from a registry tarball, which is all a carrier build installs`,
      );
    }
    out.push({ path, resolved, integrity });
  }
  return out;
};
