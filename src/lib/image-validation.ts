export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

const signatures: Array<{ mime: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    mime: "image/jpeg",
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: "image/png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    mime: "image/webp",
    matches: (bytes) =>
      bytes.length >= 12 &&
      ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 4) === "WEBP",
  },
  {
    mime: "image/avif",
    matches: (bytes) => {
      if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
      const brands = ascii(bytes, 8, Math.min(24, bytes.length - 8));
      return brands.includes("avif") || brands.includes("avis");
    },
  },
];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function sniffProductImageMime(bytes: Uint8Array): string | null {
  return signatures.find((signature) => signature.matches(bytes))?.mime ?? null;
}

export function validateProductImage(bytes: Uint8Array, claimedMime?: string | null): string {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("Image must be non-empty and no larger than 5 MB.");
  }
  const actualMime = sniffProductImageMime(bytes);
  if (!actualMime) throw new Error("The downloaded file is not a supported JPEG, PNG, WebP or AVIF image.");
  if (claimedMime && claimedMime.split(";")[0].trim().toLowerCase() !== actualMime) {
    throw new Error("The image content does not match its declared file type.");
  }
  return actualMime;
}
