import { MAX_PRODUCT_IMAGE_BYTES, sniffProductImageMime } from "./image-validation";

export const MAX_PRODUCT_IMAGE_SOURCE_BYTES = 30 * 1024 * 1024;
export const PRODUCT_CARD_IMAGE_SUFFIX = "-nextvo-card";
const MAX_DETAIL_LONG_EDGE = 2400;
const PRODUCT_CARD_WIDTH = 1600;
const PRODUCT_CARD_HEIGHT = 1200;
const TARGET_CARD_RATIO = 4 / 3;
const OUTPUT_MIME_BY_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
const ENCODE_SCALES = [1, 0.85, 0.7, 0.55, 0.4];
const ENCODE_QUALITIES = [0.9, 0.84, 0.78, 0.72, 0.64];

type CropPosition = { x: number; y: number };
export type PreparedProductImages = { original: File; card: File; width: number; height: number };

function imageExtension(mime: string): string {
  return OUTPUT_MIME_BY_EXTENSION[mime] || "webp";
}

function withImageExtension(name: string, extension: string): string {
  const stem = name.replace(/\.[^.]*$/, "").trim() || "product-image";
  return `${stem}.${extension}`;
}

function clampPosition(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value as number)) : 0.5;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode this image."))),
      mime,
      quality,
    );
  });
}

async function encodeCanvasBelowLimit(
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  baseWidth: number,
  baseHeight: number,
  preferredMime: string,
  preserveAlpha: boolean,
  fileName: string,
  lastModified: number,
  keepFourToThree = false,
): Promise<File> {
  const fallbackMime = preserveAlpha ? "image/png" : "image/jpeg";
  const mimeChoices = preferredMime === fallbackMime ? [preferredMime] : [preferredMime, fallbackMime];
  for (const scale of ENCODE_SCALES) {
    let width = Math.max(1, Math.floor(baseWidth * scale));
    let height = Math.max(1, Math.floor(baseHeight * scale));
    if (keepFourToThree) {
      width = Math.max(4, Math.floor(width / 4) * 4);
      height = (width / 4) * 3;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: preserveAlpha });
    if (!context) throw new Error("This browser could not prepare the image for upload.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    draw(context, width, height);

    for (const mime of mimeChoices) {
      const qualities = mime === "image/png" ? [undefined] : ENCODE_QUALITIES;
      for (const quality of qualities) {
        let blob: Blob;
        try {
          blob = await canvasBlob(canvas, mime, quality);
        } catch {
          continue;
        }
        // Browsers may silently return PNG when the requested encoder is unavailable.
        if (blob.type !== mime || blob.size > MAX_PRODUCT_IMAGE_BYTES) continue;
        const extension = imageExtension(blob.type);
        return new File([blob], withImageExtension(fileName, extension), { type: blob.type, lastModified });
      }
    }
  }
  throw new Error("The image is still larger than 5 MB after resizing. Choose a smaller image.");
}

async function decodeOrientedImage(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot process the selected image. Choose another image or use a modern browser.");
  }
  try {
    // Explicitly apply EXIF orientation before dimension detection and cropping.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older browsers may reject the options dictionary; their default is from-image.
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error("This browser could not read the selected image for resizing. Choose another image or retry in a modern browser.");
    }
  }
}

function preferredOutputMime(sourceMime: string): string {
  return sourceMime === "image/jpeg" ? "image/jpeg" : "image/webp";
}

function renderFullFrame(bitmap: ImageBitmap, file: File, sourceMime: string): Promise<File> {
  const scale = Math.min(1, MAX_DETAIL_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  return encodeCanvasBelowLimit(
    (context, targetWidth, targetHeight) => context.drawImage(bitmap, 0, 0, targetWidth, targetHeight),
    width,
    height,
    preferredOutputMime(sourceMime),
    sourceMime !== "image/jpeg",
    file.name,
    file.lastModified,
  );
}

function renderCardFrame(bitmap: ImageBitmap, file: File, sourceMime: string, crop: CropPosition): Promise<File> {
  const ratio = bitmap.width / bitmap.height;
  const sourceWidth = ratio > TARGET_CARD_RATIO ? bitmap.height * TARGET_CARD_RATIO : bitmap.width;
  const sourceHeight = sourceWidth / TARGET_CARD_RATIO;
  const sourceX = (bitmap.width - sourceWidth) * clampPosition(crop.x);
  const sourceY = (bitmap.height - sourceHeight) * clampPosition(crop.y);
  const scale = Math.min(1, PRODUCT_CARD_WIDTH / sourceWidth, PRODUCT_CARD_HEIGHT / sourceHeight);
  const width = Math.max(4, Math.floor((sourceWidth * scale) / 4) * 4);
  const height = (width / 4) * 3;
  const preferredMime = preferredOutputMime(sourceMime);
  const stem = file.name.replace(/\.[^.]*$/, "").trim() || "product-image";

  return encodeCanvasBelowLimit(
    (context, targetWidth, targetHeight) => context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    ),
    width,
    height,
    preferredMime,
    sourceMime !== "image/jpeg",
    `${stem}${PRODUCT_CARD_IMAGE_SUFFIX}`,
    file.lastModified,
    true,
  );
}

