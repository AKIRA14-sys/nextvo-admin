import test from "node:test";
import assert from "node:assert/strict";
import { safeCopiedImagePreviewUrl } from "../src/lib/import-image-preview";

const source = "https://images.supplier.example/item.jpg";
const storage = "https://project.supabase.co";

test("external supplier image URLs never become browser preview sources", () => {
  assert.equal(safeCopiedImagePreviewUrl(source, {}, storage), null);
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: source }, storage), null);
});

test("only image copies under configured public product-image storage are previewable", () => {
  const safe = "https://project.supabase.co/storage/v1/object/public/product-images/imported/abc123.jpg";
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: safe }, storage), safe);
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: "https://attacker.example/storage/v1/object/public/product-images/imported/x.jpg" }, storage), null);
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: "https://project.supabase.co/storage/v1/object/public/other-bucket/x.jpg" }, storage), null);
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: "http://project.supabase.co/storage/v1/object/public/product-images/imported/x.jpg" }, storage), null);
});

test("development HTTP previews are limited to the matching local Supabase origin", () => {
  const local = "http://127.0.0.1:54321";
  const localImage = `${local}/storage/v1/object/public/product-images/imported/abc.jpg`;
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: localImage }, local), localImage);
  assert.equal(safeCopiedImagePreviewUrl(source, { [source]: "http://10.0.0.2/storage/v1/object/public/product-images/imported/abc.jpg" }, local), null);
});
