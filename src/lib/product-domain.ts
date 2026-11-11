export type PublicationStatus = "draft" | "published" | "unpublished" | "unavailable";
export type ProductSaveAction = "draft" | "published" | "current";

const publicationStatuses: PublicationStatus[] = ["draft", "published", "unpublished", "unavailable"];

export function resolveProductStatus(
  action: ProductSaveAction,
  currentStatus: string,
  isNew: boolean,
): PublicationStatus {
  if (action === "draft") return "draft";
  if (action === "published") return "published";
  if (publicationStatuses.includes(currentStatus as PublicationStatus)) {
    return currentStatus as PublicationStatus;
  }
  return isNew ? "draft" : "unpublished";
}

export function initialImportedPrices(sourcePrice: string, sourceCurrency: string) {
  const currency = sourceCurrency.trim().toUpperCase();
  const amount = sourcePrice.trim();
  const parsedAmount = amount === "" ? Number.NaN : Number(amount);
  return {
    sellingPriceNgn: "",
    supplierPrice: Number.isFinite(parsedAmount) && parsedAmount >= 0 ? amount : "",
    supplierCurrency: /^[A-Z]{3}$/.test(currency) ? currency : "",
  };
}

export function validateSupplierCost(priceInput: string, currencyInput: string) {
  const price = priceInput.trim();
  const currency = currencyInput.trim().toUpperCase();
  if (!price) return { supplierPrice: null as number | null, supplierCurrency: "" };
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid non-negative supplier cost.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Enter the supplier cost currency as a three-letter code (for example USD, GBP, EUR or NGN).");
  }
  return { supplierPrice: amount, supplierCurrency: currency };
}

export function specificationDisplayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

export function parseSpecifications(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function mergeProductAttributes(
  original: Record<string, unknown>,
  specificationsText: string,
  shortDescription: string,
): Record<string, unknown> {
  const specifications = parseSpecifications(specificationsText);
  const next: Record<string, unknown> = { ...original };

  for (const [key, value] of Object.entries(specifications)) {
    const oldValue = original[key];
    next[key] = oldValue !== undefined && specificationDisplayValue(oldValue) === value ? oldValue : value;
  }
  for (const key of Object.keys(original)) {
    if (key !== "short_description" && !(key in specifications)) delete next[key];
  }

  const short = shortDescription.trim();
  if (short) next.short_description = short;
  else delete next.short_description;
  return next;
}
