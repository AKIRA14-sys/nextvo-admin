import test from "node:test";
import assert from "node:assert/strict";
import { extractSupplierProduct } from "../src/lib/server/product-extractors";

const image = "https://cbu01.alicdn.com/img/ibank/product-main.jpg";
const context = {
  result: { data: {
    productPackInfo: { fields: { skuWeight: { 5997648167989: 0.3 } } },
    productTitle: { fields: { title: "D25 Watch4 pro 智能手表" } },
    gallery: { fields: {
      offerImgList: [image],
      CpvEnhance: { normalCpv: [{ name: "品牌", values: ["CYQH"] }, { name: "功能", values: ["心率监测", "蓝牙通话"] }] },
    } },
    mainPrice: { fields: { finalPriceModel: { tradeWithoutPromotion: { offerPriceDisplay: "51.00" } } } },
    Root: { fields: { dataJson: { skuModel: { skuProps: [{ prop: "颜色", value: [{ name: "黑色套装" }, { name: "银色套装" }] }] } } } },
    // Must not leak transport identity, seller details, auth, tracking, or stock.
    clientIP: "198.51.100.42", sellerLoginId: "seller-contact", loginId: "logged-in",
    cookies: "secret-cookie", trackingId: "track-me", canBookedAmount: 1234,
  } },
};
const html = `<title>unrelated page title</title><script>window.context=(function(b,d){var c=d.module||{};var e={};for(var a in c){if(typeof c[a]==="string"){e[a]=c[a]}}Object.assign(e,c[b]||{});Object.assign(d,{module:e});return d})(window.contextPath,${JSON.stringify(context).replace(/"(\d+)":/g, "$1:")});</script>`;

test("extracts public 1688 product data from the context wrapper without inventing currency or stock", () => {
  const url = new URL("https://detail.1688.com/offer/936427403342.html");
  const item = extractSupplierProduct(html, url, url);
  assert.equal(item.title, "D25 Watch4 pro 智能手表");
  assert.deepEqual(item.images, [image]);
  assert.equal(item.price, "51.00");
  assert.equal(item.currency, "");
  assert.equal(item.sku, "");
  assert.equal(item.model, "");
  assert.deepEqual(item.variants, ["黑色套装", "银色套装"]);
  assert.deepEqual(item.attributes, { "颜色": "黑色套装, 银色套装", "品牌": "CYQH", "功能": "心率监测, 蓝牙通话" });
  assert.doesNotMatch(JSON.stringify(item), /198\.51\.100\.42|seller-contact|logged-in|secret-cookie|track-me|1234/);
});

test("context parser does not evaluate executable JavaScript or accept malformed JSON", () => {
  const url = new URL("https://detail.1688.com/offer/1.html");
  const malicious = `<script>window.context=(function(b,d){return d})(window.contextPath,(function(){globalThis.__1688_probe=true;return {result:{data:{productTitle:{fields:{title:"bad"}}}}}})());</script>`;
  const malformed = `<script>window.context=(function(b,d){return d})(window.contextPath,{result:{data:{productTitle:{fields:{title:"bad"}}}}});</script>`;
  assert.equal(extractSupplierProduct(malicious, url, url).title, "");
  assert.equal(extractSupplierProduct(malformed, url, url).title, "");
  assert.equal((globalThis as typeof globalThis & { __1688_probe?: boolean }).__1688_probe, undefined);
});
