// What the tests share: the node host's swc and lexer, and a way to build the
// tarballs an install downloads.

import { parse, strip } from "../src/hosts/node.mjs";

export { parse, strip };

export const files = (entries) => new Map(Object.entries(entries));

const encoder = new TextEncoder();

const field = (block, offset, length, value) =>
  block.set(encoder.encode(value).subarray(0, length), offset);

/** A gzipped tarball holding `entries` under `package/`, as npm publishes one. */
export const tarball = async (entries) => {
  const blocks = [];
  for (const [name, content] of Object.entries(entries)) {
    const body = encoder.encode(content);
    const header = new Uint8Array(512);
    field(header, 0, 100, `package/${name}`);
    field(header, 100, 8, "0000644\0");
    field(header, 124, 12, body.length.toString(8).padStart(11, "0") + "\0");
    field(header, 148, 8, "        ");
    header[156] = 0x30;
    field(header, 257, 6, "ustar\0");
    const sum = header.reduce((total, byte) => total + byte, 0);
    field(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    blocks.push(header, padded);
  }
  blocks.push(new Uint8Array(1024));
  const gzipped = new Blob(blocks)
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gzipped).arrayBuffer());
};

export const integrityOf = async (bytes) =>
  "sha512-" +
  Buffer.from(await crypto.subtle.digest("SHA-512", bytes)).toString("base64");
