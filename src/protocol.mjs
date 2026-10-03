// The request a carrier is handed and the response it sends back. Every
// place that runs a carrier answers a request through these, which is what
// makes a carrier that works in one of them work in the others.
//
// Bodies and headers also have a serialized shape, for a host that runs
// carriers across a boundary that only passes JSON: bodies travel as base64,
// headers as lists of pairs.
//
// Only web APIs are used: Response, FormData and base64 exist in node too.

export const fromBase64 = (base64) => {
  if (!base64) {
    return new Uint8Array();
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const headerValue = (headers, name) => {
  const wanted = name.toLowerCase();
  for (const [key, value] of headers) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return null;
};

/**
 * Only POST and PUT carry a body. A Response is used as the parser so that
 * multipart and urlencoded bodies are decoded by the platform, exactly as they
 * are in a deployed carrier.
 */
export const parseRequestBody = async (method, headers, bytes) => {
  if (method !== "POST" && method !== "PUT") {
    return null;
  }
  const type = (headerValue(headers, "content-type") || "").toLowerCase();
  const as = () =>
    new Response(bytes, { headers: type ? { "content-type": type } : {} });
  if (type.indexOf("application/json") !== -1) {
    return as().json();
  }
  if (
    type.indexOf("application/x-www-form-urlencoded") !== -1 ||
    type.indexOf("multipart/form-data") !== -1 ||
    type.indexOf("application/form") !== -1
  ) {
    const formData = await as().formData();
    const obj = {};
    for (const [key, value] of formData.entries()) {
      obj[key] = value;
    }
    return obj;
  }
  return as().text();
};

/** Maps whatever a carrier returned onto a Response. */
export const toResponse = (result) => {
  if (result instanceof Response) {
    return result;
  }
  switch (typeof result) {
    case "object":
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "string": {
      const isRedirect = result.startsWith("redirect:");
      const status = isRedirect ? 302 : 200;
      const extraHeaders = {};
      let body = result;
      if (isRedirect) {
        body = result.slice(9);
        extraHeaders["Location"] = body;
      }
      return new Response(body, {
        status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...extraHeaders,
        },
      });
    }
    default:
      return new Response("Invalid response from carrier: " + result, {
        status: 500,
      });
  }
};

/** A Response as the app receives it. */
export const serializeResponse = async (response) => {
  const headers = [];
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") {
      continue;
    }
    headers.push([key, value]);
  }
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    headers.push(["set-cookie", cookie]);
  }
  return {
    status: response.status,
    headers,
    bodyBase64: toBase64(new Uint8Array(await response.arrayBuffer())),
  };
};

export const errorResponse = (message, status = 500) =>
  new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
