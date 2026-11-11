import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";
import { classifyNetworkFailure, ImportDiagnosticError } from "./import-diagnostics";

type AddressRecord = { address: string; family: number };
type AddressResolver = (hostname: string) => Promise<AddressRecord[]>;
export type SafeFetchTransport = (input: URL, init: RequestInit & { dispatcher: Agent }) => Promise<Response>;

type FetchPublicResourceOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept: string;
  userAgent: string;
};

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isPublicInternetAddress(raw: string): boolean {
  try {
    return ipaddr.parse(raw).range() === "unicast";
  } catch {
    return false;
  }
}

export function assertAllowedRemoteUrl(url: URL, isRedirect = false): string {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new ImportDiagnosticError(isRedirect ? "redirect_validation_failure" : "unsupported_protocol");
  }
  const host = normalizeHost(url.hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ImportDiagnosticError("blocked_destination");
  }
  if (ipaddr.isValid(host) && !isPublicInternetAddress(host)) {
    throw new ImportDiagnosticError("blocked_destination");
  }
  return host;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: "dns_timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportDiagnosticError(code)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new ImportDiagnosticError("connection_timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function resolvePinnedAddress(host: string, remainingMs: number, resolver?: AddressResolver) {
  const doLookup: AddressResolver = resolver ?? (async (hostname) => lookup(hostname, { all: true, verbatim: true }));
  let records: AddressRecord[];
  try {
    records = await withTimeout(doLookup(host), Math.max(1, Math.min(2500, remainingMs)), "dns_timeout");
  } catch (error) {
    if (error instanceof ImportDiagnosticError) throw error;
    throw classifyNetworkFailure(error);
  }
  if (!records.length || records.some((record) => !isPublicInternetAddress(record.address))) {
    throw new ImportDiagnosticError("blocked_destination");
  }
  return records[0];
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ImportDiagnosticError("response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImportDiagnosticError("unsupported_page_format");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ImportDiagnosticError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function statusFailure(status: number) {
  if (status === 403) return new ImportDiagnosticError("http_403", undefined, status);
  if (status === 404) return new ImportDiagnosticError("http_404", undefined, status);
  if (status === 429) return new ImportDiagnosticError("http_429", undefined, status);
  return new ImportDiagnosticError("http_failure", undefined, status);
}

export async function fetchPublicResource(
  input: URL,
  options: FetchPublicResourceOptions,
  resolver?: AddressResolver,
  fetcher: SafeFetchTransport = undiciFetch as unknown as SafeFetchTransport,
): Promise<{ url: URL; contentType: string; body: Uint8Array }> {
  const deadline = Date.now() + options.timeoutMs;
  let url = new URL(input);
  const maxRedirects = options.maxRedirects ?? 2;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ImportDiagnosticError("connection_timeout");
    const host = assertAllowedRemoteUrl(url, hop > 0);
    const pin = await resolvePinnedAddress(host, remaining, resolver);
    type LookupResult = string | AddressRecord[];
    type LookupCallback = (error: NodeJS.ErrnoException | null, address: LookupResult, family?: number) => void;
    const pinnedLookup = (hostname: string, lookupOptions: { all?: boolean } | undefined, callback: LookupCallback) => {
      if (normalizeHost(hostname) !== host) return callback(new Error("Unexpected DNS lookup host"), "");
      if (lookupOptions?.all) return callback(null, [{ address: pin.address, family: pin.family }]);
      callback(null, pin.address, pin.family);
    };
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup as never } });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Supplier request timed out")), Math.max(1, deadline - Date.now()));
    timeout.unref?.();

    try {
      let response: Response;
      try {
        response = await withAbort(fetcher(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": options.userAgent, Accept: options.accept },
          dispatcher,
        }), controller.signal);
      } catch (error) {
        throw classifyNetworkFailure(error, controller.signal.aborted);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new ImportDiagnosticError("redirect_validation_failure");
        if (hop === maxRedirects) throw new ImportDiagnosticError("redirect_limit");
        try {
          const nextUrl = new URL(location, url);
          if (nextUrl.protocol === "http:") {
            if (nextUrl.port && nextUrl.port !== "80") throw new Error("Unsupported insecure redirect port");
            nextUrl.protocol = "https:";
            nextUrl.port = "";
          }
          url = nextUrl;
        } catch (error) {
          throw new ImportDiagnosticError("redirect_validation_failure", error);
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw statusFailure(response.status);
      }
      const contentType = response.headers.get("content-type") || "";
      const responseMime = contentType.split(";")[0].trim().toLowerCase();
      const acceptedMimes = options.accept.split(",").map((part) => part.trim().split(";")[0].toLowerCase()).filter((part) => part && part !== "*/*");
      if (!acceptedMimes.includes(responseMime)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImportDiagnosticError("unsupported_page_format");
      }
      const body = await readBoundedBody(response, options.maxBytes, controller.signal);
      return { url, contentType, body };
    } catch (error) {
      if (error instanceof ImportDiagnosticError) throw error;
      throw classifyNetworkFailure(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
      if (controller.signal.aborted) await dispatcher.destroy().catch(() => undefined);
      else await dispatcher.close().catch(() => undefined);
    }
  }
  throw new ImportDiagnosticError("redirect_limit");
}
