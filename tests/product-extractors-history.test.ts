import test from "node:test";
import assert from "node:assert/strict";
import { extractSupplierProduct, looksLikeSupplierRestriction } from "../src/lib/server/product-extractors";
import { mergeImportHistory, type ImportHistoryItem } from "../src/lib/import-history";

function extract(host: string, html: string) {
  const source = new URL(`https://${host}/item/1`);
  return extractSupplierProduct(html, source, source);
}

test("Jumia metadata extraction returns supplier identity and explicit price/currency only", () => {
  const item = extract("www.jumia.com.ng", '<meta property="og:title" content="Phone &amp; Case"><meta property="product:price:amount" content="45000"><meta property="product:price:currency" content="NGN"><meta property="product:brand" content="Acme"><meta property="product:retailer_item_id" content="J-1">');
  assert.equal(item.title, "Phone & Case");
  assert.equal(item.supplier_name, "Jumia");
  assert.equal(item.price, "45000");
  assert.equal(item.currency, "NGN");
  assert.equal(item.brand, "Acme");
  assert.equal(item.sku, "J-1");
});

test("1688 product metadata extracts title and leaves unprovided currency and price empty", () => {
  const item = extract("detail.1688.com", '<meta property="og:title" content="Cotton fabric"><meta name="price" content="">');
  assert.equal(item.title, "Cotton fabric");
  assert.equal(item.supplier_name, "1688");
  assert.equal(item.price, "");
  assert.equal(item.currency, "");
});

test("Temu metadata uses declared product facts and does not fabricate currency", () => {
  const item = extract("www.temu.com", '<meta name="twitter:title" content="Storage box"><meta property="product:price:amount" content="12.99">');
  assert.equal(item.title, "Storage box");
  assert.equal(item.supplier_name, "Temu");
  assert.equal(item.price, "12.99");
  assert.equal(item.currency, "");
});

test("Temu short links use the resolved supplier adapter and preserve original source provenance", () => {
  const source = new URL("https://share.temu.com/short-code");
  const final = new URL("https://www.temu.com/item.html");
  const item = extractSupplierProduct('<meta name="twitter:title" content="Storage box"><meta property="product:price:amount" content="12.99">', source, final);
  assert.equal(item.supplier_name, "Temu");
  assert.equal(item.supplier_host, "www.temu.com");
  assert.equal(item.source_url, source.toString());
  assert.equal(item.final_url, final.toString());
  assert.equal(item.price, "12.99");
});

test("generic JSON-LD extracts model, attributes, variants and structured price", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name: "Trail jacket", model: "TJ-42", sku: "SKU-42", color: "Forest",
    additionalProperty: [{ "@type": "PropertyValue", name: "Waterproof", value: "Yes" }],
    hasVariant: [{ "@type": "Product", name: "Small / Green", sku: "TJ-S-G" }, { "@type": "Product", name: "Large" }],
    offers: { "@type": "Offer", price: "89.95", priceCurrency: "USD" },
  })}</script>`;
  const item = extract("shop.example", html);
  assert.equal(item.title, "Trail jacket");
  assert.equal(item.model, "TJ-42");
  assert.equal(item.price, "89.95");
  assert.equal(item.currency, "USD");
  assert.equal(item.sku, "SKU-42");
  assert.deepEqual(item.variants, ["Small / Green (SKU: TJ-S-G)", "Large"]);
  assert.deepEqual(item.attributes, { Color: "Forest", Waterproof: "Yes", Model: "TJ-42" });
});

test("title-only metadata stays title-only and does not invent a price or currency", () => {
  const item = extract("catalog.example", "<title>Plain product</title>");
  assert.equal(item.title, "Plain product");
  assert.equal(item.price, "");
  assert.equal(item.currency, "");
  assert.equal(item.images.length, 0);
});

test("supplier sign-in, challenge, and captcha pages are flagged without bypass attempts", () => {
  assert.equal(looksLikeSupplierRestriction("<title>Sign in</title><main>please login to continue</main>"), false);
  assert.equal(looksLikeSupplierRestriction("<title>Security check</title><main>Verify that you're human</main>"), true);
  assert.equal(looksLikeSupplierRestriction("<main>CAPTCHA required</main>"), true);
  assert.equal(looksLikeSupplierRestriction('<script type="application/ld+json">{"@type":"Product","name":"Example"}</script><main>security check</main>'), false);
});

const history = (id: string, created_at: string, imported_title: string): ImportHistoryItem => ({
  id, source_url: `https://supplier.example/${id}`, supplier_host: "supplier.example", status: "retrieved",
  imported_title, error_summary: "", created_at,
});

test("history merge deduplicates IDs, applies saved updates, and sorts latest first", () => {
  const current = [history("a", "2026-01-01T10:00:00Z", "old saved title"), history("b", "2026-01-03T10:00:00Z", "second")];
  const incoming = [history("a", "2026-01-02T10:00:00Z", "updated saved title"), history("c", "2026-01-04T10:00:00Z", "latest")];
  const merged = mergeImportHistory(current, incoming);
  assert.deepEqual(merged.map((entry) => entry.id), ["c", "b", "a"]);
  assert.equal(merged.filter((entry) => entry.id === "a").length, 1);
  assert.equal(merged[2].imported_title, "updated saved title");
});
