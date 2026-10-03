// Reading an npm tarball: gzip, then a tar archive whose entries all sit under
// one top-level directory (`package/`).

export const gunzip = async (bytes) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );

const BLOCK = 512;
const decoder = new TextDecoder();

const text = (bytes, start, length) => {
  let end = start;
  while (end < start + length && bytes[end] !== 0) {
    end++;
  }
  return decoder.decode(bytes.subarray(start, end));
};

const octal = (bytes, start, length) =>
  parseInt(text(bytes, start, length).trim() || "0", 8);

/** The `path` and `size` a pax extended header sets for the entry after it. */
const paxRecords = (body) => {
  const records = {};
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space === -1) {
      break;
    }
    const length = parseInt(decoder.decode(body.subarray(at, space)), 10);
    if (!Number.isFinite(length) || length <= 0) {
      break;
    }
    const record = decoder.decode(body.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    if (equals !== -1) {
      records[record.slice(0, equals)] = record.slice(equals + 1);
    }
    at += length;
  }
  return records;
};

/**
 * The regular files of a tar archive, keyed by path with the leading
 * directory dropped. Long names arrive as pax (`x`) or GNU (`L`) headers ahead
 * of the entry they name.
 */
export const untar = (bytes) => {
  const files = new Map();
  let at = 0;
  let longName = null;
  let pax = {};
  while (at + BLOCK <= bytes.length) {
    const header = bytes.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const type = String.fromCharCode(header[156] || 0x30);
    let size = octal(header, 124, 12);
    const body = bytes.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      pax = paxRecords(body);
      continue;
    }
    if (type === "g") {
      continue;
    }
    if (type === "L") {
      longName = text(body, 0, body.length);
      continue;
    }
    const prefix = text(header, 345, 155);
    let name =
      pax.path ??
      longName ??
      (prefix ? `${prefix}/` : "") + text(header, 0, 100);
    if (pax.size !== undefined) {
      size = parseInt(pax.size, 10);
    }
    longName = null;
    pax = {};
    if (type !== "0") {
      continue;
    }
    const slash = name.indexOf("/");
    name = slash === -1 ? name : name.slice(slash + 1);
    if (name && !name.split("/").includes("..")) {
      files.set(name, body.subarray(0, size));
    }
  }
  return files;
};
