import ipaddr from "ipaddr.js";

export const PRODUCT_HANDOFF_SCHEMA = "com.nextvo.product-draft.v1";
export const PRODUCT_HANDOFF_TTL_MS = 10 * 60 * 1000;
export const PRODUCT_HANDOFF_MAX_BYTES = 64 * 1024;
export const PRODUCT_HANDOFF_SESSION_KEY = "nextvo:product-handoff:v1";

export type HandoffVariation = { name: string; values: string[] };
export type HandoffSource = {
  url: string;
  supplier_host: string;
  captured_at: string;
  history_id: string | null;
  title: string | null;
  brand: string | null;
  price: string | null;
  currency: string | null;
  original_price: string | null;
  description: string | null;
  images: string[];
  features: string[];
  specifications: Record<string, string>;
  variations: HandoffVariation[];
  sku: string | null;
  availability: string | null;
  category: string | null;
  seller: string | null;
};
export type HandoffProduct = {
  title: string | null;
  brand: string | null;
  description: string | null;
  supplier_reference_price: string | null;
  supplier_reference_currency: string | null;
  sku: string | null;
  images: string[];
  image_sources: Record<string, string>;
  features: string[];
  specifications: Record<string, string>;
  variations: HandoffVariation[];
};
export type ProductHandoff = {
  schema: typeof PRODUCT_HANDOFF_SCHEMA;
  draft_id: string;
  created_at: string;
  expires_at: string;
  sources: HandoffSource[];
  product: HandoffProduct;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\u0000/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function optionalString(source: Record<string, unknown>, key: string, max = 2000): string | null {
  return cleanString(source[key], max);
}

function isPublicHandoffHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".test", ".invalid", ".example"].some((suffix) => host.endsWith(suffix))) return false;
  if (host.includes(":")) {
    try { return ipaddr.isValid(host) && ipaddr.parse(host).range() === "unicast"; } catch { return false; }
  }
  if (ipaddr.isValid(host)) {
    try { return ipaddr.parse(host).range() === "unicast"; } catch { return false; }
  }
  return true;
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.length > 253 || !isPublicHandoffHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname.length > 253 || !isPublicHandoffHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function stringList(value: unknown, maxCount: number, maxLength = 200): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => cleanString(item, maxLength)).filter((item): item is string => Boolean(item)))).slice(0, maxCount);
}

function imageList(value: unknown, maxCount: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(safeImageUrl).filter((item): item is string => Boolean(item)))).slice(0, maxCount);
}

function imageSources(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).slice(0, 16).flatMap(([image, source]) => {
    const safeImage = safeImageUrl(image);
    const safeSource = safeImageUrl(source);
    return safeImage && safeSource ? [[safeImage, safeSource] as const] : [];
  });
  return Object.fromEntries(entries);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).slice(0, 100).flatMap(([key, raw]) => {
    const safeKey = cleanString(key, 100);
    const safeValue = cleanString(raw, 500);
    return safeKey && safeValue ? [[safeKey, safeValue] as const] : [];
  });
  return Object.fromEntries(entries);
}

function variations(value: unknown): HandoffVariation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = cleanString(item.name, 80);
    const values = stringList(item.values, 50, 100);
    return name && values.length ? [{ name, values }] : [];
  });
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function source(value: unknown): HandoffSource | null {
  if (!isRecord(value)) return null;
  const url = safeSourceUrl(value.url);
  const capturedAt = validIsoDate(value.captured_at);
  let host = cleanString(value.supplier_host, 253);
  if (url) {
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* validated above */ }
  }
  if (!url || !capturedAt || !host) return null;
  return {
    url,
    supplier_host: host,
    captured_at: capturedAt,
    history_id: typeof value.history_id === "string" && /^[0-9a-f-]{36}$/i.test(value.history_id) ? value.history_id : null,
    title: optionalString(value, "title", 300),
    brand: optionalString(value, "brand", 150),
    price: optionalString(value, "price", 100),
    currency: optionalString(value, "currency", 12)?.toUpperCase() || null,
    original_price: optionalString(value, "original_price", 100),
    description: optionalString(value, "description", 4000),
    images: imageList(value.images, 8),
    features: stringList(value.features, 40, 300),
    specifications: stringMap(value.specifications),
    variations: variations(value.variations),
    sku: optionalString(value, "sku", 150),
    availability: optionalString(value, "availability", 100),
    category: optionalString(value, "category", 150),
    seller: optionalString(value, "seller", 150),
  };
}

function product(value: unknown, sources: HandoffSource[]): HandoffProduct | null {
  if (!isRecord(value)) return null;
  const unionImages = Array.from(new Set(sources.flatMap((entry) => entry.images)));
  return {
    title: optionalString(value, "title", 300),
    brand: optionalString(value, "brand", 150),
    description: optionalString(value, "description", 4000),
    supplier_reference_price: optionalString(value, "supplier_reference_price", 100),
    supplier_reference_currency: optionalString(value, "supplier_reference_currency", 12)?.toUpperCase() || null,
    sku: optionalString(value, "sku", 150),
    images: imageList(value.images, 16).length ? imageList(value.images, 16) : unionImages.slice(0, 16),
    image_sources: imageSources(value.image_sources),
    features: stringList(value.features, 40, 300),
    specifications: stringMap(value.specifications),
    variations: variations(value.variations),
  };
}

export function validateProductHandoffPayload(value: unknown, now = Date.now()): ProductHandoff | null {
  if (!isRecord(value) || value.schema !== PRODUCT_HANDOFF_SCHEMA) return null;
  const draftId = cleanString(value.draft_id, 80);
  if (!draftId || !/^[0-9a-f-]{16,80}$/i.test(draftId)) return null;
  const createdAt = validIsoDate(value.created_at);
  const expiresAt = validIsoDate(value.expires_at);
  if (!createdAt || !expiresAt) return null;
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  if (createdMs > now + 30_000 || expiresMs <= now || expiresMs <= createdMs || expiresMs > createdMs + PRODUCT_HANDOFF_TTL_MS + 5_000) return null;
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 8) return null;
  const sources = value.sources.map(source);
  if (sources.some((entry) => !entry)) return null;
  const safeSources = sources as HandoffSource[];
  const normalizedProduct = product(value.product, safeSources);
  if (!normalizedProduct) return null;
  return {
    schema: PRODUCT_HANDOFF_SCHEMA,
    draft_id: draftId,
    created_at: createdAt,
    expires_at: expiresAt,
    sources: safeSources,
    product: normalizedProduct,
  };
}

export function createProductHandoff(
  sources: unknown[],
  productValue: unknown,
  now = Date.now(),
): ProductHandoff | null {
  if (!globalThis.crypto?.randomUUID) return null;
  const createdAt = new Date(now).toISOString();
  return validateProductHandoffPayload({
    schema: PRODUCT_HANDOFF_SCHEMA,
    draft_id: globalThis.crypto.randomUUID(),
    created_at: createdAt,
    expires_at: new Date(now + PRODUCT_HANDOFF_TTL_MS).toISOString(),
    sources,
    product: productValue,
  }, now);
}

export function safeHandoffPayloadBytes(value: string): boolean {
  return new TextEncoder().encode(value).byteLength <= PRODUCT_HANDOFF_MAX_BYTES;
}
