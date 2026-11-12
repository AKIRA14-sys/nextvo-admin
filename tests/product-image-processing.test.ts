import assert from "node:assert/strict";
import test from "node:test";
import { describeImageUploadError, prepareProductImage } from "../src/lib/product-image-processing";

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

test("large PNG images resize to transparent-capable WebP instead of JPEG", async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: (callback: (blob: Blob | null) => void, type = "image/png") => {
      callback(new Blob([new Uint8Array(2048)], { type }));
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas as unknown as HTMLCanvasElement },
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 4000, height: 3000, close: () => undefined }),
  });

  try {
    const bytes = new Uint8Array(6 * 1024 * 1024);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const source = new File([bytes], "phone-photo.png", { type: "image/png" });
    const prepared = await prepareProductImage(source);
    assert.equal(prepared.type, "image/webp");
    assert.match(prepared.name, /\.webp$/);
    assert.ok(prepared.size <= 5 * 1024 * 1024);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousBitmap) Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
});
