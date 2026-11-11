"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, ImagePlus, Link2, PackagePlus, RefreshCw, Search } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { STOREFRONT_URL, SUPABASE_CONFIGURED } from "@/lib/supabase/config";
import { initialImportedPrices, validateSupplierCost } from "@/lib/product-domain";
import { safeError, slugify } from "@/lib/format";

type Imported = {
  title: string;
  description: string;
  images: string[];
  price: string;
  currency: string;
  sku: string;
  brand: string;
  source_url: string;
  supplier_host: string;
  history_id: string | null;
};
type Category = { id: string; name: string; active: boolean; subcategories: { id: string; name: string; active: boolean }[] };
type DuplicateProduct = { id: string; name: string; slug: string; active: boolean };
type ImportHistoryItem = { id: string; source_url: string; supplier_host: string; status: string; imported_title: string; error_summary: string; created_at: string };

type ImportForm = {
  name: string;
  description: string;
  category_id: string;
  subcategory_id: string;
  selling: string;
  supplier_price: string;
  currency: string;
  stock: string;
  sku: string;
};

const blankForm: ImportForm = {
  name: "", description: "", category_id: "", subcategory_id: "", selling: "",
  supplier_price: "", currency: "", stock: "0", sku: "",
};

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [item, setItem] = useState<Imported | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [storedImageUrls, setStoredImageUrls] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<DuplicateProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [copyingImages, setCopyingImages] = useState(false);
  const [copyProgress, setCopyProgress] = useState({ complete: 0, total: 0 });
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [form, setForm] = useState<ImportForm>(blankForm);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    void getSupabaseBrowserClient().from("categories").select("id,name,active,subcategories(id,name,active)").eq("active", true).order("display_order")
      .then(({ data }: { data: Category[] | null }) => setCategories(data || []));
  }, []);

  function setField<K extends keyof ImportForm>(key: K, value: ImportForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setReviewConfirmed(false);
  }

  async function refreshHistory() {
    if (!SUPABASE_CONFIGURED) return;
    const { data } = await getSupabaseBrowserClient().from("nextvo_import_history")
      .select("id,source_url,supplier_host,status,imported_title,error_summary,created_at")
      .order("created_at", { ascending: false }).limit(10);
    if (data) setHistory(data as ImportHistoryItem[]);
  }

  useEffect(() => { void refreshHistory(); }, []);

  async function retrieve(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setItem(null);
    setDuplicates([]);
    setSelectedImages([]);
    setStoredImageUrls({});
    setImageRightsConfirmed(false);
    setReviewConfirmed(false);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retrieve this product.");
      const imported = data as Imported;
      const prices = initialImportedPrices(imported.price || "", imported.currency || "");
      setItem(imported);
      setSelectedImages(imported.images.slice(0, Math.min(4, imported.images.length)));
      setForm({
        name: imported.title,
        description: imported.description,
        category_id: "",
        subcategory_id: "",
        selling: prices.sellingPriceNgn,
        supplier_price: prices.supplierPrice,
        currency: prices.supplierCurrency,
        stock: "0",
        sku: imported.sku,
      });
      const { data: dupes, error: duplicateError } = await getSupabaseBrowserClient()
        .from("products").select("id,name,slug,active").ilike("name", imported.title).limit(6);
      if (duplicateError) setNotice("Metadata was retrieved, but duplicate lookup failed. Check the catalogue manually before saving.");
      else if (dupes?.length) setDuplicates(dupes as DuplicateProduct[]);
      if (!duplicateError) setNotice("Public page metadata retrieved. The source price is kept as supplier cost; enter a separate NGN selling price before saving.");
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const subcategories = categories.find((category) => category.id === form.category_id)?.subcategories.filter((sub) => sub.active) || [];

  function toggleImage(image: string) {
    setSelectedImages((current) => current.includes(image) ? current.filter((value) => value !== image) : [...current, image]);
    setReviewConfirmed(false);
  }

  async function copyImagesToStorage() {
    if (!item || !selectedImages.length) return;
    if (!imageRightsConfirmed) {
      setError("Confirm that you have permission to reuse each selected image and that the source terms allow copying.");
      return;
    }
    setCopyingImages(true);
    setError("");
    setNotice("");
    const pending = selectedImages.filter((image) => !storedImageUrls[image]);
    setCopyProgress({ complete: 0, total: pending.length });
    let completed = 0;
    const failures: string[] = [];
    for (const sourceUrl of pending) {
      try {
        const response = await fetch("/api/import/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sourceUrl, rightsConfirmed: true }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Image copy failed.");
        setStoredImageUrls((current) => ({ ...current, [sourceUrl]: data.image_url }));
      } catch (caught) {
        failures.push(`${new URL(sourceUrl).hostname}: ${safeError(caught)}`);
      } finally {
        completed += 1;
        setCopyProgress({ complete: completed, total: pending.length });
      }
    }
    setCopyingImages(false);
    setReviewConfirmed(false);
    if (failures.length) setError(`Some images were not copied. They remain external and will not be saved: ${failures.join("; ")}`);
    else setNotice(`Copied ${pending.length} image${pending.length === 1 ? "" : "s"} into the existing Supabase Storage bucket. The original source links remain visible during review.`);
  }

  async function save(state: "draft" | "published", event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setNotice("");
    if (!item) return;
    if (!reviewConfirmed) {
      setError("Confirm that you reviewed the extracted details, the separate NGN selling price and image usage before saving.");
      return;
    }
    if (!form.category_id) {
      setError("Choose a department before saving.");
      return;
    }
    const sellingPrice = Number(form.selling);
    const stock = Number(form.stock);
    if (!form.name.trim() || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setError("Enter a product name and a separately reviewed NEXTVO selling price in NGN.");
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a non-negative whole number; verify it manually.");
      return;
    }
    let supplierCost: ReturnType<typeof validateSupplierCost>;
    try { supplierCost = validateSupplierCost(form.supplier_price, form.currency); }
    catch (caught) { setError(safeError(caught)); return; }
    const unownedImages = selectedImages.filter((image) => !storedImageUrls[image]);
    if (unownedImages.length) {
      setError("Copy permitted images into Supabase Storage or deselect them. External supplier-hosted images are not saved by this importer.");
      return;
    }

    setSaving(true);
    const db = getSupabaseBrowserClient();
    try {
      const photos = selectedImages.map((sourceUrl, sort_order) => ({
        image_url: storedImageUrls[sourceUrl],
        alt_text: form.name,
        sort_order,
      }));
      const attributes = { ...(item.brand ? { Brand: item.brand } : {}), ...(form.sku ? { SKU: form.sku } : {}) };
      const product = {
        slug: slugify(form.name),
        name: form.name.trim(),
        description: form.description.trim(),
        brand: item.brand || null,
        price_ngn: sellingPrice,
        compare_at_price_ngn: null,
        currency_code: "NGN",
        category_id: form.category_id,
        subcategory_id: form.subcategory_id || null,
        image_url: photos[0]?.image_url || null,
        stock_quantity: stock,
        featured: false,
        is_new_arrival: false,
        active: state === "published",
        attributes,
        search_terms: form.name.toLowerCase().split(/\s+/).filter(Boolean),
      };
      const privateData = {
        short_description: "",
        supplier_name: item.supplier_host,
        supplier_product_url: item.source_url,
        supplier_price: supplierCost.supplierPrice,
        supplier_currency: supplierCost.supplierCurrency || "NGN",
        source_image_urls: selectedImages.filter((sourceUrl) => storedImageUrls[sourceUrl]).map((sourceUrl) => ({ image_url: storedImageUrls[sourceUrl], source_url: sourceUrl })),
        status: state,
      };
      const { data, error: saveError } = await db.rpc("nextvo_admin_save_product", {
        p_product: product,
        p_private: privateData,
        p_images: photos,
        p_variants: [],
      });
      if (saveError) throw saveError;
      if (!data) throw new Error("No product ID returned.");

      let historyWarning = "";
      if (item.history_id) {
        const { error: historyError } = await db.from("nextvo_import_history").update({ status: "saved" }).eq("id", item.history_id);
        if (historyError) historyWarning = ` Product saved, but import history could not be updated: ${safeError(historyError)}`;
      }
      setNotice(`${state === "published" ? "Product saved and published" : "Product saved as a draft"} in the shared catalogue.${historyWarning}`);
      setItem(null);
      setUrl("");
      setForm(blankForm);
      setSelectedImages([]);
      setStoredImageUrls({});
      setReviewConfirmed(false);
      void refreshHistory();
    } catch (caught) {
      setError(`Product was not confirmed saved: ${safeError(caught)}`);
    } finally {
      setSaving(false);
    }
  }

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">SUPPLIER METADATA REVIEW</div><h1>Import product</h1><p>Retrieve permitted public metadata, review each field, then save a draft or explicitly publish.</p></div>
      <Link href="/products/new" className="button ghost"><PackagePlus size={15}/>Manual entry</Link>
    </div>
    {notice && <div className="notice success" role="status" style={{ marginBottom: 14 }}><Check size={17}/>{notice}</div>}
    {error && <div className="notice error" role="alert" style={{ marginBottom: 14 }}><AlertTriangle size={16}/>{error}</div>}

    <div className="two-col">
      <div className="stack">
        <section className="card">
          <div className="section-title"><h2>Supplier product URL</h2><Link2 size={17} color="#79a5ff"/></div>
          <p className="helper">We check public HTTPS pages for structured product data and Open Graph metadata. Extraction varies by source. CAPTCHA, sign-in, paywalls, anti-bot controls and other source restrictions are not bypassed; manual entry remains available.</p>
          <form onSubmit={retrieve} className="stack" style={{ marginTop: 15 }}>
            <div className="field"><label htmlFor="supplier-page-url">Public product page</label><input id="supplier-page-url" className="input" required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://supplier.example/product/…" /></div>
            <button className="button primary" disabled={busy || !url}><Search size={15}/>{busy ? "Retrieving public metadata…" : "Retrieve product"}</button>
          </form>
          <div className="notice warn" style={{ marginTop: 15 }}><AlertTriangle size={15}/><span>Extracted values are unverified. Shipping, variants, stock and supplier options are not reliably extracted. Confirm all text, source prices and image rights.</span></div>
        </section>

        {item && <section className="card">
          <div className="section-title"><div><h2>Review product</h2><small>Source: {item.supplier_host}</small></div><span className="status-badge amber">Review required</span></div>
          {duplicates.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }}><AlertTriangle size={16}/><span>Possible duplicate name: {duplicates.map((duplicate) => duplicate.name).join(", ")}. Check the catalogue before continuing.</span></div>}
          {item.images.length > 0 && <div className="field">
            <label>Choose permitted images</label>
            <div className="photo-strip">
              {item.images.map((image, index) => <label className="photo-tile" key={`${image}-${index}`} style={{ cursor: "pointer", outline: selectedImages.includes(image) ? "2px solid #467bff" : "none" }}>
                <img src={storedImageUrls[image] || image} alt="Product image candidate" />
                <input type="checkbox" checked={selectedImages.includes(image)} onChange={() => toggleImage(image)} style={{ position: "absolute", top: 5, left: 5 }} />
                <span title={`Original source: ${image}`} style={{ position: "absolute", bottom: 4, left: 4, background: "#080b12d9", padding: "2px 4px", borderRadius: 5, fontSize: 8 }}>{storedImageUrls[image] ? "STORAGE COPY" : `IMAGE ${index + 1}`}</span>
              </label>)}
            </div>
            <p className="field-note">Original image source links are shown on each thumbnail. Images must be copied into Storage or deselected before this importer can save.</p>
            <label className="checkbox" style={{ marginTop: 10 }}><input type="checkbox" checked={imageRightsConfirmed} onChange={(event) => { setImageRightsConfirmed(event.target.checked); setReviewConfirmed(false); }} /> I have permission to reuse the selected images and the source terms permit copying them into NEXTVO Storage.</label>
            <button type="button" className="button" style={{ marginTop: 10 }} onClick={() => void copyImagesToStorage()} disabled={copyingImages || !selectedImages.length || !imageRightsConfirmed}>
              <ImagePlus size={15}/>{copyingImages ? `Copying images ${copyProgress.complete}/${copyProgress.total}…` : "Copy selected images into Storage"}
            </button>
            {copyingImages && <progress aria-label="Image copy progress" max={Math.max(copyProgress.total, 1)} value={copyProgress.complete} style={{ width: "100%", marginTop: 8 }} />}
          </div>}
          {!item.images.length && <div className="empty-state"><div className="empty-icon"><ImagePlus size={18}/></div><p>No image candidates were found. Add your own permitted photos from the product editor after saving.</p></div>}

          <form className="stack" onSubmit={(event) => save("draft", event)}>
            <div className="form-grid">
              <div className="field full"><label htmlFor="import-name">Product title</label><input id="import-name" className="input" required value={form.name} onChange={(event) => setField("name", event.target.value)} /></div>
              <div className="field full"><label htmlFor="import-description">Description</label><textarea id="import-description" className="textarea" value={form.description} onChange={(event) => setField("description", event.target.value)} /></div>
              <div className="field"><label htmlFor="import-category">Department</label><select id="import-category" className="select" value={form.category_id} onChange={(event) => { setField("category_id", event.target.value); setField("subcategory_id", ""); }}><option value="">Choose department</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></div>
              <div className="field"><label htmlFor="import-subcategory">Subcategory</label><select id="import-subcategory" className="select" value={form.subcategory_id} onChange={(event) => setField("subcategory_id", event.target.value)}><option value="">None</option>{subcategories.map((subcategory) => <option value={subcategory.id} key={subcategory.id}>{subcategory.name}</option>)}</select></div>
              <div className="field"><label htmlFor="import-selling-price">NEXTVO selling price (NGN) *</label><input id="import-selling-price" className="input" type="number" min="0" step="0.01" required value={form.selling} onChange={(event) => setField("selling", event.target.value)} /><span className="field-note">Blank by default; manually enter and confirm the public NGN price. No foreign amount is converted.</span></div>
              <div className="field"><label htmlFor="import-supplier-cost">Supplier cost (private)</label><input id="import-supplier-cost" className="input" type="number" min="0" step="0.01" value={form.supplier_price} onChange={(event) => setField("supplier_price", event.target.value)} /></div>
              <div className="field"><label htmlFor="import-supplier-currency">Supplier cost currency</label><input id="import-supplier-currency" className="input" value={form.currency} onChange={(event) => setField("currency", event.target.value.toUpperCase())} placeholder="USD / GBP / EUR / NGN" maxLength={3} /><span className="field-note">Original 3-letter currency code; no exchange rate or conversion is applied.</span></div>
              <div className="field"><label htmlFor="import-stock">Stock (verify manually)</label><input id="import-stock" className="input" type="number" min="0" step="1" value={form.stock} onChange={(event) => setField("stock", event.target.value)} /><span className="field-note">Source inventory is not treated as verified stock.</span></div>
              <div className="field"><label htmlFor="import-sku">SKU (if available)</label><input id="import-sku" className="input" value={form.sku} onChange={(event) => setField("sku", event.target.value)} /></div>
              <div className="field"><label>Original source price</label><div className="input" style={{ display: "flex", alignItems: "center" }}>{item.price ? `${item.currency || "Currency not identified"} ${item.price}` : "Not found"}</div><span className="field-note">Kept separate from NEXTVO&apos;s NGN selling price.</span></div>
            </div>
            <label className="checkbox"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /> I reviewed the extracted fields, entered the intended NGN selling price, and confirmed that product copy and selected images may be used.</label>
            <div className="actions"><button type="submit" className="button" disabled={saving || copyingImages || !SUPABASE_CONFIGURED || !reviewConfirmed}>{saving ? "Saving…" : "Save draft"}</button><button type="button" className="button primary" disabled={saving || copyingImages || !SUPABASE_CONFIGURED || !reviewConfirmed} onClick={() => void save("published")}>{saving ? "Saving…" : "Publish reviewed product"}</button></div>
          </form>
        </section>}

        <section className="card">
          <div className="section-title"><h2>Recent import attempts</h2><button className="button small ghost" onClick={() => void refreshHistory()}><RefreshCw size={13}/>Refresh</button></div>
          {history.length ? history.map((entry) => <div className="stat-line" key={entry.id}><span><b>{entry.imported_title || entry.supplier_host}</b><br/><small className="tag">{new Date(entry.created_at).toLocaleString()} · {entry.error_summary || entry.status}</small></span><span className={`status-badge ${entry.status === "saved" ? "green" : entry.status === "failed" ? "red" : "amber"}`}>{entry.status}</span></div>) : <div className="empty-state" style={{ minHeight: 100 }}><p>Import history appears after the Admin SQL setup is applied.</p></div>}
        </section>
      </div>

      <aside className="card" style={{ height: "fit-content" }}>
        <div className="section-title"><h2>Import notes</h2><ExternalLink size={16}/></div>
        <div className="stack">
          <div className="stat-line"><span>Extraction</span><b>Public metadata only</b></div>
          <div className="stat-line"><span>Supplier price</span><b>Separate currency</b></div>
          <div className="stat-line"><span>NGN selling price</span><b>Entered by admin</b></div>
          <div className="stat-line"><span>Images</span><b>Copy with rights or upload manually</b></div>
          <div className="stat-line"><span>Stock / variants / shipping</span><b>Verify manually</b></div>
          <div className="notice" style={{ marginTop: 7 }}><Link2 size={15}/><div>Public link uses the configured storefront domain:<br/>{STOREFRONT_URL || "NEXT_PUBLIC_STOREFRONT_URL not set"}/products/{slugify(form.name) || "product-slug"}</div></div>
          <Link className="button ghost" href="/products/new">Enter or finish editing manually</Link>
        </div>
      </aside>
    </div>
  </>;
}
