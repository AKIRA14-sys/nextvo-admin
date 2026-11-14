import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicProductAttributes, buildSpecificationAttributes, readSpecificationDraft } from "../src/lib/product-editor-data";
import { templateForSubcategory } from "../src/lib/product-specifications";

test("legacy and structured attributes populate the selected category fields", () => {
  const fields = templateForSubcategory("phones-mobile-devices", "smartphones");
  const draft = readSpecificationDraft({
    Brand: "Example",
    RAM: { value: 8, unit: "GB" },
    specifications: { storage: { value: 256, unit: "GB" }, available_colours: ["Blue", "Black"] },
    key_features: ["Fast"],
  }, fields);

  assert.equal(draft.values.ram, "8");
  assert.equal(draft.units.ram, "GB");
  assert.equal(draft.values.storage, "256");
  assert.equal(draft.units.storage, "GB");
  assert.equal(draft.values.available_colours, "Blue, Black");
  assert.deepEqual(draft.custom, []);
});

test("specification values retain their field types and blank values stay absent", () => {
  const fields = templateForSubcategory("phones-mobile-devices", "smartphones");
  const stored = buildSpecificationAttributes(fields, {
    screen_size: "6.7",
    storage: "128",
    available_colours: "Black, Blue, Black",
  }, { screen_size: "in", storage: "GB" }, []);

  assert.deepEqual(stored["Screen size"], { value: 6.7, unit: "in" });
  assert.deepEqual(stored.Storage, { value: 128, unit: "GB" });
  assert.deepEqual(stored["Available colours"], ["Black", "Blue"]);
  assert.equal(stored["Screen resolution"], undefined);
});

test("custom specifications are validated and private data is not copied to public attributes", () => {
  const custom = [{ id: "new-1", label: "Fit note", value: "Relaxed" }];
  const specs = buildSpecificationAttributes([], {}, {}, custom);
  const publicAttributes = buildPublicProductAttributes("Summary", ["Verified feature", "Verified feature"], specs);

  assert.deepEqual(publicAttributes, {
    short_description: "Summary",
    key_features: ["Verified feature"],
    specifications: { "Fit note": "Relaxed" },
  });
  assert.throws(() => buildSpecificationAttributes([], {}, {}, [{ id: "new-2", label: "Fit note", value: "Other" }, ...custom]), /duplicated/i);
  assert.throws(() => buildSpecificationAttributes(templateForSubcategory("phones-mobile-devices", "smartphones"), { screen_size: "large" }, { screen_size: "in" }, []), /valid measurement/i);
});
