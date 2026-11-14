import { NextRequest, NextResponse } from "next/server";
import {
  PRODUCT_HANDOFF_MAX_BYTES,
  safeHandoffPayloadBytes,
  validateProductHandoffPayload,
} from "@/lib/product-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, private, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: NextRequest) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > PRODUCT_HANDOFF_MAX_BYTES + 4096) {
    return new Response("The shared draft is too large. Copy it and use the Admin importer instead.", { status: 413, headers });
  }
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) {
    return new Response("Unsupported share format. Use the Android app's text/JSON share option.", { status: 415, headers });
  }

  let raw: string;
  try {
    const form = await request.formData();
    const text = form.get("text");
    if (typeof text !== "string" || !safeHandoffPayloadBytes(text)) {
      return new Response("The shared product draft is missing or exceeds the size limit.", { status: 400, headers });
    }
    raw = text;
  } catch {
    return new Response("The shared draft could not be read. Try the clipboard fallback.", { status: 400, headers });
  }

  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return new Response("The shared text is not a valid product draft.", { status: 400, headers }); }
  const draft = validateProductHandoffPayload(value);
  if (!draft) return new Response("This product draft is invalid or has expired. Return to the Android app and share a fresh draft.", { status: 400, headers });

  const redirectUrl = new URL("/share/receive", request.url);
  redirectUrl.hash = `draft=${encodeURIComponent(JSON.stringify(draft))}`;
  return NextResponse.redirect(redirectUrl, { status: 303, headers });
}
