export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type DetectionConfidence = "high" | "medium" | "low";
export type ProductImageEstimate = {
  bounds: NormalizedRect | null;
  confidence: DetectionConfidence;
  screenshotLike: boolean;
  reason: string;
  edgeVariation: number;
  foregroundCoverage: number;
};
export type ProductCropOptions = {
  x: number;
  y: number;
  zoom?: number;
  mode?: "crop" | "contain";
};

const MAX_ANALYSIS_EDGE = 192;
const MAX_AUTO_ZOOM = 4;
const SAFETY_MARGIN = 0.18;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function colourDistance(data: Uint8ClampedArray, index: number, background: [number, number, number]): number {
  const red = data[index] - background[0];
  const green = data[index + 1] - background[1];
  const blue = data[index + 2] - background[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

/**
 * A deliberately conservative, local visual-saliency estimate. It finds coherent
 * colour contrast against the image perimeter; it is not semantic object detection.
 */
export function estimateVisualSubject(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): ProductImageEstimate {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || pixels.length < width * height * 4) {
    return {
      bounds: null,
      confidence: "low",
      screenshotLike: false,
      reason: "The image could not be analysed reliably. Adjust the crop manually.",
      edgeVariation: 255,
      foregroundCoverage: 0,
    };
  }

  const borderSamples: [number, number, number][] = [];
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, 1, height - 2, height - 1]) {
      const index = (y * width + x) * 4;
      borderSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
  }
  for (let y = 2; y < height - 2; y += 1) {
    for (const x of [0, 1, width - 2, width - 1]) {
      const index = (y * width + x) * 4;
      borderSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
  }
  const background: [number, number, number] = [
    median(borderSamples.map((colour) => colour[0])),
    median(borderSamples.map((colour) => colour[1])),
    median(borderSamples.map((colour) => colour[2])),
  ];
  const edgeVariation = median(borderSamples.map((colour) => {
    const red = colour[0] - background[0];
    const green = colour[1] - background[1];
    const blue = colour[2] - background[2];
    return Math.sqrt(red * red + green * green + blue * blue);
  }));

  const pixelCount = width * height;
  const threshold = Math.max(22, edgeVariation * 2.3 + 10);
  const mask = new Uint8Array(pixelCount);
  let foregroundPixels = 0;
  let strongHorizontalRows = 0;
  let strongVerticalColumns = 0;
  const rowThreshold = width * 0.52;
  const columnThreshold = height * 0.52;

  for (let y = 0; y < height; y += 1) {
    let horizontalEdges = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (colourDistance(pixels, index, background) > threshold) {
        mask[y * width + x] = 1;
        foregroundPixels += 1;
      }
      if (y > 0) {
        const above = ((y - 1) * width + x) * 4;
        if (Math.abs(luminance(pixels, index) - luminance(pixels, above)) > 48) horizontalEdges += 1;
      }
    }
    if (horizontalEdges >= rowThreshold) strongHorizontalRows += 1;
  }
  for (let x = 0; x < width; x += 1) {
    let verticalEdges = 0;
    for (let y = 1; y < height; y += 1) {
      const index = (y * width + x) * 4;
      const left = (y * width + x - 1) * 4;
      if (Math.abs(luminance(pixels, index) - luminance(pixels, left)) > 48) verticalEdges += 1;
    }
    if (verticalEdges >= columnThreshold) strongVerticalColumns += 1;
  }

  const visited = new Uint8Array(pixelCount);
  const components: { left: number; top: number; right: number; bottom: number; area: number }[] = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let area = 0;
    while (stack.length) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      area += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (area >= Math.max(5, pixelCount * 0.0015)) components.push({ left, top, right, bottom, area });
  }

  components.sort((a, b) => b.area - a.area);
  const largest = components[0];
  const foregroundCoverage = foregroundPixels / pixelCount;
  if (!largest || foregroundCoverage < 0.005) {
    return {
      bounds: null,
      confidence: "low",
      screenshotLike: false,
      reason: "No clear subject contrast was found. Use the full-photo fallback or frame the image manually.",
      edgeVariation,
      foregroundCoverage,
    };
  }

  let left = largest.left;
  let top = largest.top;
  let right = largest.right;
  let bottom = largest.bottom;
  const mainSpan = Math.max(largest.right - largest.left + 1, largest.bottom - largest.top + 1);
  let groupedComponents = 1;
  for (const component of components.slice(1)) {
    if (component.area < largest.area * 0.045) continue;
    const gapX = Math.max(0, Math.max(left - component.right, component.left - right));
    const gapY = Math.max(0, Math.max(top - component.bottom, component.top - bottom));
    if (Math.hypot(gapX, gapY) <= mainSpan * 0.38) {
      left = Math.min(left, component.left);
      top = Math.min(top, component.top);
      right = Math.max(right, component.right);
      bottom = Math.max(bottom, component.bottom);
      groupedComponents += 1;
    }
  }

  const bounds = {
    x: left / width,
    y: top / height,
    width: (right - left + 1) / width,
    height: (bottom - top + 1) / height,
  };
  const boxCoverage = bounds.width * bounds.height;
  const touchesEdge = left <= width * 0.025 || top <= height * 0.025 || right >= width * 0.975 || bottom >= height * 0.975;
  const aspect = width / height;
  const screenshotLike = (aspect > 1.7 || aspect < 0.62)
    && strongHorizontalRows >= 3
    && strongVerticalColumns >= 2
    && components.length >= 8;

  let confidence: DetectionConfidence = "low";
  if (!screenshotLike && edgeVariation <= 18 && !touchesEdge && boxCoverage >= 0.06 && boxCoverage <= 0.82 && foregroundCoverage >= 0.025 && foregroundCoverage <= 0.62 && groupedComponents <= 4) {
    confidence = "high";
  } else if (!screenshotLike && edgeVariation <= 52 && boxCoverage >= 0.025 && boxCoverage <= 0.94 && foregroundCoverage <= 0.86 && groupedComponents <= 8) {
    confidence = "medium";
  }

  const reason = screenshotLike
    ? "This may be a phone or catalogue screenshot. Interface elements can confuse visual estimates; review and crop manually."
    : confidence === "low"
      ? "Background or subject contrast is ambiguous. The full photograph is kept; choose a safe fit or adjust the crop manually."
      : confidence === "medium"
        ? "A possible subject area was found, but the framing needs your confirmation."
        : "A clear high-contrast subject area was estimated. Check the preview before saving.";

  return { bounds, confidence, screenshotLike, reason, edgeVariation, foregroundCoverage };
}

