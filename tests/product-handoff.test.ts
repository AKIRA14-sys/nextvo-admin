import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_HANDOFF_SCHEMA, validateProductHandoffPayload } from "../src/lib/product-handoff";

const now = Date.parse("2026-11-14T12:00:00.000Z");

function payload(sourceUrl: string, imageUrl = "https://images.example-cdn.com/item.jpg") {
  return {
    schema: PRODUCT_HANDOFF_SCHEMA,
    draft_id: "12345678-1234-1234-1234-123456789012",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
    sources: [{
      url: sourceUrl,
      captured_at: new Date(now).toISOString(),
      images: [imageUrl],
    }],
    product: { images: [imageUrl] },
  };
}

test("handoff accepts public supplier hosts and preserves safe image URLs", () => {
  const result = validateProductHandoffPayload(payload("https://www.jumia.com.ng/product"), now);
  assert.ok(result);
  assert.equal(result.sources[0].supplier_host, "www.jumia.com.ng");
  assert.deepEqual(result.sources[0].images, ["https://images.example-cdn.com/item.jpg"]);
});

test("handoff rejects loopback, private, link-local, and local-name source hosts", () => {
  for (const sourceUrl of [
    "http://127.0.0.1/product",
    "http://127.1/product",
    "http://10.0.0.7/product",
    "http://192.168.1.4/product",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/product",
    "http://localhost/product",
    "http://router.local/product",
  ]) {
    assert.equal(validateProductHandoffPayload(payload(sourceUrl), now), null, sourceUrl);
  }
});

test("handoff drops non-public image destinations even when the source itself is public", () => {
  const result = validateProductHandoffPayload(payload("https://www.jumia.com.ng/product", "https://192.168.1.2/photo.jpg"), now);
  assert.ok(result);
  assert.deepEqual(result.sources[0].images, []);
  assert.deepEqual(result.product.images, []);
});
