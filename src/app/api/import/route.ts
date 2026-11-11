import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fetchPublicResource } from "@/lib/server/safe-remote-fetch";
import { isAuthorizedAdmin } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: z.string().trim().url().max(2048) });
const maxBodyBytes = 4096;
const maxPageBytes = 1_500_000;
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...noStore, ...extraHeaders } });
}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("Send the product URL as application/json.");
  }
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > maxBodyBytes) throw new Error("Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Provide a valid product URL.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      throw new Error("Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Provide valid JSON containing a product URL.");
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    })
    .trim();
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "");
}

function meta(html: string, key: string, value: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) if (attr(tag, key).toLowerCase() === value.toLowerCase()) return attr(tag, "content");
  return "";
}

function cleanText(value: string, limit: number) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findProductJson(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) { const found = findProductJson(item); if (found) return found; }
    return null;
  }
  const object = asRecord(node);
  if (!object) return null;
  const type = object["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return object;
  for (const value of Object.values(object)) { const found = findProductJson(value); if (found) return found; }
  return null;
}

function productJson(html: string): Record<string, unknown> | null {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const jsonText = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try { const found = findProductJson(JSON.parse(jsonText)); if (found) return found; } catch { /* malformed JSON-LD is ignored */ }
  }
  return null;
}

function parsePage(html: string, source: URL) {
  const structured = productJson(html);
  const rawOffer = structured?.offers;
  const offer = Array.isArray(rawOffer) ? asRecord(rawOffer[0]) : asRecord(rawOffer);
  const structuredBrand = structured?.brand;
  const brandRecord = asRecord(structuredBrand);
  const brandName = typeof structuredBrand === "string" ? structuredBrand : typeof brandRecord?.name === "string" ? brandRecord.name : "";
  const title = cleanText(
    (typeof structured?.name === "string" ? structured.name : "") || meta(html, "property", "og:title") || meta(html, "name", "twitter:title") ||
      ((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
    240,
  );
  const description = cleanText(
    (typeof structured?.description === "string" ? structured.description : "") || meta(html, "property", "og:description") || meta(html, "name", "description"),
    2000,
  );
  const rawImages = structured?.image || meta(html, "property", "og:image") || meta(html, "name", "twitter:image") || [];
  const imageList = Array.isArray(rawImages) ? rawImages : [rawImages];
  const imageValues = imageList.map((item) => {
    if (typeof item === "string") return item;
    const image = asRecord(item);
    return typeof image?.url === "string" ? image.url : "";
  }).filter((value): value is string => Boolean(value));
  const images = Array.from(new Set(imageValues.map((value) => {
      try {
        const image = new URL(value, source);
        return image.protocol === "https:" && !image.username && !image.password ? image.toString() : "";
      } catch { return ""; }
    }).filter(Boolean))).slice(0, 8);
  const price = offer?.price ?? meta(html, "property", "product:price:amount") ?? meta(html, "itemprop", "price");
  const currency = offer?.priceCurrency ?? meta(html, "property", "product:price:currency") ?? meta(html, "itemprop", "priceCurrency");
  return {
    title,
    description,
    images,
    price: price !== undefined && price !== null && Number.isFinite(Number(price)) ? String(price) : "",
    currency: typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : "",
    sku: cleanText(typeof structured?.sku === "string" || typeof structured?.sku === "number" ? String(structured.sku) : "", 80),
    brand: cleanText(brandName, 120),
    source_url: source.toString(),
    supplier_host: source.hostname,
  };
}

async function recordImport(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>,
  userId: string,
  url: string,
  host: string,
  status: "retrieved" | "failed",
  title: string,
  errorSummary: string,
) {
  const { data } = await supabase
    .from("nextvo_import_history")
    .insert({ source_url: url, supplier_host: host, status, imported_title: title, error_summary: errorSummary, created_by: userId })
    .select("id")
    .maybeSingle();
  return data?.id || null;
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return json({ error: "Supabase is not configured." }, 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAuthorizedAdmin(user)) return json({ error: "Administrator access required." }, 403);

  let raw: unknown;
  try { raw = await readBoundedJson(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Provide a valid product URL." }, 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Enter a valid public product URL." }, 400);

  const { data: allowed, error: rateLimitError } = await supabase.rpc("nextvo_consume_import_rate_limit", {
    p_window_seconds: 60,
    p_max_requests: 10,
  });
  if (rateLimitError) {
    return json({ error: "Importer throttling is not configured. Review and apply the Admin SQL setup before enabling imports." }, 503);
  }
  if (allowed !== true) return json({ error: "Import limit reached. Wait one minute before trying again." }, 429, { "Retry-After": "60" });

  const originalUrl = new URL(parsed.data.url);
  try {
    const fetched = await fetchPublicResource(originalUrl, {
      maxBytes: maxPageBytes,
      timeoutMs: 12_000,
      maxRedirects: 2,
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.2",
      userAgent: "NEXTVO-Catalog-Assistant/1.0 (+manual product review)",
    });
    const pageMime = fetched.contentType.split(";")[0].trim().toLowerCase();
    if (!["text/html", "application/xhtml+xml", "application/ld+json"].includes(pageMime)) {
      throw new Error("This URL did not return a supported public product page.");
    }
    const product = parsePage(new TextDecoder("utf-8").decode(fetched.body), fetched.url);
    if (!product.title) throw new Error("No public product title metadata was found. Enter the product manually instead.");
    const historyId = await recordImport(supabase, user.id, originalUrl.toString(), fetched.url.hostname, "retrieved", product.title, "");
    return json({ ...product, source_url: originalUrl.toString(), supplier_host: originalUrl.hostname, history_id: historyId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier metadata retrieval failed.";
    const historyId = await recordImport(supabase, user.id, originalUrl.toString(), originalUrl.hostname, "failed", "", message.slice(0, 220));
    return json({ error: message, history_id: historyId }, 422);
  }
}
