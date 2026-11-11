export function formatMoney(amount: number | string | null | undefined, currency = "NGN") {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return "—";
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount)); }
  catch { return `${currency} ${Number(amount).toLocaleString("en-NG")}`; }
}
export function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().trim().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function safeError(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message.slice(0, 260);
  return "The request could not be completed.";
}
export function titleCase(value: string) { return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
