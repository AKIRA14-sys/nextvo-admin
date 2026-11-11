import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

type AddressRecord = { address: string; family: number };
type AddressResolver = (hostname: string) => Promise<AddressRecord[]>;

type FetchPublicResourceOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept: string;
  userAgent: string;
};

export function isPublicInternetAddress(raw: string): boolean {
  try {
    return ipaddr.parse(raw).range() === "unicast";
  } catch {
    return false;
  }
}

export function assertAllowedRemoteUrl(url: URL): string {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS URLs on the standard port can be checked.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local and internal network addresses are blocked.");
  }
  if (ipaddr.isValid(host) && !isPublicInternetAddress(host)) {
    throw new Error("Private and special-use IP addresses are blocked.");
  }
  return host;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function resolvePinnedAddress(host: string, remainingMs: number, resolver?: AddressResolver) {
  const doLookup: AddressResolver = resolver ?? (async (hostname) => lookup(hostname, { all: true, verbatim: true }));
  const records = await withTimeout(
    doLookup(host),
    Math.max(1, Math.min(2500, remainingMs)),
    "Supplier DNS lookup timed out.",
  );
  if (!records.length || records.some((record) => !isPublicInternetAddress(record.address))) {
    throw new Error("The supplier host did not resolve exclusively to public internet addresses.");
  }
  return records[0];
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`Supplier response is larger than the ${maxBytes}-byte safety limit.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Supplier response had no readable body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Supplier response exceeded the ${maxBytes}-byte safety limit.`);
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

export async function fetchPublicResource(
  input: URL,
  options: FetchPublicResourceOptions,
  resolver?: AddressResolver,
): Promise<{ url: URL; contentType: string; body: Uint8Array }> {
  const deadline = Date.now() + options.timeoutMs;
  let url = new URL(input);
  const maxRedirects = options.maxRedirects ?? 2;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The supplier request exceeded its overall time limit.");
    const host = assertAllowedRemoteUrl(url);
    const pin = await resolvePinnedAddress(host, remaining, resolver);
    type LookupResult = string | AddressRecord[];
    type LookupCallback = (error: NodeJS.ErrnoException | null, address: LookupResult, family?: number) => void;
    const pinnedLookup = (hostname: string, lookupOptions: { all?: boolean } | undefined, callback: LookupCallback) => {
      if (hostname.toLowerCase().replace(/\.$/, "") !== host) return callback(new Error("Unexpected DNS lookup host"), "");
      if (lookupOptions?.all) return callback(null, [{ address: pin.address, family: pin.family }]);
      callback(null, pin.address, pin.family);
    };
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup as never } });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("The supplier request timed out.")), Math.max(1, remaining));
    timeout.unref?.();

    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": options.userAgent, Accept: options.accept },
        dispatcher,
      } as RequestInit & { dispatcher: Agent });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new Error("Supplier page redirected without a safe destination.");
        if (hop === maxRedirects) throw new Error("Too many redirects. Open the final public page or use manual entry.");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`Supplier page responded with HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type") || "";
      const responseMime = contentType.split(";")[0].trim().toLowerCase();
      const acceptedMimes = options.accept.split(",").map((part) => part.trim().split(";")[0].toLowerCase()).filter((part) => part && part !== "*/*");
      if (!acceptedMimes.includes(responseMime)) {
        throw new Error("Supplier response has an unsupported content type.");
      }
      const body = await readBoundedBody(response, options.maxBytes, controller.signal);
      return { url, contentType, body };
    } finally {
      clearTimeout(timeout);
      await dispatcher.close().catch(() => undefined);
    }
  }
  throw new Error("Could not retrieve the public supplier resource.");
}
