export function safeCopiedImagePreviewUrl(
  sourceUrl: string,
  copiedImageUrls: Record<string, string>,
  storageBaseUrl: string,
): string | null {
  const copied = copiedImageUrls[sourceUrl];
  if (!copied || !storageBaseUrl) return null;
  try {
    const base = new URL(storageBaseUrl);
    const image = new URL(copied);
    const allowedPrefix = `${base.pathname.replace(/\/$/, "")}/storage/v1/object/public/product-images/imported/`;
    if (image.origin !== base.origin || image.username || image.password || !image.pathname.startsWith(allowedPrefix)) return null;
    if (image.protocol !== "https:" && !(image.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname))) return null;
    return image.toString();
  } catch {
    return null;
  }
}
