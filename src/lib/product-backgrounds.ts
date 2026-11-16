export const MAX_PRODUCT_BACKGROUND_OPTIONS = 5;

export type ProductBackgroundOption = {
  id: string;
  url: string;
  cardUrl?: string;
  file?: File;
  cardFile?: File;
  uploadPath?: string;
  uploadedUrl?: string;
  cardUploadPath?: string;
  cardUploadedUrl?: string;
};

export type StoredProductBackground = {
  image_url: string;
  card_image_url?: string;
};

export type StoredProductBackgrounds = {
  backgrounds: StoredProductBackground[];
  selectedBackgroundUrl?: string;
};

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function readStoredProductBackgrounds(value: unknown, selectedValue: unknown): StoredProductBackgrounds {
  if (!Array.isArray(value)) return { backgrounds: [] };
  const backgrounds: StoredProductBackground[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const imageUrl = httpsUrl(entry.image_url);
    if (!imageUrl || seen.has(imageUrl)) continue;
    const cardUrl = httpsUrl(entry.card_image_url);
    backgrounds.push({ image_url: imageUrl, ...(cardUrl ? { card_image_url: cardUrl } : {}) });
    seen.add(imageUrl);
    if (backgrounds.length >= MAX_PRODUCT_BACKGROUND_OPTIONS) break;
  }
  const selectedBackgroundUrl = httpsUrl(selectedValue);
  return {
    backgrounds,
    ...(selectedBackgroundUrl && backgrounds.some((item) => item.image_url === selectedBackgroundUrl)
      ? { selectedBackgroundUrl }
      : {}),
  };
}
