import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORY_SUBCATEGORY_SLUGS,
  DEFAULT_SPECIFICATION_TEMPLATES,
  categoryAwareTemplateCount,
  normalizeTemplateMap,
  specificationTemplateKey,
  templateForSubcategory,
} from "../src/lib/product-specifications";

const allSubcategories = Object.entries(CATEGORY_SUBCATEGORY_SLUGS).flatMap(([category, subcategories]) =>
  subcategories.map((subcategory) => specificationTemplateKey(category, subcategory)),
);

test("default templates cover all 14 departments and 107 category/subcategory entries", () => {
  assert.equal(Object.keys(CATEGORY_SUBCATEGORY_SLUGS).length, 14);
  assert.equal(allSubcategories.length, 107);
  assert.equal(new Set(allSubcategories).size, 107);
  assert.equal(categoryAwareTemplateCount(), 107);
  assert.deepEqual(new Set(Object.keys(DEFAULT_SPECIFICATION_TEMPLATES)), new Set(allSubcategories));
});

test("templates are specific to the selected department and subcategory", () => {
  const phones = templateForSubcategory("phones-mobile-devices", "smartphones");
  const shoes = templateForSubcategory("fashion-clothing", "shoes");
  const televisions = templateForSubcategory("electronics", "tvs-entertainment-devices");
  const refrigerators = templateForSubcategory("home-appliances", "refrigerators-freezers");
  const fashionSportswear = templateForSubcategory("fashion-clothing", "sportswear");
  const activeSportswear = templateForSubcategory("sports-outdoor", "sportswear");

  assert.ok(phones.some((field) => field.key === "screen_size"));
  assert.ok(!shoes.some((field) => field.key === "screen_size"));
  assert.ok(shoes.some((field) => field.key === "upper_material"));
  assert.ok(televisions.some((field) => field.key === "hdmi_ports"));
  assert.ok(!televisions.some((field) => field.key === "garment_type"));
  assert.ok(refrigerators.some((field) => field.key === "cooling_technology"));
  assert.ok(!refrigerators.some((field) => field.key === "processor"));
  assert.ok(!fashionSportswear.some((field) => field.key === "activity"));
  assert.ok(activeSportswear.some((field) => field.key === "activity"));
});

test("template normalization retains defaults and validates per-category overrides", () => {
  const key = specificationTemplateKey("phones-mobile-devices", "smartphones");
  const normalized = normalizeTemplateMap({
    [key]: [
      { key: "custom_field", label: "Custom field", type: "text", customerVisible: true, filterable: false },
      { key: "custom_field", label: "Duplicate", type: "text" },
      { key: "invalid", label: "Invalid field", type: "not_a_field" },
    ],
    "not-a-taxonomy-entry": [{ key: "example", label: "Example", type: "text" }],
  });

  assert.equal(normalized[key].length, 1);
  assert.equal(normalized[key][0]?.label, "Custom field");
  assert.ok(normalized[specificationTemplateKey("fashion-clothing", "shoes")].length > 0);
  assert.deepEqual(templateForSubcategory(null, "smartphones"), []);
});
