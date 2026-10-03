import test from "node:test";
import assert from "node:assert/strict";
import {
  fromBase64,
  parseRequestBody,
  serializeResponse,
  toBase64,
  toResponse,
} from "../src/protocol.mjs";

const encode = (text) => new TextEncoder().encode(text);

test("bytes round trip through base64", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.deepEqual(fromBase64(""), new Uint8Array());
});

test("only POST and PUT carry a body", async () => {
  assert.equal(
    await parseRequestBody(
      "GET",
      [["content-type", "application/json"]],
      encode("{}"),
    ),
    null,
  );
  assert.deepEqual(
    await parseRequestBody(
      "PUT",
      [["content-type", "application/json"]],
      encode('{"a":1}'),
    ),
    { a: 1 },
  );
});

test("json, form and text bodies parse the way a deployed carrier sees them", async () => {
  assert.deepEqual(
    await parseRequestBody(
      "POST",
      [["Content-Type", "application/json; charset=utf-8"]],
      encode('{"name":"sam"}'),
    ),
    { name: "sam" },
  );
  assert.deepEqual(
    await parseRequestBody(
      "POST",
      [["content-type", "application/x-www-form-urlencoded"]],
      encode("name=sam&email=s%40example.com"),
    ),
    { name: "sam", email: "s@example.com" },
  );
  assert.equal(
    await parseRequestBody(
      "POST",
      [["content-type", "text/plain"]],
      encode("hello"),
    ),
    "hello",
  );
  assert.equal(await parseRequestBody("POST", [], encode("raw")), "raw");
});

test("an object is sent as json", async () => {
  const response = toResponse({ ok: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { ok: true });
});

test("a string is sent as text, or as a redirect when prefixed", async () => {
  const text = toResponse("done");
  assert.equal(text.status, 200);
  assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await text.text(), "done");
  const redirect = toResponse("redirect:/thanks");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/thanks");
});

test("a response is sent as it is and anything else is a 500", async () => {
  const own = new Response("x", { status: 418 });
  assert.equal(toResponse(own), own);
  assert.equal(toResponse(42).status, 500);
  assert.equal(toResponse(undefined).status, 500);
});

test("a serialized response carries status, headers, cookies and body", async () => {
  const headers = new Headers({ "content-type": "text/plain" });
  headers.append("set-cookie", "a=1");
  headers.append("set-cookie", "b=2");
  const serialized = await serializeResponse(
    new Response("hello", { status: 201, headers }),
  );
  assert.equal(serialized.status, 201);
  assert.deepEqual(serialized.headers, [
    ["content-type", "text/plain"],
    ["set-cookie", "a=1"],
    ["set-cookie", "b=2"],
  ]);
  assert.equal(
    new TextDecoder().decode(fromBase64(serialized.bodyBase64)),
    "hello",
  );
});
