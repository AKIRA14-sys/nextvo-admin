import { sniffProductImageMime } from "./image-validation";

export type ProductImageFileFailureStage = "reading" | "validation";

export class ProductImageFileError extends Error {
  readonly stage: ProductImageFileFailureStage;

  constructor(message: string, stage: ProductImageFileFailureStage) {
    super(message);
    this.name = "ProductImageFileError";
    this.stage = stage;
  }
}

const stableFiles = new WeakSet<File>();

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : "";
}

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message.trim()
    : "";
}

function explainReadFailure(errors: unknown[]): string {
  const namedError = errors.find((error) => ["NotReadableError", "NotFoundError", "SecurityError", "NotAllowedError"].includes(errorName(error)));
  const name = errorName(namedError);
  const detail = errorMessage(namedError || errors[errors.length - 1]);
  const explanation = name === "NotFoundError"
    ? "The selected file is no longer available to the browser."
    : name === "SecurityError" || name === "NotAllowedError"
      ? "The browser denied access to the selected file, possibly because its temporary picker permission expired."
      : name === "NotReadableError"
        ? "The browser could not read the selected file; its temporary picker permission may have expired."
        : "The browser could not read the selected file bytes.";
  return `${explanation}${name ? ` (${name})` : ""}${detail ? ` ${detail}` : ""} Select the image again from Gallery or Downloads.`;
}

function readWithFileReader(blob: Blob): Promise<ArrayBuffer> {
  if (typeof FileReader === "undefined") return Promise.reject(new Error("FileReader is not available in this browser."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("FileReader did not return image bytes."));
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader could not read the selected image."));
    reader.onabort = () => reject(new DOMException("Reading the selected image was cancelled.", "NotReadableError"));
    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      reject(error);
    }
  });
}

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  let primaryError: unknown;
  try {
    return await blob.arrayBuffer();
  } catch (error) {
    primaryError = error;
  }

  try {
    return await readWithFileReader(blob);
  } catch (fallbackError) {
    throw new ProductImageFileError(explainReadFailure([primaryError, fallbackError]), "reading");
  }
}

/**
 * Read picker-backed image bytes immediately and retain only a validated in-memory
 * File. The WeakSet avoids copying that same stable File again during analysis/save.
 */
export async function createStableProductImage(file: File): Promise<File> {
  if (stableFiles.has(file)) return file;
  if (!file || typeof file.slice !== "function" || !file.size) {
    throw new ProductImageFileError("The selected image is empty or unavailable. Select it again from Gallery or Downloads.", "reading");
  }

  const bytes = await readBlobBytes(file);
  const mime = sniffProductImageMime(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
  if (!mime) {
    throw new ProductImageFileError("The selected file bytes are not a supported JPEG, PNG, WebP or AVIF image. Select a valid image again.", "validation");
  }
  const declaredMime = file.type.split(";")[0].trim().toLowerCase();
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== mime) {
    throw new ProductImageFileError("The selected file type does not match its image bytes. Select a valid JPEG, PNG, WebP or AVIF image.", "validation");
  }

  try {
    const stableFile = new File([bytes], file.name, { type: mime, lastModified: file.lastModified });
    stableFiles.add(stableFile);
    return stableFile;
  } catch (error) {
    const detail = errorMessage(error);
    throw new ProductImageFileError(
      `The browser read the image but could not make a stable in-memory copy.${detail ? ` ${detail}` : ""} Select the image again or choose a smaller file.`,
      "reading",
    );
  }
}
