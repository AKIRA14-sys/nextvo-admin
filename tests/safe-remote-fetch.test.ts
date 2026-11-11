import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Agent, fetch as undiciFetch } from "undici";
import { fetchPublicResource } from "../src/lib/server/safe-remote-fetch";
import { ImportDiagnosticError } from "../src/lib/server/import-diagnostics";

const options = { maxBytes: 1024, timeoutMs: 1000, accept: "text/html,application/xhtml+xml", userAgent: "NEXTVO-test", maxRedirects: 2 };
const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
const html = (body = "ok", headers: HeadersInit = { "content-type": "text/html" }) => new Response(body, { headers });

async function expectCode(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof ImportDiagnosticError && error.code === code);
}

test("safe fetch follows a valid public HTTPS redirect and returns final URL/body", async () => {
  const seen: string[] = [];
  const fetcher = async (url: URL) => {
    seen.push(url.href);
    return seen.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://cdn.supplier.example/item" } })
      : html("product");
  };
  const result = await fetchPublicResource(new URL("https://supplier.example/item"), options, publicDns, fetcher);
  assert.deepEqual(seen, ["https://supplier.example/item", "https://cdn.supplier.example/item"]);
  assert.equal(result.url.href, "https://cdn.supplier.example/item");
  assert.equal(new TextDecoder().decode(result.body), "product");
});

test("safe fetch upgrades an HTTP redirect to HTTPS without sending plaintext", async () => {
  const seen: string[] = [];
  const fetcher = async (url: URL) => {
    seen.push(url.href);
    return seen.length === 1
      ? new Response(null, { status: 301, headers: { location: "http://cdn.supplier.example/item" } })
      : html("secure product");
  };
  const result = await fetchPublicResource(new URL("https://supplier.example/item"), options, publicDns, fetcher);
  assert.deepEqual(seen, ["https://supplier.example/item", "https://cdn.supplier.example/item"]);
  assert.equal(result.url.href, "https://cdn.supplier.example/item");
});

test("safe fetch rejects HTTP redirects to private destinations and unsupported ports", async () => {
  let requests = 0;
  const redirect = async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  };
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), options, publicDns, redirect), "blocked_destination");
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), options, publicDns,
    async () => new Response(null, { status: 302, headers: { location: "http://cdn.supplier.example:8080/item" } })), "redirect_validation_failure");
  assert.equal(requests, 1);
});

test("safe fetch rejects a redirect to a private DNS destination before requesting it", async () => {
  let requests = 0;
  const resolver = async (host: string) => host === "supplier.example"
    ? [{ address: "8.8.8.8", family: 4 }]
    : [{ address: "10.0.0.4", family: 4 }];
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), options, resolver, async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "https://internal.example/" } });
  }), "blocked_destination");
  assert.equal(requests, 1);
});

test("safe fetch rejects mixed public/private DNS, localhost, and IPv6 loopback literals", async () => {
  let requests = 0;
  const fetcher = async () => { requests += 1; return html(); };
  await expectCode(fetchPublicResource(new URL("https://mixed.example/"), options, async () => [
    { address: "8.8.8.8", family: 4 }, { address: "192.168.1.20", family: 4 },
  ], fetcher), "blocked_destination");
  await expectCode(fetchPublicResource(new URL("https://localhost/"), options, publicDns, fetcher), "blocked_destination");
  await expectCode(fetchPublicResource(new URL("https://[::1]/"), options, publicDns, fetcher), "blocked_destination");
  assert.equal(requests, 0);
});

test("safe fetch rejects unsupported protocols and ports without transport access", async () => {
  let requests = 0;
  const fetcher = async () => { requests += 1; return html(); };
  for (const target of ["http://supplier.example/", "ftp://supplier.example/", "https://supplier.example:8443/"]) {
    await expectCode(fetchPublicResource(new URL(target), options, publicDns, fetcher), "unsupported_protocol");
  }
  assert.equal(requests, 0);
});

test("safe fetch enforces declared and streamed response size limits", async () => {
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), { ...options, maxBytes: 4 }, publicDns,
    async () => new Response("12345", { headers: { "content-type": "text/html", "content-length": "5" } })), "response_too_large");
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), { ...options, maxBytes: 4 }, publicDns,
    async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); controller.close(); } }), { headers: { "content-type": "text/html" } })), "response_too_large");
});

test("safe fetch maps unsupported content type and supplier 403/404/429 responses", async () => {
  await expectCode(fetchPublicResource(new URL("https://supplier.example/"), options, publicDns,
    async () => html("json", { "content-type": "application/json" })), "unsupported_page_format");
  for (const [status, code] of [[403, "http_403"], [404, "http_404"], [429, "http_429"]] as const) {
    await expectCode(fetchPublicResource(new URL("https://supplier.example/"), options, publicDns,
      async () => new Response("restricted", { status, headers: { "content-type": "text/html" } })), code);
  }
});

test("safe fetch distinguishes DNS and connection timeouts", async () => {
  const keepAlive = setInterval(() => undefined, 1000);
  try {
    await expectCode(fetchPublicResource(new URL("https://supplier.example/"), { ...options, timeoutMs: 15 },
      () => new Promise(() => undefined), async () => html()), "dns_timeout");
    await expectCode(fetchPublicResource(new URL("https://supplier.example/"), { ...options, timeoutMs: 25 }, publicDns,
      () => new Promise(() => undefined)), "connection_timeout");
    await expectCode(fetchPublicResource(new URL("https://supplier.example/"), { ...options, timeoutMs: 25 }, publicDns,
      async () => new Response(new ReadableStream<Uint8Array>({ start() { /* body intentionally never emits or closes */ } }), { headers: { "content-type": "text/html" } })), "connection_timeout");
  } finally {
    clearInterval(keepAlive);
  }
});

test("same-module Undici fetch and Agent successfully serve a real localhost HTTP socket", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("localhost socket regression");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const dispatcher = new Agent();
  try {
    const response = await undiciFetch(`http://127.0.0.1:${address.port}/`, { dispatcher });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "localhost socket regression");
  } finally {
    await dispatcher.close();
  }
});
