import assert from "node:assert/strict";
import test from "node:test";
import { estimateVisualSubject, suggestProductCrop } from "../src/lib/product-image-detection";

function fixture(
  width: number,
  height: number,
  background: [number, number, number] = [245, 245, 245],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = background[0];
    pixels[index * 4 + 1] = background[1];
    pixels[index * 4 + 2] = background[2];
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

function rectangle(
  pixels: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  rectWidth: number,
  rectHeight: number,
  colour: [number, number, number] = [45, 90, 175],
): void {
  for (let y = top; y < top + rectHeight; y += 1) {
    for (let x = left; x < left + rectWidth; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = colour[0];
      pixels[index + 1] = colour[1];
      pixels[index + 2] = colour[2];
      pixels[index + 3] = 255;
    }
  }
}

test("a compact, high-contrast subject on a plain background receives a high visual estimate", () => {
  const width = 160;
  const height = 120;
  const pixels = fixture(width, height);
  rectangle(pixels, width, 55, 30, 50, 60);
  const estimate = estimateVisualSubject(width, height, pixels);
  assert.equal(estimate.confidence, "high");
  assert.ok(estimate.bounds);
  assert.ok(Math.abs(estimate.bounds.x - 55 / width) < 0.02);
  assert.ok(Math.abs(estimate.bounds.y - 30 / height) < 0.02);
  assert.equal(estimate.screenshotLike, false);
});

test("nearby detached parts are grouped with the main subject instead of discarded", () => {
  const width = 160;
  const height = 120;
  const pixels = fixture(width, height);
  rectangle(pixels, width, 54, 32, 32, 55);
  rectangle(pixels, width, 89, 57, 17, 16, [185, 75, 50]);
  const estimate = estimateVisualSubject(width, height, pixels);
  assert.ok(estimate.bounds);
  assert.ok(estimate.bounds.x <= 54 / width);
  assert.ok(estimate.bounds.x + estimate.bounds.width >= 106 / width);
  assert.ok(estimate.bounds.y + estimate.bounds.height >= 73 / height);
});

test("ambiguous gradients do not get described as a confident product detection", () => {
  const width = 96;
  const height = 96;
  const pixels = fixture(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = 60 + Math.round((x / (width - 1)) * 150);
      const index = (y * width + x) * 4;
      pixels[index] = shade;
      pixels[index + 1] = shade;
      pixels[index + 2] = shade;
    }
  }
  const estimate = estimateVisualSubject(width, height, pixels);
  assert.notEqual(estimate.confidence, "high");
});

test("a portrait page with repeated interface-like rules is flagged for manual review", () => {
  const width = 160;
  const height = 300;
  const pixels = fixture(width, height, [250, 250, 250]);
  for (const y of [34, 68, 102, 136, 170, 204, 238]) rectangle(pixels, width, 16, y, 128, 2, [165, 165, 165]);
  rectangle(pixels, width, 10, 18, 3, 264, [160, 160, 160]);
  rectangle(pixels, width, 147, 18, 3, 264, [160, 160, 160]);
  for (const y of [42, 76, 110, 144, 178, 212, 246]) {
    rectangle(pixels, width, 26, y, 12, 10, [55, 115, 205]);
    rectangle(pixels, width, 54, y, 48, 6, [90, 90, 90]);
  }
  const estimate = estimateVisualSubject(width, height, pixels);
  assert.equal(estimate.screenshotLike, true);
  assert.equal(estimate.confidence, "low");
  assert.match(estimate.reason, /screenshot|interface/i);
});

test("no clear foreground signal uses a conservative low-confidence result", () => {
  const estimate = estimateVisualSubject(64, 64, fixture(64, 64, [100, 100, 100]));
  assert.equal(estimate.confidence, "low");
  assert.equal(estimate.bounds, null);
});

test("an off-centre detected product produces a zoomed crop anchored toward the left edge", () => {
  const crop = suggestProductCrop({ x: 0.05, y: 0.3, width: 0.18, height: 0.4 }, "high", 2400, 1200);
  assert.equal(crop.mode, "crop");
  assert.ok((crop.zoom ?? 1) > 1);
  assert.equal(crop.x, 0);
  assert.ok((crop.y ?? 0.5) >= 0 && (crop.y ?? 0.5) <= 1);
});

test("a subject too large to fit with margins uses contain framing, not a crop that cuts it off", () => {
  const crop = suggestProductCrop({ x: 0.08, y: 0.06, width: 0.84, height: 0.88 }, "medium", 1200, 1600);
  assert.deepEqual(crop, { x: 0.5, y: 0.5, zoom: 1, mode: "contain" });
});

test("low-confidence or missing detections use a full-photo contain fallback", () => {
  assert.deepEqual(suggestProductCrop(null, "low", 800, 1400), { x: 0.5, y: 0.5, zoom: 1, mode: "contain" });
});