/**
 * Keep an under-limit source file uncropped for the detail gallery. If a phone
 * photo exceeds Storage's per-file limit, make a high-quality full-frame copy;
 * always generate a separate, proportional 4:3 rendition for product cards.
 */
export async function prepareProductImages(file: File, crop: CropPosition = { x: 0.5, y: 0.5 }): Promise<PreparedProductImages> {
  if (!file.size) throw new Error("The selected image is empty.");
  if (file.size > MAX_PRODUCT_IMAGE_SOURCE_BYTES) {
    throw new Error("This image is too large to process on this device (maximum source size: 30 MB).");
  }

  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const actualMime = sniffProductImageMime(header);
  if (!actualMime) throw new Error("Unsupported image format. Choose a valid JPEG, PNG, WebP or AVIF image.");
  if (file.type && file.type !== actualMime && file.type !== "application/octet-stream") {
    throw new Error("The selected file type does not match its image data. Choose a valid JPEG, PNG, WebP or AVIF image.");
  }

  const bitmap = await decodeOrientedImage(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("The selected image has invalid dimensions.");
    const original = file.size <= MAX_PRODUCT_IMAGE_BYTES
      ? new File([file], withImageExtension(file.name, imageExtension(actualMime)), { type: actualMime, lastModified: file.lastModified })
      : await renderFullFrame(bitmap, file, actualMime);
    const card = await renderCardFrame(bitmap, file, actualMime, crop);
    return { original, card, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Generated card URLs use a stable filename marker so legacy rows remain distinguishable without schema changes. */
export function isProductCardImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new RegExp(`${PRODUCT_CARD_IMAGE_SUFFIX}\\.(?:jpe?g|png|webp|avif)$`, "i").test(new URL(value).pathname);
  } catch {
    return false;
  }
}

type ErrorFields = { message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };

function fields(error: unknown): ErrorFields {
  return error && typeof error === "object" ? (error as ErrorFields) : {};
}

/** Translate known Supabase/Fetch failure shapes without mislabelling every error as a file-size issue. */
export function describeImageUploadError(error: unknown): string {
  const value = fields(error);
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  const status = Number(value.statusCode ?? value.status);
  const text = `${code} ${message}`.toLowerCase();

  if (status === 413 || /file (?:size|too large)|payload too large|entity too large|exceeds? the maximum|maximum allowed size/.test(text)) {
    return "The image exceeds the product-images 5 MB limit. Select a smaller file or let the editor resize it before retrying.";
  }
  if (/mime|unsupported (?:image|file)|content[- ]type|not an image|invalid image format/.test(text)) {
    return `The image format is not accepted by Storage. Use JPEG, PNG, WebP or AVIF.${message ? ` Details: ${message.slice(0, 180)}` : ""}`;
  }
  if (status === 401 || /jwt expired|invalid jwt|missing authentication|not authenticated|unauthorized/.test(text)) {
    return "Your administrator sign-in is missing or expired. Sign in again, then retry; the product form and selected images remain available.";
  }
  if (status === 403 || /row-level security|permission denied|not allowed|unauthorized to/.test(text)) {
    return `Storage denied this administrator upload. Your sign-in or existing Storage permission may need attention.${message ? ` Details: ${message.slice(0, 180)}` : ""}`;
  }
  if (status >= 500 && status <= 599) {
    return `Supabase Storage returned server error ${status}.${message ? ` Details: ${message.slice(0, 180)}` : ""} You can retry without re-entering the product.`;
  }
  if (
    value.name === "TypeError" ||
    /failed to fetch|fetch failed|networkerror|network request failed|load failed|offline|timed out/.test(text)
  ) {
    return "The browser could not reach Storage or receive its response (network or browser-policy failure). Check the phone connection, then retry; your product form and selected images are kept.";
  }
  if (Number.isFinite(status) && status >= 400) {
    return `Storage returned HTTP ${status}.${message ? ` Details: ${message.slice(0, 180)}` : ""}`;
  }
  return message ? message.slice(0, 260) : "The image upload could not be completed. Your product form and selected images are kept; retry when ready.";
}
