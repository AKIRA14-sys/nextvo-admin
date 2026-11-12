import assert from "node:assert/strict";
import test from "node:test";
import { describeImageUploadError, isProductCardImageUrl, prepareProductImages } from "../src/lib/product-image-processing";

type DrawRecord = { width: number; height: number; args: number[] };

function sourceFile(name: string, mime: string, size = 1024): File {
  const bytes = new Uint8Array(size);
  if (mime === "image/jpeg") bytes.set([0xff, 0xd8, 0xff]);
  else if (mime === "image/png") bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (mime === "image/webp") bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  else if (mime === "image/avif") bytes.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
  return new File([bytes], name, { type: mime, lastModified: 1234 });
}

function mockImageBrowser(width: number, height: number, options: { webpUnsupported?: boolean; blobSize?: number } = {}) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const draws: DrawRecord[] = [];
  let bitmapClosed = false;
  let orientation: unknown;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: (...args: number[]) => draws.push({ width: canvas.width, height: canvas.height, args }),
    }),
    toBlob: (callback: (blob: Blob | null) => void, type = "image/png") => {
      const actualType = options.webpUnsupported && type === "image/webp" ? "image/png" : type;
      callback(new Blob([new Uint8Array(options.blobSize ?? 2048)], { type: actualType }));
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas as unknown as HTMLCanvasElement },
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (_file: File, bitmapOptions?: ImageBitmapOptions) => {
      orientation = bitmapOptions?.imageOrientation;
      return { width, height, close: () => { bitmapClosed = true; } };
    },
  });
  return {
    draws,
    get orientation() { return orientation; },
    get bitmapClosed() { return bitmapClosed; },
    restore() {
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
      if (previousBitmap) Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
    },
  };
}

test("image upload errors distinguish an oversized file", () => {
  assert.match(describeImageUploadError({ statusCode: 413, message: "Payload too large" }), /5 MB limit/i);
});

test("image upload errors distinguish unsupported formats", () => {
  assert.match(describeImageUploadError({ statusCode: 400, message: "mime type image/gif is not allowed" }), /JPEG, PNG, WebP or AVIF/i);
});

test("image upload errors distinguish expired authentication", () => {
  assert.match(describeImageUploadError({ statusCode: 401, message: "Invalid JWT" }), /sign-in is missing or expired/i);
});

test("image upload errors distinguish Storage permissions", () => {
  assert.match(describeImageUploadError({ statusCode: 403, message: "new row violates row-level security policy" }), /Storage denied/i);
});

test("image upload errors distinguish browser network failures", () => {
  assert.match(describeImageUploadError(new TypeError("Failed to fetch")), /could not reach Storage/i);
  assert.doesNotMatch(describeImageUploadError(new TypeError("Failed to fetch")), /5 MB limit/i);
});

test("image upload errors expose Supabase server errors", () => {
  assert.match(describeImageUploadError({ statusCode: 503, message: "Storage unavailable" }), /server error 503/i);
});

test("square product images remain byte-for-byte unchanged for the detail gallery and produce a 4:3 card crop", async () => {
  const browser = mockImageBrowser(1200, 1200);
  const source = sourceFile("square-product.png", "image/png", 4096);
  try {
    const prepared = await prepareProductImages(source);
    assert.deepEqual(new Uint8Array(await prepared.original.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
    assert.equal(prepared.original.type, "image/png");
    assert.equal(prepared.card.type, "image/webp");
    const draw = browser.draws.at(-1)!;
    assert.deepEqual([draw.width, draw.height], [1200, 900]);
    assert.deepEqual(draw.args.slice(1, 5), [0, 150, 1200, 900]);
    assert.deepEqual(draw.args.slice(5), [0, 0, 1200, 900]);
    assert.equal(browser.orientation, "from-image");
    assert.ok(browser.bitmapClosed);
  } finally {
    browser.restore();
  }
});

test("portrait photos support a user-adjusted vertical crop position", async () => {
  const browser = mockImageBrowser(800, 1200);
  try {
    const prepared = await prepareProductImages(sourceFile("portrait.jpg", "image/jpeg"), { x: 0.5, y: 0.8 });
    const draw = browser.draws.at(-1)!;
    assert.deepEqual([draw.width, draw.height], [800, 600]);
    assert.deepEqual(draw.args.slice(1, 5), [0, 480, 800, 600]);
    assert.deepEqual(draw.args.slice(5), [0, 0, 800, 600]);
    assert.equal(prepared.card.type, "image/jpeg");
  } finally {
    browser.restore();
  }
});

test("landscape photos crop excess width without distortion and respect a left-shifted focal point", async () => {
  const browser = mockImageBrowser(2400, 1200);
  try {
    const prepared = await prepareProductImages(sourceFile("landscape.webp", "image/webp"), { x: 0.25, y: 0.5 });
    const draw = browser.draws.at(-1)!;
    assert.deepEqual([draw.width, draw.height], [1600, 1200]);
    assert.deepEqual(draw.args.slice(1, 5), [200, 0, 1600, 1200]);
    assert.deepEqual(draw.args.slice(5), [0, 0, 1600, 1200]);
    assert.equal(prepared.card.size <= 5 * 1024 * 1024, true);
  } finally {
    browser.restore();
  }
});

test("large Android-style PNGs keep a full-frame detail rendition and a separate 4:3 card rendition under 5 MB", async () => {
  const browser = mockImageBrowser(4000, 3000, { blobSize: 4096 });
  try {
    const source = sourceFile("phone-photo.png", "image/png", 6 * 1024 * 1024);
    const prepared = await prepareProductImages(source);
    assert.equal(prepared.width, 4000);
    assert.equal(prepared.height, 3000);
    assert.deepEqual([browser.draws[0].width, browser.draws[0].height], [2400, 1800]);
    assert.deepEqual([browser.draws[1].width, browser.draws[1].height], [1600, 1200]);
    assert.equal(prepared.original.type, "image/webp");
    assert.equal(prepared.card.type, "image/webp");
    assert.ok(prepared.original.size <= 5 * 1024 * 1024);
    assert.ok(prepared.card.size <= 5 * 1024 * 1024);
    assert.equal(browser.orientation, "from-image");
    assert.ok(browser.bitmapClosed);
  } finally {
    browser.restore();
  }
});

test("transparent PNG cards fall back to PNG when the browser cannot encode WebP", async () => {
  const browser = mockImageBrowser(800, 600, { webpUnsupported: true });
  try {
    const prepared = await prepareProductImages(sourceFile("transparent.png", "image/png"));
    assert.equal(prepared.original.type, "image/png");
    assert.equal(prepared.card.type, "image/png");
    assert.match(prepared.card.name, /\.png$/);
  } finally {
    browser.restore();
  }
});

test("generated card rendition filenames are distinguishable from legacy product image URLs", () => {
  assert.equal(isProductCardImageUrl("https://example.com/storage/product-123-nextvo-card.webp?cache=1"), true);
  assert.equal(isProductCardImageUrl("https://example.com/storage/product-card.webp"), false);
  assert.equal(isProductCardImageUrl("https://example.com/storage/product-123.jpg"), false);
  assert.equal(isProductCardImageUrl(null), false);
});
