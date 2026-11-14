import {
  normalizeFeatures,
  normalizeSpecificationValues,
  type SpecificationField,
  type SpecificationValue,
} from "./product-specifications";

export type CustomSpecificationDraft = { id: string; label: string; value: string };
export type SpecificationDraftState = {
  values: Record<string, string>;
  units: Record<string, string>;
  custom: CustomSpecificationDraft[];
};

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(", ");
  if (value && typeof value === "object" && "value" in value && "unit" in value) {
    const measurement = value as { value?: unknown; unit?: unknown };
    return typeof measurement.value === "number" ? String(measurement.value) : "";
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

export function readSpecificationDraft(
  attributes: Record<string, unknown>,
  fields: SpecificationField[],
): SpecificationDraftState {
  const values: Record<string, string> = {};
  const units: Record<string, string> = {};
  const candidates = new Map<string, unknown>();
  for (const [key, value] of Object.entries(attributes)) {
    if (!["short_description", "key_features", "specifications"].includes(key) && normalizedKey(key) !== "brand") candidates.set(key, value);
  }
  const structured = normalizeSpecificationValues(attributes.specifications);
  for (const [key, value] of Object.entries(structured)) candidates.set(key, value);

  for (const field of fields) {
    const fieldKeys = new Set([normalizedKey(field.key), normalizedKey(field.label)]);
    const match = [...candidates.keys()].find((key) => fieldKeys.has(normalizedKey(key)));
    if (!match) continue;
    const raw = candidates.get(match);
    values[field.key] = valueText(raw);
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw && "unit" in raw) {
      const measurement = raw as { unit?: unknown };
      if (typeof measurement.unit === "string") units[field.key] = measurement.unit;
    } else if (field.unit) {
      units[field.key] = field.unit;
    }
    candidates.delete(match);
  }

  const custom = [...candidates.entries()].flatMap(([label, raw], index) => {
    const value = valueText(raw);
    return label.trim() && value ? [{ id: `existing-${index}`, label: label.trim(), value }] : [];
  });
  return { values, units, custom };
}

export function buildSpecificationAttributes(
  fields: SpecificationField[],
  values: Record<string, string>,
  units: Record<string, string>,
  custom: CustomSpecificationDraft[],
): Record<string, SpecificationValue> {
  const result: Record<string, SpecificationValue> = {};
  for (const field of fields) {
    const raw = (values[field.key] || "").trim();
    if (!raw) continue;
    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${field.label} must be a valid number or left blank.`);
      result[field.label] = value;
    } else if (field.type === "boolean") {
      if (raw !== "true" && raw !== "false") throw new Error(`${field.label} must be Yes, No, or left unspecified.`);
      result[field.label] = raw === "true";
    } else if (field.type === "multi_select") {
      const selected = Array.from(new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean)));
      if (selected.length) result[field.label] = selected;
    } else if (field.type === "measurement") {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${field.label} must be a valid measurement or left blank.`);
      const unit = (units[field.key] || field.unit || "").trim();
      if ((field.units?.length || field.unit) && !unit) throw new Error(`Choose a unit for ${field.label}.`);
      if (field.units?.length && !field.allowCustom && !field.units.includes(unit)) throw new Error(`Choose a listed unit for ${field.label}.`);
      result[field.label] = unit ? { value, unit } : { value, unit: "" };
    } else {
      result[field.label] = raw;
    }
  }

  const labels = new Set(Object.keys(result).map(normalizedKey));
  for (const row of custom) {
    const label = row.label.trim();
    const value = row.value.trim();
    if (!label && !value) continue;
    if (!label || !value) throw new Error("Complete both the name and value for each custom specification, or remove the blank row.");
    const key = normalizedKey(label);
    if (labels.has(key)) throw new Error(`The specification “${label}” is duplicated.`);
    labels.add(key);
    result[label] = value;
  }
  return result;
}

export function buildPublicProductAttributes(
  shortDescription: string,
  features: string[],
  specifications: Record<string, SpecificationValue>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const short = shortDescription.trim();
  const cleanFeatures = normalizeFeatures(features);
  if (short) result.short_description = short;
  if (cleanFeatures.length) result.key_features = cleanFeatures;
  if (Object.keys(specifications).length) result.specifications = specifications;
  return result;
}
