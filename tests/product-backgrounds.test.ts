import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PRODUCT_BACKGROUND_OPTIONS, readStoredProductBackgrounds } from "../src/lib/product-backgrounds";

test("stored product image background choices are HTTPS-only, unique, bounded to five, and retain the manual selection", () => {
  const source = Array.from({ length: 7 }, (_, index) => ({
    image_url: `https://images.example/background-${index + 1}.jpg`,
    card_image_url: `https://images.example/background-${index + 1}-card.jpg`,
  }));
  const parsed = readStoredProductBackgrounds([
    ...source,
    { image_url: "javascript:alert(1)" },
    source[0],
  ], source[2].image_url);

  assert.equal(parsed.backgrounds.length, MAX_PRODUCT_BACKGROUND_OPTIONS);
  assert.deepEqual(parsed.backgrounds[0], {
    image_url: source[0].image_url,
    card_image_url: source[0].card_image_url,
  });
  assert.equal(parsed.selectedBackgroundUrl, source[2].image_url);
});

test("a selection outside the saved options is ignored", () => {
  const parsed = readStoredProductBackgrounds([
    { image_url: "https://images.example/background.jpg" },
  ], "https://images.example/not-saved.jpg");
  assert.deepEqual(parsed, {
    backgrounds: [{ image_url: "https://images.example/background.jpg" }],
  });
});
