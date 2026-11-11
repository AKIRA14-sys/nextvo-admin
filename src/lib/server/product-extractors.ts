type JsonRecord = Record<string, unknown>;

type SupplierAdapter = {
  name: string;
  titleMeta: Array<[string, string]>;
  descriptionMeta: Array<[string, string]>;
  imageMeta: Array<[string, string]>;
  priceMeta: Array<[string, string]>;
  currencyMeta: Array<[string, string]>;
  brandMeta: Array<[string, string]>;
  skuMeta: Array<[string, string]>;
};

const commonTitle: Array<[string, string]> = [["property", "og:title"], ["name", "twitter:title"]];
const commonDescription: Array<[string, string]> = [["property", "og:description"], ["name", "description"]];
const commonImages: Array<[string, string]> = [["property", "og:image"], ["name", "twitter:image"]];
const commonPrices: Array<[string, string]> = [["property", "product:price:amount"], ["itemprop", "price"]];
const commonCurrencies: Array<[string, string]> = [["property", "product:price:currency"], ["itemprop", "priceCurrency"]];

const genericAdapter: SupplierAdapter = {
  name: "",
  titleMeta: commonTitle,
  descriptionMeta: commonDescription,
  imageMeta: commonImages,
  priceMeta: commonPrices,
  currencyMeta: commonCurrencies,
  brandMeta: [["property", "product:brand"], ["itemprop", "brand"]],
  skuMeta: [["property", "product:retailer_item_id"], ["itemprop", "sku"]],
};

const adapters: Array<{ matches: (host: string) => boolean; adapter: SupplierAdapter }> = [
  {
    matches: (host) => host === "jumia.com.ng" || host.endsWith(".jumia.com.ng") || host === "jumia.com" || host.endsWith(".jumia.com"),
    adapter: {
      ...genericAdapter,
      name: "Jumia",
      titleMeta: [["property", "og:title"], ["name", "twitter:title"], ["itemprop", "name"]],
      descriptionMeta: [["property", "og:description"], ["name", "description"], ["itemprop", "description"]],
      priceMeta: [["property", "product:price:amount"], ["name", "price"], ["itemprop", "price"]],
      currencyMeta: [["property", "product:price:currency"], ["name", "priceCurrency"], ["itemprop", "priceCurrency"]],
      brandMeta: [["property", "product:brand"], ["itemprop", "brand"]],
      skuMeta: [["property", "product:retailer_item_id"], ["itemprop", "sku"]],
    },
  },
  {
    matches: (host) => host === "1688.com" || host.endsWith(".1688.com"),
    adapter: {
      ...genericAdapter,
      name: "1688",
      titleMeta: [["property", "og:title"], ["itemprop", "name"], ["name", "title"]],
      descriptionMeta: [["property", "og:description"], ["itemprop", "description"], ["name", "description"]],
      priceMeta: [["property", "product:price:amount"], ["property", "og:price:amount"], ["itemprop", "price"], ["name", "price"]],
      currencyMeta: [["property", "product:price:currency"], ["property", "og:price:currency"], ["itemprop", "priceCurrency"], ["name", "currency"]],
      brandMeta: [["property", "product:brand"], ["itemprop", "brand"]],
      skuMeta: [["property", "product:retailer_item_id"], ["itemprop", "sku"], ["name", "productID"]],
    },
  },
  {
    matches: (host) => host === "temu.com" || host.endsWith(".temu.com"),
    adapter: {
      ...genericAdapter,
      name: "Temu",
      titleMeta: [["property", "og:title"], ["name", "twitter:title"], ["itemprop", "name"]],
      descriptionMeta: [["property", "og:description"], ["name", "description"], ["itemprop", "description"]],
      imageMeta: [["property", "og:image"], ["name", "twitter:image"], ["itemprop", "image"]],
      priceMeta: [["property", "product:price:amount"], ["property", "og:price:amount"], ["itemprop", "price"]],
      currencyMeta: [["property", "product:price:currency"], ["property", "og:price:currency"], ["itemprop", "priceCurrency"]],
      brandMeta: [["property", "product:brand"], ["itemprop", "brand"]],
      skuMeta: [["property", "product:retailer_item_id"], ["itemprop", "sku"]],
    },
  },
];

