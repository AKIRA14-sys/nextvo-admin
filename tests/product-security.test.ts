import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAuthorizedAdmin } from "../src/lib/supabase/config";
import {
  initialImportedPrices,
  mergeProductAttributes,
  resolveProductStatus,
  validateSupplierCost,
} from "../src/lib/product-domain";
import { sniffProductImageMime, validateProductImage } from "../src/lib/image-validation";
import { assertAllowedRemoteUrl, fetchPublicResource, isPublicInternetAddress } from "../src/lib/server/safe-remote-fetch";

const testBytes = (values: number[]) => new Uint8Array(values);
const fetchOptions = { maxBytes: 1024, timeoutMs: 3000, maxRedirects: 2, accept: "text/html,application/xhtml+xml", userAgent: "NEXTVO-test" };

test("admin authorization trusts only app_metadata role claims", () => {
  assert.equal(isAuthorizedAdmin({ app_metadata: { role: "super_admin" } }), true);
  assert.equal(isAuthorizedAdmin({ app_metadata: { role: "admin" } }), true);
  assert.equal(isAuthorizedAdmin({ app_metadata: { is_admin: true } }), true);
  assert.equal(isAuthorizedAdmin({ app_metadata: { role: "customer" } }), false);
  assert.equal(isAuthorizedAdmin({ user_metadata: { role: "super_admin" } } as never), false);
  assert.equal(isAuthorizedAdmin(null), false);
});

test("Save Draft always drafts; Publish always publishes; Save changes preserves status", () => {
  assert.equal(resolveProductStatus("draft", "published", false), "draft");
  assert.equal(resolveProductStatus("draft", "unavailable", false), "draft");
  assert.equal(resolveProductStatus("published", "draft", true), "published");
  assert.equal(resolveProductStatus("current", "published", false), "published");
  assert.equal(resolveProductStatus("current", "unavailable", false), "unavailable");
  assert.equal(resolveProductStatus("current", "", true), "draft");
});

test("USD, GBP, EUR and NGN source prices never populate NGN selling price", () => {
  for (const currency of ["USD", "GBP", "EUR", "NGN"]) {
    const initial = initialImportedPrices("20.00", currency);
    assert.equal(initial.sellingPriceNgn, "");
    assert.equal(initial.supplierPrice, "20.00");
    assert.equal(initial.supplierCurrency, currency);
    assert.deepEqual(validateSupplierCost(initial.supplierPrice, initial.supplierCurrency), {
      supplierPrice: 20,
      supplierCurrency: currency,
    });
  }
  assert.deepEqual(initialImportedPrices("20", ""), {
    sellingPriceNgn: "",
    supplierPrice: "20",
    supplierCurrency: "",
  });
});

test("invalid supplier cost cannot be persisted without a currency", () => {
  assert.throws(() => validateSupplierCost("20", ""), /three-letter code/);
  assert.throws(() => validateSupplierCost("-2", "USD"), /non-negative/);
  assert.equal(validateSupplierCost("", "").supplierPrice, null);
});

test("editing product specifications preserves unchanged typed attributes", () => {
  const original = { colour: ["Blue", "Black"], dimensions: { width: 5 }, material: "Cotton" };
  const saved = mergeProductAttributes(original, "colour: Blue, Black\ndimensions: {\"width\":5}\nmaterial: Linen", "");
  assert.deepEqual(saved, { colour: ["Blue", "Black"], dimensions: { width: 5 }, material: "Linen" });
});

test("supported image signatures are recognized and mismatched declarations rejected", () => {
  assert.equal(sniffProductImageMime(testBytes([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffProductImageMime(testBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffProductImageMime(testBytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffProductImageMime(testBytes([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])), "image/avif");
  assert.throws(() => validateProductImage(testBytes([0xff, 0xd8, 0xff]), "image/png"), /does not match/);
  assert.equal(sniffProductImageMime(testBytes([1, 2, 3])), null);
});

test("SSRF filters reject private, loopback, link-local and special-use IPs", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1", "fe80::1", "192.0.2.1"]) {
    assert.equal(isPublicInternetAddress(ip), false, ip);
  }
  assert.equal(isPublicInternetAddress("8.8.8.8"), true);
  assert.equal(isPublicInternetAddress("2606:4700:4700::1111"), true);
  for (const url of ["http://example.com", "https://user:secret@example.com", "https://localhost", "https://127.0.0.1", "https://example.com:8443"]) {
    assert.throws(() => assertAllowedRemoteUrl(new URL(url)));
  }
  assert.equal(assertAllowedRemoteUrl(new URL("https://supplier.example/item")), "supplier.example");
});

test("safe fetch rejects a mixed public/private DNS answer before any HTTP request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("ok"); }) as typeof fetch;
  try {
    await assert.rejects(
      fetchPublicResource(new URL("https://supplier.example/product"), fetchOptions, async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
      /exclusively to public/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe fetch revalidates redirect destinations and bounds downloaded bodies", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchPublicResource(new URL("https://supplier.example/product"), fetchOptions, async () => [{ address: "8.8.8.8", family: 4 }]),
      /public HTTPS|Private and special-use/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = (async () => new Response(new Uint8Array(20), { headers: { "Content-Type": "text/html" } })) as typeof fetch;
  try {
    await assert.rejects(
      fetchPublicResource(new URL("https://supplier.example/product"), { ...fetchOptions, maxBytes: 10 }, async () => [{ address: "8.8.8.8", family: 4 }]),
      /exceeded the 10-byte safety limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = (async () => new Response("not actually html", { headers: { "Content-Type": "text/html-malicious" } })) as typeof fetch;
  try {
    await assert.rejects(
      fetchPublicResource(new URL("https://supplier.example/product"), fetchOptions, async () => [{ address: "8.8.8.8", family: 4 }]),
      /unsupported content type/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Admin SQL fixes importer limits and protects image mutations and source metadata", () => {
  const sql = readFileSync(new URL("../supabase/admin-setup.sql", import.meta.url), "utf8");
  assert.match(sql, /p_window_seconds is distinct from 60 or p_max_requests is distinct from 10/i);
  assert.match(sql, /create policy "nextvo admins upload product images"[\s\S]*?for insert to authenticated[\s\S]*?with check \(bucket_id = ''product-images'' and public\.nextvo_is_admin\(\)\)/i);
  assert.match(sql, /create policy "nextvo admins delete product images"[\s\S]*?for delete to authenticated[\s\S]*?using \(bucket_id = ''product-images'' and public\.nextvo_is_admin\(\)\)/i);
  assert.match(sql, /source_image_urls jsonb not null default '\[\]'::jsonb/i);
  assert.match(sql, /source_image_urls=coalesce\(p_private -> 'source_image_urls'/i);
  assert.doesNotMatch(sql, /\bdrop\s+policy\b/i);
});
