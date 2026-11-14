"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ExternalLink, ImagePlus, Link2, PackagePlus, RefreshCw, Search } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { STOREFRONT_URL, SUPABASE_CONFIGURED, SUPABASE_URL } from "@/lib/supabase/config";
import { safeCopiedImagePreviewUrl } from "@/lib/import-image-preview";
import { safeError, slugify } from "@/lib/format";
import { mergeImportHistory, type ImportHistoryItem } from "@/lib/import-history";
import { createProductHandoff, PRODUCT_HANDOFF_SESSION_KEY, safeHandoffPayloadBytes } from "@/lib/product-handoff";

type Imported = {
  title: string;
  description: string;
  images: string[];
  price: string;
  currency: string;
  sku: string;
  brand: string;
  model?: string;
  variants?: string[];
  attributes?: Record<string, string>;
  supplier_name?: string;
  source_url: string;
  supplier_host: string;
  history_id: string | null;
};
type DuplicateProduct = { id: string; name: string; slug: string; active: boolean };

type ImportForm = {
  name: string;
  description: string;
  supplier_price: string;
  currency: string;
  sku: string;
};

const blankForm: ImportForm = {
  name: "", description: "", supplier_price: "", currency: "", sku: "",
};

export default function ImportPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [item, setItem] = useState<Imported | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [storedImageUrls, setStoredImageUrls] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<DuplicateProduct[]>([]);
  const [copyingImages, setCopyingImages] = useState(false);
  const [copyProgress, setCopyProgress] = useState({ complete: 0, total: 0 });
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [form, setForm] = useState<ImportForm>(blankForm);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyWriteWarning, setHistoryWriteWarning] = useState("");
  const retrieveLock = useRef(false);
  const copyLock = useRef(false);
  const historySequence = useRef(0);
  const historyMutationVersion = useRef(0);
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const supplierLabel = (() => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === "jumia.com.ng" || host.endsWith(".jumia.com.ng")) return "Jumia";
      if (host === "1688.com" || host.endsWith(".1688.com")) return "1688";
      if (host === "temu.com" || host.endsWith(".temu.com")) return "Temu";
      return host;
    } catch { return "supplier"; }
  })();

  function setField<K extends keyof ImportForm>(key: K, value: ImportForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setReviewConfirmed(false);
  }

  const refreshHistory = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) return;
    const sequence = ++historySequence.current;
    const mutationVersion = historyMutationVersion.current;
    setHistoryLoading(true);
    try {
      const { data, error: queryError } = await getSupabaseBrowserClient().from("nextvo_import_history")
        .select("id,source_url,supplier_host,status,imported_title,error_summary,created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10);
      if (!mounted.current || sequence !== historySequence.current || mutationVersion !== historyMutationVersion.current) return;
      if (queryError) throw queryError;
      setHistory(mergeImportHistory([], (data || []) as ImportHistoryItem[]));
      setHistoryError("");
    } catch (caught) {
      if (mounted.current && sequence === historySequence.current) setHistoryError(`History could not be refreshed; displayed entries may be older. ${safeError(caught)}`);
    } finally {
      if (mounted.current && sequence === historySequence.current) setHistoryLoading(false);
    }
  }, []);

  function acceptConfirmedHistory(entry?: ImportHistoryItem | null) {
    if (!entry?.id) return;
    historyMutationVersion.current += 1;
    setHistory((current) => mergeImportHistory(current, [entry]));
  }

  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    if (!SUPABASE_CONFIGURED) return;
    const db = getSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshHistory(), 250);
    };
    const channel = db.channel("import-history-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "nextvo_import_history" }, schedule)
      .subscribe();
    const interval = setInterval(schedule, 30_000);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
      void db.removeChannel(channel);
    };
  }, [refreshHistory]);

  async function retrieve(event?: FormEvent) {
    event?.preventDefault();
    if (retrieveLock.current || copyingImages) return;
    retrieveLock.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
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
        signal: controller.signal,
      });
      const data = await response.json();
      acceptConfirmedHistory(data.history);
      setHistoryWriteWarning(data.history_warning || "");
      if (!response.ok) throw new Error(`${data.error || "Could not retrieve this product."}${data.request_id ? ` Reference: ${data.request_id}.` : ""}`);
      const imported = data as Imported;
      setItem(imported);
      setSelectedImages(imported.images.slice(0, Math.min(4, imported.images.length)));
      setForm({
        name: imported.title,
        description: imported.description,
        supplier_price: imported.price || "",
        currency: imported.currency || "",
        sku: imported.sku,
      });
      const { data: dupes, error: duplicateError } = await getSupabaseBrowserClient()
        .from("products").select("id,name,slug,active").ilike("name", imported.title).limit(6);
      if (duplicateError) setNotice("Metadata was retrieved, but duplicate lookup failed. Check the catalogue manually before saving.");
      else if (dupes?.length) setDuplicates(dupes as DuplicateProduct[]);
      if (!duplicateError) setNotice(data.extraction_warning || "Public page metadata retrieved. Review it, then continue to the unified product editor to enter NGN selling price and verified stock.");
    } catch (caught) {
      if (mounted.current) setError(controller.signal.aborted ? "Retrieval timed out or was cancelled. Your URL is preserved; you can retry." : safeError(caught));
    } finally {
      clearTimeout(timeout);
      activeRequest.current = null;
      retrieveLock.current = false;
      if (mounted.current) {
        setBusy(false);
        await refreshHistory();
      }
    }
  }

  function toggleImage(image: string) {
    setSelectedImages((current) => current.includes(image) ? current.filter((value) => value !== image) : [...current, image]);
    setReviewConfirmed(false);
  }

  async function copyImagesToStorage() {
    if (!item || !selectedImages.length || copyLock.current || retrieveLock.current) return;
    if (!imageRightsConfirmed) {
      setError("Confirm that you have permission to reuse each selected image and that the source terms allow copying.");
      return;
    }
    copyLock.current = true;
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
    copyLock.current = false;
    setCopyingImages(false);
    setReviewConfirmed(false);
    if (failures.length) setError(`Some images were not copied. They remain external and will not be saved: ${failures.join("; ")}`);
    else setNotice(`Copied ${pending.length} image${pending.length === 1 ? "" : "s"} into the existing Supabase Storage bucket. The original source links remain visible during review.`);
  }

  function continueToEditor() {
    if (copyLock.current || retrieveLock.current) return;
    setError("");
    setNotice("");
    if (!item) return;
    if (!reviewConfirmed) {
      setError("Confirm that you reviewed the extracted supplier metadata and any selected image rights before continuing.");
      return;
    }
    if (selectedImages.some((image) => !storedImageUrls[image])) {
      setError("Copy every selected image into NEXTVO Storage or deselect it before continuing. External supplier image URLs will not be sent to the product editor.");
      return;
    }
    const storageImages = selectedImages.map((sourceUrl) => storedImageUrls[sourceUrl]);
    const source = {
      url: item.source_url,
      supplier_host: item.supplier_host,
      captured_at: new Date().toISOString(),
      history_id: item.history_id,
      title: item.title || null,
      brand: item.brand || null,
      price: item.price || null,
      currency: item.currency || null,
      original_price: null,
      description: item.description || null,
      images: item.images,
      features: [],
      specifications: item.attributes || {},
      variations: item.variants?.length ? [{ name: "Unverified source variation labels", values: item.variants }] : [],
      sku: item.sku || null,
      availability: null,
      category: null,
      seller: item.supplier_name || null,
    };
    const draft = createProductHandoff([source], {
      title: form.name.trim(),
      brand: item.brand || null,
      description: form.description.trim(),
      supplier_reference_price: form.supplier_price.trim() || null,
      supplier_reference_currency: form.currency.trim().toUpperCase() || null,
      sku: form.sku.trim() || null,
      images: storageImages,
      image_sources: Object.fromEntries(selectedImages.map((sourceUrl) => [storedImageUrls[sourceUrl], sourceUrl])),
      features: [],
      specifications: item.attributes || {},
      variations: source.variations,
    });
    if (!draft) {
      setError("Could not create a valid, expiring product draft. Check the source URL and try again.");
      return;
    }
    const serialized = JSON.stringify(draft);
    if (!safeHandoffPayloadBytes(serialized)) {
      setError("The reviewed draft is too large to hand off safely. Remove some selected images and try again.");
      return;
    }
    try {
      window.sessionStorage.setItem(PRODUCT_HANDOFF_SESSION_KEY, serialized);
      setNotice("Reviewed draft is ready. The unified product editor will ask you to add the public NGN selling price and confirm NEXTVO stock.");
      router.push("/products/new?handoff=1");
    } catch {
      setError("This browser could not securely keep the short-lived draft. Enable session storage or use the PWA share action again.");
    }
  }

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">SUPPLIER METADATA REVIEW</div><h1>Import product</h1><p>Review permitted public metadata, then continue to the single product editor for all catalogue changes.</p></div>
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
            <div className="field"><label htmlFor="supplier-page-url">Public product page</label><input id="supplier-page-url" className="input" required type="url" value={url} disabled={busy || copyingImages} onChange={(event) => setUrl(event.target.value)} placeholder="https://supplier.example/product/…" /></div>
            <button className="button primary" disabled={busy || copyingImages || !url}><Search size={15}/>{busy ? `Retrieving ${supplierLabel} metadata…` : "Retrieve product"}</button>
          </form>
          {busy && <p className="helper" role="status" aria-live="polite">Checking {supplierLabel} public page and safe redirects. Your result will be recorded before history refreshes.</p>}
          <div className="notice warn" style={{ marginTop: 15 }}><AlertTriangle size={15}/><span>Extracted values are unverified. Shipping, variants, stock and supplier options are not reliably extracted. Confirm all text, source prices and image rights.</span></div>
        </section>

        {item && <section className="card">
          <div className="section-title"><div><h2>Review product</h2><small>Source: {item.supplier_host}</small></div><span className="status-badge amber">Review required</span></div>
          {item.variants && item.variants.length > 0 && <p className="helper">Public variant labels (review only; stock and selling prices are not imported): {item.variants.join("; ")}</p>}
          {item.model && <p className="helper">Public model metadata: {item.model}</p>}
          {duplicates.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }}><AlertTriangle size={16}/><span>Possible duplicate name: {duplicates.map((duplicate) => duplicate.name).join(", ")}. Check the catalogue before continuing.</span></div>}
          {item.images.length > 0 && <div className="field">
            <label>Choose permitted images</label>
            <div className="photo-strip">
              {item.images.map((image, index) => <label className="photo-tile" key={`${image}-${index}`} style={{ cursor: "pointer", outline: selectedImages.includes(image) ? "2px solid #467bff" : "none" }}>
                {safeCopiedImagePreviewUrl(image, storedImageUrls, SUPABASE_URL)
                  ? <img src={safeCopiedImagePreviewUrl(image, storedImageUrls, SUPABASE_URL) || undefined} alt="Copied product image preview" />
                  : <div role="img" aria-label={`Image ${index + 1} candidate; not loaded directly`} style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: 6, color: "#93a0b6", fontSize: 9, textAlign: "center" }}><span><ImagePlus size={18}/><br/>Copy securely to preview</span></div>}
                <input type="checkbox" checked={selectedImages.includes(image)} onChange={() => toggleImage(image)} style={{ position: "absolute", top: 5, left: 5 }} />
                <span title={storedImageUrls[image] ? "Copied to NEXTVO Storage" : "External image is not loaded in your browser"} style={{ position: "absolute", bottom: 4, left: 4, background: "#080b12d9", padding: "2px 4px", borderRadius: 5, fontSize: 8 }}>{storedImageUrls[image] ? "STORAGE COPY" : `IMAGE ${index + 1}`}</span>
              </label>)}
            </div>
            <p className="field-note">External supplier thumbnails are not loaded in your browser. After you confirm reuse rights, the guarded server fetch copies selected images into Storage and previews only those same-origin copies. Deselect any image you do not want.</p>
            <label className="checkbox" style={{ marginTop: 10 }}><input type="checkbox" checked={imageRightsConfirmed} onChange={(event) => { setImageRightsConfirmed(event.target.checked); setReviewConfirmed(false); }} /> I have permission to reuse the selected images and the source terms permit copying them into NEXTVO Storage.</label>
            <button type="button" className="button" style={{ marginTop: 10 }} onClick={() => void copyImagesToStorage()} disabled={copyingImages || !selectedImages.length || !imageRightsConfirmed}>
              <ImagePlus size={15}/>{copyingImages ? `Copying images ${copyProgress.complete}/${copyProgress.total}…` : "Copy selected images into Storage"}
            </button>
            {copyingImages && <progress aria-label="Image copy progress" max={Math.max(copyProgress.total, 1)} value={copyProgress.complete} style={{ width: "100%", marginTop: 8 }} />}
          </div>}
          {!item.images.length && <div className="empty-state"><div className="empty-icon"><ImagePlus size={18}/></div><p>No image candidates were found. Add your own permitted photos from the product editor after saving.</p></div>}

          <div className="stack">
            <div className="form-grid">
              <div className="field full"><label htmlFor="import-name">Product title</label><input id="import-name" className="input" required value={form.name} onChange={(event) => setField("name", event.target.value)} /></div>
              <div className="field full"><label htmlFor="import-description">Description</label><textarea id="import-description" className="textarea" value={form.description} onChange={(event) => setField("description", event.target.value)} /></div>
              <div className="field"><label htmlFor="import-reference-price">Supplier reference price</label><input id="import-reference-price" className="input" type="number" min="0" step="0.01" value={form.supplier_price} onChange={(event) => setField("supplier_price", event.target.value)} placeholder="Not found" /></div>
              <div className="field"><label htmlFor="import-reference-currency">Reference currency</label><input id="import-reference-currency" className="input" value={form.currency} onChange={(event) => setField("currency", event.target.value.toUpperCase())} placeholder="USD / GBP / EUR / NGN" maxLength={12} /><span className="field-note">No currency conversion is applied; this remains private supplier reference data.</span></div>
              <div className="field"><label htmlFor="import-sku">Source SKU hint</label><input id="import-sku" className="input" value={form.sku} onChange={(event) => setField("sku", event.target.value)} placeholder="Review before using" /></div>
              <div className="field"><label>Original extracted price</label><div className="input" style={{ display: "flex", alignItems: "center" }}>{item.price ? `${item.currency || "Currency not identified"} ${item.price}` : "Not found"}</div><span className="field-note">Kept as source context separately from the editable reference amount.</span></div>
            </div>
            {item.variants && item.variants.length > 0 && <div className="notice warn"><AlertTriangle size={15}/><span>Source variation labels are unverified hints. The product editor will let you review them; no variant stock or selling prices are assumed.</span></div>}
            <label className="checkbox"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /> I reviewed the extracted supplier details and confirmed rights for every selected image.</label>
            <p className="field-note">No product record is saved here. NEXTVO selling price, local sourcing cost, category, and verified stock are handled in the unified product editor.</p>
            <div className="actions"><button type="button" className="button primary" disabled={copyingImages || !SUPABASE_CONFIGURED || !reviewConfirmed || selectedImages.some((image) => !storedImageUrls[image])} onClick={continueToEditor}><PackagePlus size={15}/>Continue to product editor</button></div>
          </div>
        </section>}

        <section className="card">
          <div className="section-title"><h2>Recent import attempts</h2><button className="button small ghost" disabled={historyLoading} onClick={() => void refreshHistory()}><RefreshCw size={13}/>{historyLoading ? "Refreshing…" : "Refresh"}</button></div>
          {historyWriteWarning && <div className="notice error" role="alert">{historyWriteWarning}</div>}
          {historyError && <div className="notice error" role="alert">{historyError}</div>}
          {history.length ? history.map((entry) => <div className="stat-line" key={entry.id}><span><b>{entry.imported_title || entry.supplier_host}</b><br/><small className="tag">{entry.supplier_host} · {new Date(entry.created_at).toLocaleString()} · {entry.error_summary || (entry.status === "retrieved" ? "Awaiting product review" : entry.status === "saved" ? "Product save confirmed" : "Retrieval failed")}</small></span><span className={`status-badge ${entry.status === "saved" ? "green" : entry.status === "failed" ? "red" : "amber"}`}>{entry.status}</span></div>) : <div className="empty-state" style={{ minHeight: 100 }}><p>{historyLoading ? "Loading recent import attempts…" : historyError ? "History is unavailable; no empty-history claim can be made." : "No recorded import attempts yet."}</p></div>}
        </section>
      </div>

      <aside className="card" style={{ height: "fit-content" }}>
        <div className="section-title"><h2>Import notes</h2><ExternalLink size={16}/></div>
        <div className="stack">
          <div className="stat-line"><span>Extraction</span><b>Public metadata only</b></div>
          <div className="stat-line"><span>Supplier price</span><b>Separate currency</b></div>
          <div className="stat-line"><span>Product management</span><b>One unified editor</b></div>
          <div className="stat-line"><span>Images</span><b>Copy with rights or upload manually</b></div>
          <div className="stat-line"><span>Stock / variants</span><b>Review and confirm in editor</b></div>
          <div className="notice" style={{ marginTop: 7 }}><Link2 size={15}/><div>Public link uses the configured storefront domain:<br/>{STOREFRONT_URL || "NEXT_PUBLIC_STOREFRONT_URL not set"}/products/{slugify(form.name) || "product-slug"}</div></div>
          <Link className="button ghost" href="/products/new">Enter or finish editing manually</Link>
        </div>
      </aside>
    </div>
  </>;
}