function adapterFor(host: string): SupplierAdapter {
  const normalized = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return adapters.find((entry) => entry.matches(normalized))?.adapter || genericAdapter;
}

export function supplierNameForHost(host: string): string {
  const normalized = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return adapterFor(normalized).name || normalized || "Supplier";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      try { return String.fromCodePoint(Number(digits)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => {
      try { return String.fromCodePoint(parseInt(digits, 16)); } catch { return ""; }
    })
    .trim();
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "");
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).slice(0, limit);
}

function metaValue(html: string, keys: Array<[string, string]>): string {
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  for (const [key, value] of keys) {
    for (const tag of tags) {
      if (attribute(tag, key).toLowerCase() === value.toLowerCase()) {
        const content = attribute(tag, "content") || attribute(tag, "href");
        if (content) return content;
      }
    }
  }
  return "";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function typeNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string").map((item) => item.split(/[\/#]/).filter(Boolean).pop()?.toLowerCase() || "");
}

function findProduct(node: unknown): JsonRecord | null {
  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findProduct(value);
      if (found) return found;
    }
    return null;
  }
  const object = asRecord(node);
  if (!object) return null;
  if (typeNames(object["@type"]).some((type) => type === "product" || type === "productgroup")) return object;
  for (const value of Object.values(object)) {
    const found = findProduct(value);
    if (found) return found;
  }
  return null;
}

function productJson(html: string): JsonRecord | null {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const jsonText = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const found = findProduct(JSON.parse(jsonText));
      if (found) return found;
    } catch {
      // Malformed third-party JSON-LD is ignored; other public metadata remains usable.
    }
  }
  return null;
}

// The 1688 page assigns a JSON argument to window.context through a wrapper
// function. Parse only that argument as JSON; never execute page JavaScript.
function public1688Context(html: string): JsonRecord | null {
  if (html.length > 2_000_000) return null;
  const marker = html.indexOf("})(window.contextPath,");
  if (marker < 0) return null;
  const start = html.indexOf("{", marker + ")(window.contextPath,".length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const source = html.slice(start, i + 1);
        // Some public 1688 payloads contain bare numeric SKU IDs as object keys
        // (for example {5997648167989:0.3}), which are JS object syntax, not JSON.
        // Quote only such keys outside strings, then use JSON.parse; never execute it.
        let normalized = "";
        let quoted = false;
        let slash = false;
        for (let j = 0; j < source.length; j += 1) {
          const char = source[j];
          if (quoted) {
            normalized += char;
            if (slash) slash = false;
            else if (char === "\\") slash = true;
            else if (char === '"') quoted = false;
            continue;
          }
          if (char === '"') { quoted = true; normalized += char; continue; }
          if ((char === "{" || char === ",")) {
            normalized += char;
            let end = j + 1;
            while (/\s/.test(source[end] || "")) end += 1;
            let keyEnd = end;
            while (/\d/.test(source[keyEnd] || "")) keyEnd += 1;
            let colon = keyEnd;
            while (/\s/.test(source[colon] || "")) colon += 1;
            if (keyEnd > end && source[colon] === ":") {
              normalized += source.slice(j + 1, end) + '"' + source.slice(end, keyEnd) + '"' + source.slice(keyEnd, colon + 1);
              j = colon;
            }
            continue;
          }
          normalized += char;
        }
        try { return asRecord(JSON.parse(normalized)); } catch { return null; }
      }
    }
  }
  return null;
}

function nestedRecord(root: JsonRecord | null, ...path: string[]): JsonRecord | null {
  let current: unknown = root;
  for (const key of path) current = asRecord(current)?.[key];
  return asRecord(current);
}

function public1688Product(context: JsonRecord | null): JsonRecord | null {
  return nestedRecord(context, "result", "data");
}

function public1688Images(data: JsonRecord | null): string[] {
  const list = nestedRecord(data, "gallery", "fields")?.offerImgList;
  return Array.isArray(list) ? list.filter((value): value is string => typeof value === "string").slice(0, 16) : [];
}

