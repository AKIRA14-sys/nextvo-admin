import { MAX_PRODUCT_IMAGE_BYTES, sniffProductImageMime } from "./image-validation";

export const MAX_PRODUCT_IMAGE_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_LONG_EDGE = 2400;
const OUTPUT_MIME_BY_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function imageExtension(mime: string): string {
  return OUTPUT_MIME_BY_EXTENSION[mime] || "webp";
}

function withImageExtension(name: string, extension: string): string {
  const stem = name.replace(/\.[^.]*$/, "").trim() || "product-image";
  return `${stem}.${extension}`;
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

async function encodeCanvas(canvas: HTMLCanvasElement, preferredMime: string, isPng: boolean): Promise<Blob> {
  const compressed = await canvasBlob(canvas, preferredMime, preferredMime === "image/png" ? undefined : 0.86);
  if (compressed.type === preferredMime) return compressed;
  if (isPng) {
    // PNG stays lossless if this browser cannot encode transparent WebP.
    return canvasBlob(canvas, "image/png");
  }
  const jpeg = await canvasBlob(canvas, "image/jpeg", 0.86);
  if (jpeg.type !== "image/jpeg") throw new Error("This browser could not encode the image in a supported format.");
  return jpeg;
}

/**
 * Return the original image when it already fits. Larger phone images are
 * downscaled and encoded in the browser; PNGs use WebP (which retains alpha)
 * where supported, otherwise they remain PNG rather than being flattened to JPEG.
 */
export async function prepareProductImage(file: File): Promise<File> {
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

  const normalizedName = withImageExtension(file.name, imageExtension(actualMime));
  if (file.size <= MAX_PRODUCT_IMAGE_BYTES) {
    return new File([file], normalizedName, { type: actualMime, lastModified: file.lastModified });
  }

  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot resize the selected image. Choose an image that is already 5 MB or smaller.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser could not read the selected image for resizing. Choose another image or resize it to 5 MB or smaller.");
  }

  try {
    if (!bitmap.width || !bitmap.height) throw new Error("The selected image has invalid dimensions.");
    const isPng = actualMime === "image/png";
    const preferredMime = isPng || actualMime !== "image/jpeg" ? "image/webp" : "image/jpeg";
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const firstWidth = Math.max(1, Math.round(bitmap.width * scale));
    const firstHeight = Math.max(1, Math.round(bitmap.height * scale));
    const dimensions = [1, 0.85, 0.7, 0.55].map((factor) => ({
      width: Math.max(1, Math.round(firstWidth * factor)),
      height: Math.max(1, Math.round(firstHeight * factor)),
    }));

    for (const { width, height } of dimensions) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the image for upload.");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await encodeCanvas(canvas, preferredMime, isPng);
      if (blob.size <= MAX_PRODUCT_IMAGE_BYTES) {
        const extension = imageExtension(blob.type);
        return new File([blob], withImageExtension(file.name, extension), {
          type: blob.type,
          lastModified: file.lastModified,
        });
      }
    }
    throw new Error("The image is still larger than 5 MB after resizing. Choose a smaller image.");
  } finally {
    bitmap.close();
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