export function suggestProductCrop(
  bounds: NormalizedRect | null,
  confidence: DetectionConfidence,
  imageWidth: number,
  imageHeight: number,
): ProductCropOptions {
  if (!bounds || confidence === "low" || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0.5, y: 0.5, zoom: 1, mode: "contain" };
  }

  const ratio = 4 / 3;
  const maximumWidth = imageWidth / imageHeight > ratio ? imageHeight * ratio : imageWidth;
  const maximumHeight = maximumWidth / ratio;
  const subjectWidth = bounds.width * imageWidth;
  const subjectHeight = bounds.height * imageHeight;
  const requestedWidth = Math.max(subjectWidth * (1 + SAFETY_MARGIN * 2), subjectHeight * ratio * (1 + SAFETY_MARGIN * 2));
  if (requestedWidth > maximumWidth * 0.995) {
    return { x: 0.5, y: 0.5, zoom: 1, mode: "contain" };
  }

  const zoom = clamp(maximumWidth / requestedWidth, 1, MAX_AUTO_ZOOM);
  const cropWidth = maximumWidth / zoom;
  const cropHeight = cropWidth / ratio;
  const centerX = (bounds.x + bounds.width / 2) * imageWidth;
  const centerY = (bounds.y + bounds.height / 2) * imageHeight;
  const x = maximumWidth === cropWidth ? 0.5 : clamp((centerX - cropWidth / 2) / (imageWidth - cropWidth), 0, 1);
  const y = maximumHeight === cropHeight ? 0.5 : clamp((centerY - cropHeight / 2) / (imageHeight - cropHeight), 0, 1);
  return { x, y, zoom, mode: "crop" };
}

export async function analyzeProductImage(file: File): Promise<{ estimate: ProductImageEstimate; width: number; height: number; hasTransparency: boolean }> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("This browser cannot analyse images locally. Use the full-photo fallback or adjust the crop manually.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  try {
    const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(8, Math.round(bitmap.width * scale));
    const height = Math.max(8, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser could not analyse the image. Use the full-photo fallback or adjust the crop manually.");
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let hasTransparency = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) { hasTransparency = true; break; }
    }
    return { estimate: estimateVisualSubject(width, height, pixels), width: bitmap.width, height: bitmap.height, hasTransparency };
  } finally {
    bitmap.close();
  }
}