function public1688Attributes(data: JsonRecord | null): { attributes: Record<string, string>; variants: string[] } {
  const attributes: Record<string, string> = {};
  const variants: string[] = [];
  const root = nestedRecord(data, "Root", "fields", "dataJson");
  const props = nestedRecord(root, "skuModel")?.skuProps;
  if (Array.isArray(props)) for (const item of props) {
    const prop = asRecord(item);
    const name = cleanText(prop?.prop, 60);
    const values = Array.isArray(prop?.value) ? prop.value : [];
    const labels = values.map((value) => cleanText(asRecord(value)?.name, 160)).filter(Boolean);
    if (name && labels.length) {
      attributes[name] = labels.join(", ");
      variants.push(...labels);
    }
  }
  const cpv = nestedRecord(data, "gallery", "fields")?.CpvEnhance;
  for (const group of [asRecord(cpv)?.decisionCpv, asRecord(cpv)?.normalCpv]) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const record = asRecord(item);
      const name = cleanText(record?.name, 60);
      const values = Array.isArray(record?.values) ? record.values : [];
      const value = values.map((entry) => cleanText(entry, 160)).filter(Boolean).join(", ");
      if (name && value && !attributes[name]) attributes[name] = value;
      if (Object.keys(attributes).length >= 30) break;
    }
  }
  return { attributes, variants: Array.from(new Set(variants)).slice(0, 20) };
}

function public1688Price(data: JsonRecord | null): unknown {
  const fields = nestedRecord(data, "mainPrice", "fields");
  const trade = nestedRecord(fields, "finalPriceModel", "tradeWithoutPromotion");
  return trade?.offerPriceDisplay ?? trade?.offerMinPrice ?? nestedRecord(data, "shippingServices", "fields")?.price;
}

function public1688Currency(data: JsonRecord | null): unknown {
  return nestedRecord(data, "mainPrice", "fields")?.currency ?? nestedRecord(data, "mainPrice", "fields")?.priceCurrency;
}

function productImages(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    if (typeof item === "string") return item;
    const image = asRecord(item);
    return typeof image?.url === "string" ? image.url : typeof image?.contentUrl === "string" ? image.contentUrl : "";
  }).filter(Boolean).slice(0, 16);
}

function firstOffer(product: JsonRecord | null): JsonRecord | null {
  const raw = product?.offers;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(asRecord).find((offer) => offer !== null) || null;
}

function structuredPrice(product: JsonRecord | null): unknown {
  const offer = firstOffer(product);
  if (offer?.price !== undefined) return offer.price;
  const specification = asRecord(offer?.priceSpecification);
  return specification?.price;
}

function structuredCurrency(product: JsonRecord | null): unknown {
  const offer = firstOffer(product);
  if (typeof offer?.priceCurrency === "string") return offer.priceCurrency;
  const specification = asRecord(offer?.priceSpecification);
  return specification?.priceCurrency;
}

function propertyAttributes(product: JsonRecord | null): Record<string, string> {
  const result: Record<string, string> = {};
  const knownFields: Array<[string, string]> = [
    ["color", "Color"], ["colour", "Color"], ["material", "Material"], ["size", "Size"],
    ["pattern", "Pattern"], ["weight", "Weight"], ["width", "Width"], ["height", "Height"], ["depth", "Depth"],
    ["mpn", "MPN"], ["productID", "Product ID"],
  ];
  for (const [source, label] of knownFields) {
    const value = cleanText(product?.[source], 160);
    if (value && !result[label]) result[label] = value;
  }
  const properties = Array.isArray(product?.additionalProperty) ? product.additionalProperty : [product?.additionalProperty];
  for (const item of properties) {
    const property = asRecord(item);
    const name = cleanText(property?.name || property?.propertyID, 60);
    const value = cleanText(property?.value, 160);
    if (name && value && !result[name]) result[name] = value;
    if (Object.keys(result).length >= 30) break;
  }
  return result;
}

function variantLabels(product: JsonRecord | null): string[] {
  const variants = Array.isArray(product?.hasVariant) ? product.hasVariant : [product?.hasVariant];
  return variants.map((variant) => {
    const record = asRecord(variant);
    if (!record) return "";
    const name = cleanText(record.name, 160);
    const sku = cleanText(record.sku, 80);
    return name && sku ? `${name} (SKU: ${sku})` : name || (sku ? `SKU: ${sku}` : "");
  }).filter(Boolean).slice(0, 20);
}

export type ExtractedSupplierProduct = {
  title: string;
  description: string;
  images: string[];
  price: string;
  currency: string;
  sku: string;
  brand: string;
  model: string;
  variants: string[];
  attributes: Record<string, string>;
  supplier_name: string;
  supplier_host: string;
  source_url: string;
  final_url: string;
};

