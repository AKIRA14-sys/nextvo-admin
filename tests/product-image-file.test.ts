import assert from "node:assert/strict";
import test from "node:test";
import { createStableProductImage, ProductImageFileError } from "../src/lib/product-image-file";

function sourceFile(name: string, mime: string, signature: number[]): File {
  const bytes = new Uint8Array(64);
  bytes.set(signature);
  return new File([bytes], name, { type: mime, lastModified: 1234 });
}

function fakeFileReader(read: (blob: Blob) => Promise<ArrayBuffer>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
    onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      void read(blob).then((result) => {
        this.result = result;
        this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
      }, (error: unknown) => {
        this.error = error instanceof DOMException ? error : new DOMException(String(error), "NotReadableError");
        this.onerror?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
      });
    }
  }
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: MockFileReader });
  return () => {
    if (previous) Object.defineProperty(globalThis, "FileReader", previous);
    else Reflect.deleteProperty(globalThis, "FileReader");
  };
}

test("stable product image copies validate and preserve JPEG, PNG, WebP and AVIF bytes", async () => {
  const files = [
    sourceFile("photo.jpg", "image/jpeg", [0xff, 0xd8, 0xff]),
    sourceFile("photo.png", "image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    sourceFile("photo.webp", "image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    sourceFile("photo.avif", "image/avif", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
  ];

  for (const source of files) {
    const stable = await createStableProductImage(source);
    assert.notStrictEqual(stable, source);
    assert.equal(stable.type, source.type);
    assert.deepEqual(new Uint8Array(await stable.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
    assert.strictEqual(await createStableProductImage(stable), stable, "a stable copy is not read/copied again");
  }
});

test("FileReader fallback recovers when the picker File arrayBuffer read fails", async () => {
  const source = sourceFile("downloaded-from-gallery.jpg", "image/jpeg", [0xff, 0xd8, 0xff]);
  Object.defineProperty(source, "arrayBuffer", {
    configurable: true,
    value: async () => { throw new DOMException("temporary file permission expired", "NotReadableError"); },
  });
  const restore = fakeFileReader((blob) => blob.slice().arrayBuffer());
  try {
    const stable = await createStableProductImage(source);
    assert.equal(stable.name, source.name);
    assert.equal(stable.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await stable.arrayBuffer()), new Uint8Array(await source.slice().arrayBuffer()));
  } finally {
    restore();
  }
});

test("unreadable picker files fail explicitly when both read methods fail", async () => {
  const source = sourceFile("unavailable.jpg", "image/jpeg", [0xff, 0xd8, 0xff]);
  Object.defineProperty(source, "arrayBuffer", {
    configurable: true,
    value: async () => { throw new DOMException("file permission expired", "NotFoundError"); },
  });
  const restore = fakeFileReader(async () => { throw new DOMException("access denied", "SecurityError"); });
  try {
    await assert.rejects(createStableProductImage(source), (error: unknown) => {
      assert.ok(error instanceof ProductImageFileError);
      assert.equal(error.stage, "reading");
      assert.match(error.message, /NotFoundError|SecurityError/);
      assert.match(error.message, /Select the image again/);
      return true;
    });
  } finally {
    restore();
  }
});

test("invalid image bytes do not become a stable file", async () => {
  await assert.rejects(
    createStableProductImage(new File([new Uint8Array([1, 2, 3])], "not-an-image.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof ProductImageFileError && error.stage === "validation",
  );
});
