import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fetchPublicResource } from "@/lib/server/safe-remote-fetch";
import { ImportDiagnosticError, logImportFailure, publicImportDiagnostic, sanitizedSupplierHost } from "@/lib/server/import-diagnostics";
import { extractSupplierProduct, hasPublicProductMetadata, looksLikeSupplierRestriction } from "@/lib/server/product-extractors";
import { isAuthorizedAdmin } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: z.string().trim().url().max(2048) });
const maxBodyBytes = 4096;
const maxPageBytes = 1_500_000;
const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const historyColumns = "id,source_url,supplier_host,status,imported_title,error_summary,created_at";

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

async function recordImport(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>,
  userId: string,
  url: URL,
  status: "retrieved" | "failed",
  title: string,
  errorSummary: string,
) {
  const source = new URL(url);
  source.username = "";
  source.password = "";
  const { data, error } = await supabase
    .from("nextvo_import_history")
    .insert({ source_url: source.toString(), supplier_host: sanitizedSupplierHost(url), status, imported_title: title, error_summary: errorSummary, created_by: userId })
    .select(historyColumns)
    .single();
  if (error || !data) throw new ImportDiagnosticError("history_persistence_failure", error);
  return data;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const responseHeaders = { "X-Request-ID": requestId };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return json({ error: "Supabase is not configured.", request_id: requestId }, 503, responseHeaders);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAuthorizedAdmin(user)) return json({ error: "Administrator access required.", request_id: requestId }, 403, responseHeaders);

  let raw: unknown;
  try { raw = await readBoundedJson(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Provide a valid product URL.", request_id: requestId }, 400, responseHeaders); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Enter a valid public product URL.", request_id: requestId }, 400, responseHeaders);

  const { data: allowed, error: rateLimitError } = await supabase.rpc("nextvo_consume_import_rate_limit", {
    p_window_seconds: 60,
    p_max_requests: 10,
  });
  if (rateLimitError) {
    return json({ error: "Importer throttling is unavailable. Check the existing Admin rate-limit function and permissions.", request_id: requestId }, 503, responseHeaders);
  }
  if (allowed !== true) return json({ error: "Import limit reached. Wait one minute before trying again.", request_id: requestId }, 429, { ...responseHeaders, "Retry-After": "60" });

  const originalUrl = new URL(parsed.data.url);
  let historyUrl = originalUrl;
  let product: ReturnType<typeof extractSupplierProduct> | null = null;
  let retrievalError: unknown;
  try {
    const fetched = await fetchPublicResource(originalUrl, {
      maxBytes: maxPageBytes,
      timeoutMs: 12_000,
      maxRedirects: 2,
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.2",
      userAgent: "NEXTVO-Catalog-Assistant/1.0 (+manual product review)",
    });
    historyUrl = fetched.url;
    const pageMime = fetched.contentType.split(";")[0].trim().toLowerCase();
    let html = new TextDecoder("utf-8").decode(fetched.body);
    if (pageMime === "application/ld+json") html = `<script type="application/ld+json">${html}</script>`;
    if (looksLikeSupplierRestriction(html)) throw new ImportDiagnosticError("supplier_restriction");
    product = extractSupplierProduct(html, originalUrl, fetched.url);
    if (!product.title || (!hasPublicProductMetadata(html, fetched.url) && !product.images.length && !product.price && !product.description && !product.sku && !product.brand)) {
      throw new ImportDiagnosticError("product_metadata_not_found");
    }
  } catch (error) {
    retrievalError = error;
    logImportFailure({ requestId, operation: "metadata", supplierHost: sanitizedSupplierHost(originalUrl), error, elapsedMs: Date.now() - startedAt });
  }

  const diagnostic = retrievalError ? publicImportDiagnostic(retrievalError, requestId) : null;
  let history: Awaited<ReturnType<typeof recordImport>> | null = null;
  let historyWarning = "";
  try {
    history = await recordImport(supabase, user.id, historyUrl, diagnostic ? "failed" : "retrieved", diagnostic ? "" : product?.title || "", diagnostic?.message.slice(0, 220) || "");
  } catch (error) {
    logImportFailure({ requestId, operation: "metadata", supplierHost: sanitizedSupplierHost(originalUrl), error, elapsedMs: Date.now() - startedAt });
    historyWarning = "This attempt could not be saved to import history. Check the Admin history table and permissions; the result is not recorded.";
  }

  if (diagnostic) {
    return json({ error: diagnostic.message, code: diagnostic.code, request_id: requestId, history_id: history?.id || null, history, history_warning: historyWarning || undefined }, 422, responseHeaders);
  }
  return json({ ...product, extraction_warning: product && !product.price && !product.images.length && !product.description ? "Only limited public product metadata was available. Missing prices, images and details must be entered manually; they were not inferred." : undefined, request_id: requestId, history_id: history?.id || null, history, history_warning: historyWarning || undefined }, 200, responseHeaders);
}