export function extractSupplierProduct(html: string, originalUrl: URL, finalUrl: URL): ExtractedSupplierProduct {
  const host = originalUrl.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const adapter = adapterFor(host);
  const structured = productJson(html);
  const is1688 = host === "1688.com" || host.endsWith(".1688.com");
  const contextData = is1688 ? public1688Product(public1688Context(html)) : null;
  const rawBrand = structured?.brand;
  const brand = cleanText(typeof rawBrand === "string" ? rawBrand : asRecord(rawBrand)?.name, 120) || cleanText(metaValue(html, adapter.brandMeta), 120);
  const structuredTitle = cleanText(structured?.name, 240);
  const htmlTitle = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const publicTitle = cleanText(nestedRecord(contextData, "productTitle", "fields")?.title || nestedRecord(contextData, "gallery", "fields")?.subject, 240);
  const title = cleanText(structuredTitle || publicTitle || metaValue(html, adapter.titleMeta) || htmlTitle, 240);
  const description = cleanText(structured?.description || metaValue(html, adapter.descriptionMeta), 2000);
  const structuredImages = productImages(structured?.image);
  const metaImage = metaValue(html, adapter.imageMeta);
  const imageValues = structuredImages.length ? structuredImages : is1688 && public1688Images(contextData).length ? public1688Images(contextData) : metaImage ? [metaImage] : [];
  const images = Array.from(new Set(imageValues.map((value) => {
    try {
      const image = new URL(value, finalUrl);
      return image.protocol === "https:" && !image.username && !image.password ? image.toString() : "";
    } catch {
      return "";
    }
  }).filter(Boolean))).slice(0, 8);
  const rawPrice = structuredPrice(structured) ?? (is1688 ? public1688Price(contextData) : undefined) ?? metaValue(html, adapter.priceMeta);
  const rawCurrency = structuredCurrency(structured) ?? (is1688 ? public1688Currency(contextData) : undefined) ?? metaValue(html, adapter.currencyMeta);
  const priceValue = typeof rawPrice === "string" || typeof rawPrice === "number" ? String(rawPrice).trim() : "";
  const currencyValue = typeof rawCurrency === "string" ? rawCurrency.trim().toUpperCase() : "";
  const rawSku = structured?.sku ?? structured?.productID ?? metaValue(html, adapter.skuMeta);
  const model = cleanText(structured?.model, 120) || cleanText(metaValue(html, [["itemprop", "model"], ["property", "product:model"]]), 120);
  const publicFacts = is1688 ? public1688Attributes(contextData) : { attributes: {}, variants: [] as string[] };
  const attributes = { ...publicFacts.attributes, ...propertyAttributes(structured) };
  if (model && !attributes.Model) attributes.Model = model;
  if (brand && !attributes.Brand) attributes.Brand = brand;
  return {
    title,
    description,
    images,
    price: priceValue && Number.isFinite(Number(priceValue)) && Number(priceValue) >= 0 ? priceValue : "",
    currency: /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : "",
    sku: cleanText(rawSku, 80),
    brand,
    model,
    variants: variantLabels(structured).length ? variantLabels(structured) : publicFacts.variants,
    attributes,
    supplier_name: adapter.name || host,
    supplier_host: originalUrl.hostname,
    source_url: originalUrl.toString(),
    final_url: finalUrl.toString(),
  };
}

export function looksLikeSupplierRestriction(html: string): boolean {
  const title = cleanText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "", 240);
  const visible = html.slice(0, 200_000).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ");
  const restriction = /\b(?:captcha|verify (?:that )?you(?:'re| are) human|access denied|unusual traffic|security check|robot check|bot verification|verify your identity)\b/i;
  return restriction.test(title) || (!productJson(html) && restriction.test(visible));
}

export function hasPublicProductMetadata(html: string, source: URL): boolean {
  if (productJson(html)) return true;
  if (/product/i.test(metaValue(html, [["property", "og:type"]]))) return true;
  const host = source.hostname.toLowerCase();
  if ((host === "1688.com" || host.endsWith(".1688.com")) && /^\/offer\/\d+\.html$/.test(source.pathname)) return true;
  return false;
}
