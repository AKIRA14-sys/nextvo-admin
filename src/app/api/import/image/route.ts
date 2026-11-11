import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateProductImage } from "@/lib/image-validation";
import { fetchPublicResource } from "@/lib/server/safe-remote-fetch";
import { isAuthorizedAdmin } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: z.string().trim().url().max(2048), rightsConfirmed: z.literal(true) });
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...noStore, ...extraHeaders } });
}

async function readBody(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error("Send a JSON image URL and rights confirmation.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) throw new Error("Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Provide an image URL.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4096) { await reader.cancel(); throw new Error("Request body is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Provide valid JSON containing an image URL."); }
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return json({ error: "Supabase is not configured." }, 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAuthorizedAdmin(user)) return json({ error: "Administrator access required." }, 403);

  let raw: unknown;
  try { raw = await readBody(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Confirm image usage rights and provide a valid HTTPS image URL." }, 400);

  const { data: allowed, error: rateLimitError } = await supabase.rpc("nextvo_consume_import_rate_limit", {
    p_window_seconds: 60,
    p_max_requests: 10,
  });
  if (rateLimitError) return json({ error: "Importer throttling is not configured. Review and apply the Admin SQL setup before importing images." }, 503);
  if (allowed !== true) return json({ error: "Image import limit reached. Wait one minute before trying again." }, 429, { "Retry-After": "60" });

  try {
    const fetched = await fetchPublicResource(new URL(parsed.data.url), {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 12_000,
      maxRedirects: 2,
      accept: "image/jpeg,image/png,image/webp,image/avif",
      userAgent: "NEXTVO-Admin-Image-Import/1.0 (+administrator-request)",
    });
    const mime = validateProductImage(fetched.body, fetched.contentType);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as const)[mime as "image/jpeg" | "image/png" | "image/webp" | "image/avif"];
    const digest = createHash("sha256").update(fetched.body).digest("hex");
    const filename = `${digest}.${extension}`;
    const objectPath = `imported/${filename}`;
    const storage = supabase.storage.from("product-images");
    const { error: uploadError } = await storage.upload(objectPath, fetched.body, {
      upsert: false,
      cacheControl: "31536000",
      contentType: mime,
    });

    if (uploadError) {
      const { data: existing, error: listError } = await storage.list("imported", { search: filename, limit: 100 });
      if (listError || !existing?.some((file) => file.name === filename)) {
        throw new Error(`Could not save the image to the product-images bucket: ${uploadError.message}`);
      }
    }

    const { data } = storage.getPublicUrl(objectPath);
    return json({ image_url: data.publicUrl, source_url: parsed.data.url, duplicate: Boolean(uploadError) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not import this image." }, 422);
  }
}
