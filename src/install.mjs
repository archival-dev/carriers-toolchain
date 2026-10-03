// Installing a carrier's dependencies without npm: each package the lockfile
// names is downloaded, checked against its hash and unpacked in memory. No
// install script runs, which is also true of nothing a Worker can load.

import { runtimePackages } from "./lockfile.mjs";
import { gunzip, untar } from "./tar.mjs";

const ALGORITHMS = [
  ["sha512", "SHA-512"],
  ["sha384", "SHA-384"],
  ["sha256", "SHA-256"],
  ["sha1", "SHA-1"],
];

const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** Whether `bytes` match the strongest hash a subresource-integrity string carries. */
export const matchesIntegrity = async (bytes, integrity) => {
  const hashes = integrity.trim().split(/\s+/);
  for (const [prefix, algorithm] of ALGORITHMS) {
    const expected = hashes.find((hash) => hash.startsWith(`${prefix}-`));
    if (expected) {
      const digest = await crypto.subtle.digest(algorithm, bytes);
      return (
        toBase64(new Uint8Array(digest)) === expected.slice(prefix.length + 1)
      );
    }
  }
  return false;
};

// What a module graph can load. Everything else in a package (types, maps,
// readmes) is dropped as it is unpacked.
const LOADABLE = /\.(?:js|mjs|cjs|json)$/;
const CONCURRENCY = 6;

const decoder = new TextDecoder();

/**
 * Every loadable file of the lockfile's runtime packages, keyed by the path it
 * would have on disk (`node_modules/<name>/<file>`). `fetch` is given each
 * tarball's url.
 */
export const installPackages = async ({ lockfile, fetch }) => {
  const packages = runtimePackages(lockfile);
  const files = new Map();
  let next = 0;
  const worker = async () => {
    while (next < packages.length) {
      const { path, resolved, integrity } = packages[next++];
      const response = await fetch(resolved);
      if (!response.ok) {
        throw new Error(
          `Downloading ${path} failed: ${response.status} from ${resolved}`,
        );
      }
      const tarball = new Uint8Array(await response.arrayBuffer());
      if (!(await matchesIntegrity(tarball, integrity))) {
        throw new Error(
          `${path} does not match the integrity package-lock.json records for it`,
        );
      }
      for (const [name, bytes] of untar(await gunzip(tarball))) {
        if (LOADABLE.test(name)) {
          files.set(`${path}/${name}`, decoder.decode(bytes));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return files;
};
