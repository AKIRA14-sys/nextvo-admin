import { isIP } from "node:net";

export type ImportFailureCode =
  | "unsupported_protocol"
  | "blocked_destination"
  | "dns_resolution_failure"
  | "dns_timeout"
  | "tls_certificate_failure"
  | "connection_failure"
  | "connection_timeout"
  | "http_403"
  | "http_404"
  | "http_429"
  | "http_failure"
  | "redirect_validation_failure"
  | "redirect_limit"
  | "response_too_large"
  | "unsupported_page_format"
  | "product_metadata_not_found"
  | "supplier_restriction"
  | "image_validation_failure"
  | "history_persistence_failure"
  | "storage_failure"
  | "unexpected_internal_error";

export class ImportDiagnosticError extends Error {
  readonly code: ImportFailureCode;
  readonly status?: number;
  readonly detail?: unknown;

  constructor(code: ImportFailureCode, detail?: unknown, status?: number) {
    super(code);
    this.name = "ImportDiagnosticError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const publicMessages: Record<ImportFailureCode, string> = {
  unsupported_protocol: "Only public HTTPS supplier pages on the standard HTTPS port are supported.",
  blocked_destination: "The supplier host or redirect resolved to a local, private or special-use network address; the request was blocked.",
  dns_resolution_failure: "The supplier domain could not be resolved.",
  dns_timeout: "Supplier domain lookup timed out.",
  tls_certificate_failure: "The supplier HTTPS certificate could not be verified.",
  connection_failure: "Could not connect to the supplier page.",
  connection_timeout: "The supplier page took too long to respond.",
  http_403: "The supplier returned HTTP 403. It may require sign-in or restrict automated access; no access controls were bypassed.",
  http_404: "The supplier product page was not found (HTTP 404).",
  http_429: "The supplier returned HTTP 429 (rate-limited). Wait before retrying; no access controls were bypassed.",
  http_failure: "The supplier page returned an unsuccessful HTTP response.",
  redirect_validation_failure: "A supplier redirect destination failed public HTTPS validation; the request was blocked.",
  redirect_limit: "The supplier page redirected more times than the safety limit of two.",
  response_too_large: "The supplier response exceeded the importer size limit.",
  unsupported_page_format: "The supplier returned a page format this importer cannot read.",
  product_metadata_not_found: "Public product metadata was not found. The page may require sign-in or rely on restricted page data; enter the product manually instead.",
  supplier_restriction: "The supplier page appears to require verification or sign-in, or to restrict automated retrieval. No access controls were bypassed.",
  image_validation_failure: "The downloaded file is not a supported product image or its content does not match its declared type.",
  history_persistence_failure: "The product result was retrieved, but its attempt could not be saved to import history. Check the Admin SQL setup and permissions.",
  storage_failure: "The image could not be saved to the existing product image storage. Check storage setup and Admin permissions.",
  unexpected_internal_error: "The supplier request could not be completed because of an unexpected internal error.",
};

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    chain.push(current);
    seen.add(current);
    current = current instanceof ImportDiagnosticError
      ? current.detail
      : current instanceof Error
        ? (current as Error & { cause?: unknown }).cause
        : null;
  }
  return chain;
}

function causeCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = "code" in error ? error.code : "";
  return typeof code === "string" ? code.toUpperCase() : "";
}

export function classifyNetworkFailure(error: unknown, timedOut = false): ImportDiagnosticError {
  if (timedOut) return new ImportDiagnosticError("connection_timeout", error);
  const codes = errorChain(error).map(causeCode);
  if (codes.some((code) => code === "UND_ERR_INVALID_ARG" || code === "UND_ERR_INVALID_RETURN_VALUE")) {
    return new ImportDiagnosticError("unexpected_internal_error", error);
  }
  if (codes.some((code) => ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ABORT_ERR", "ERR_ABORTED"].includes(code))) {
    return new ImportDiagnosticError("connection_timeout", error);
  }
  if (codes.some((code) => code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.startsWith("CERT_") || code.startsWith("UNABLE_TO_VERIFY") || ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code))) {
    return new ImportDiagnosticError("tls_certificate_failure", error);
  }
  if (codes.some((code) => ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "ENODATA", "ERR_DNS_RESOLVE_FAILED"].includes(code))) {
    return new ImportDiagnosticError("dns_resolution_failure", error);
  }
  if (codes.some((code) => ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT"].includes(code))) {
    return new ImportDiagnosticError("connection_failure", error);
  }
  return new ImportDiagnosticError("connection_failure", error);
}

export function publicImportDiagnostic(error: unknown, requestId: string): { code: ImportFailureCode; message: string } {
  const diagnostic = error instanceof ImportDiagnosticError
    ? error
    : new ImportDiagnosticError("unexpected_internal_error", error);
  let message = publicMessages[diagnostic.code];
  if (diagnostic.code === "http_failure" && diagnostic.status) message = `The supplier page returned HTTP ${diagnostic.status}.`;
  if (diagnostic.code === "unexpected_internal_error") message += ` Reference: ${requestId}.`;
  return { code: diagnostic.code, message };
}

function safeLogMessage(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[remote URL]")
    .replace(/(authorization|cookie|token|secret|password|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 300);
}

function describeCause(error: unknown) {
  if (!error || typeof error !== "object") return { message: safeLogMessage(String(error)) };
  const name = "name" in error && typeof error.name === "string" ? error.name : "Error";
  const code = causeCode(error) || undefined;
  const message = "message" in error && typeof error.message === "string" ? safeLogMessage(error.message) : "";
  return { name, ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

export function logImportFailure(input: {
  requestId: string;
  operation: "metadata" | "image";
  supplierHost?: string;
  error: unknown;
  elapsedMs: number;
}) {
  const diagnostic = input.error instanceof ImportDiagnosticError
    ? input.error
    : new ImportDiagnosticError("unexpected_internal_error", input.error);
  console.error(JSON.stringify({
    event: "nextvo_import_failure",
    requestId: input.requestId,
    operation: input.operation,
    supplierHost: input.supplierHost,
    code: diagnostic.code,
    elapsedMs: input.elapsedMs,
    causes: errorChain(input.error).map(describeCause),
  }));
}

export function sanitizedSupplierHost(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(hostname)) return "[IP address omitted]";
  return hostname.slice(0, 253);
}
