"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDown, ArrowUp, Check, ImagePlus, Link2, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { STOREFRONT_URL, SUPABASE_CONFIGURED, SUPABASE_URL } from "@/lib/supabase/config";
import { mergeProductAttributes, resolveProductStatus, validateSupplierCost } from "@/lib/product-domain";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/image-validation";
import { formatMoney, safeError, slugify } from "@/lib/format";

const NEW = "new";
type Category = { id: string; slug: string; name: string; active: boolean; subcategories?: { id: string; slug: string; name: string; active: boolean }[] };
type Photo = { url: string; file?: File; alt: string; sourceUrl?: string };
type Variant = { id?: string; label: string; sku: string; price: string; stock: string; options: string };
type ProductForm = {
  name: string;
  slug: string;
  description: string;
  short_description: string;
  category_id: string;
  subcategory_id: string;
  brand: string;
  price: string;
  compare: string;
  stock: string;
  supplier_name: string;
  supplier_url: string;
  supplier_price: string;
  supplier_currency: string;
  status: string;
  featured: boolean;
  new_arrival: boolean;
};

const blankVariant: Variant = { label: "", sku: "", price: "", stock: "0", options: "" };
const initialForm: ProductForm = {
  name: "", slug: "", description: "", short_description: "", category_id: "", subcategory_id: "", brand: "",
  price: "", compare: "", stock: "0", supplier_name: "", supplier_url: "", supplier_price: "",
  supplier_currency: "NGN", status: "draft", featured: false, new_arrival: false,
};

function parseOptions(value: string) {
  return Object.fromEntries(value.split(",").map((pair) => pair.trim().split("=")).filter((parts) => parts.length >= 2).map(([key, ...rest]) => [key.trim(), rest.join("=").trim()]));
}

function isManagedStorageUrl(value: string) {
  try {
    const image = new URL(value);
    const project = new URL(SUPABASE_URL);
    return image.hostname === project.hostname && image.pathname.includes("/storage/v1/object/public/product-images/");
  } catch {
    return false;
  }
}

function readImageSources(value: unknown): Map<string, string> {
  const sources = new Map<string, string>();
  if (!Array.isArray(value)) return sources;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.image_url !== "string" || typeof entry.source_url !== "string") continue;
    try {
      const image = new URL(entry.image_url);
      const source = new URL(entry.source_url);
      if (image.protocol === "https:" && source.protocol === "https:" && !source.username && !source.password) {
        sources.set(image.toString(), source.toString());
      }
    } catch { /* malformed private source metadata is ignored */ }
  }
  return sources;
}

export default function ProductEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const isNew = id === NEW;
  const router = useRouter();
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [specifications, setSpecifications] = useState("");
  const [variantList, setVariantList] = useState<Variant[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [form, setForm] = useState<ProductForm>(initialForm);
  const [originalAttributes, setOriginalAttributes] = useState<Record<string, unknown>>({});
  const [originalSearchTerms, setOriginalSearchTerms] = useState<string[]>([]);
  const [externalImagesConfirmed, setExternalImagesConfirmed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ complete: 0, total: 0 });

  const subcategories = useMemo(
    () => categories.find((category) => category.id === form.category_id)?.subcategories?.filter((subcategory) => subcategory.active) || [],
    [categories, form.category_id],
  );
  const externalImageCount = photos.filter((photo) => !isManagedStorageUrl(photo.url) && !photo.file).length;

  useEffect(() => {
    let live = true;
    async function load() {
      if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
      if (!isNew) setLoading(true);
      const db = getSupabaseBrowserClient();
      const { data: categoryData, error: categoryError } = await db.from("categories")
        .select("id,slug,name,active,subcategories(id,slug,name,active)").order("display_order");
      if (!live) return;
      if (categoryError) setError(`Could not read categories: ${safeError(categoryError)}`);
      else setCategories((categoryData || []) as Category[]);
      if (isNew) { setLoading(false); return; }

      const { data: product, error: productError } = await db.from("products").select("*").eq("id", id).single();
      if (!live) return;
      if (productError || !product) {
        setError(`Could not load this product: ${safeError(productError)}`);
        setLoading(false);
        return;
      }
      const [detailsResult, imagesResult, variantsResult] = await Promise.all([
        db.from("nextvo_admin_product_details").select("*").eq("product_id", id).maybeSingle(),
        db.from("product_images").select("id,image_url,alt_text,sort_order").eq("product_id", id).order("sort_order"),
        db.from("product_variants").select("id,label,sku,options,price_ngn,stock_quantity,active").eq("product_id", id).eq("active", true).order("created_at"),
      ]);
      if (!live) return;
      if (detailsResult.error) setError(`Admin SQL setup is required: ${safeError(detailsResult.error)}`);
      const details = detailsResult.data || {};
      const attrs = (product.attributes && typeof product.attributes === "object" ? product.attributes : {}) as Record<string, unknown>;
      const imageSources = readImageSources(details.source_image_urls);
      const imageRows = ((imagesResult.data || []) as Array<{ image_url: string; alt_text: string | null }>).map((image) => ({ url: image.image_url, sourceUrl: imageSources.get(image.image_url), alt: image.alt_text || product.name }));
      if (product.image_url && !imageRows.some((image: Photo) => image.url === product.image_url)) imageRows.unshift({ url: product.image_url, sourceUrl: imageSources.get(product.image_url), alt: product.name });
      setPhotos(imageRows);
      setOriginalAttributes(attrs);
      setOriginalSearchTerms(Array.isArray(product.search_terms) ? product.search_terms.map(String) : []);
      setExternalImagesConfirmed(false);
      setForm({
        name: product.name || "",
        slug: product.slug || "",
        description: product.description || "",
        short_description: details.short_description || String(attrs.short_description || ""),
        category_id: product.category_id || "",
        subcategory_id: product.subcategory_id || "",
        brand: product.brand || "",
        price: String(product.price_ngn ?? ""),
        compare: product.compare_at_price_ngn == null ? "" : String(product.compare_at_price_ngn),
        stock: String(product.stock_quantity ?? 0),
        supplier_name: details.supplier_name || "",
        supplier_url: details.supplier_product_url || "",
        supplier_price: details.supplier_price == null ? "" : String(details.supplier_price),
        supplier_currency: details.supplier_currency || "NGN",
        status: details.status || (product.active ? "published" : "unpublished"),
        featured: product.featured === true,
        new_arrival: product.is_new_arrival === true,
      });
      setSpecifications(Object.entries(attrs).filter(([key]) => key !== "short_description")
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.map(String).join(", ") : value && typeof value === "object" ? JSON.stringify(value) : String(value)}`).join("\n"));
      setVariantList(((variantsResult.data || []) as Array<{ id: string; label: string; sku: string | null; price_ngn: number | null; stock_quantity: number; options: Record<string, unknown> }>).map((variant) => ({
        id: variant.id,
        label: variant.label || "",
        sku: variant.sku || "",
        price: variant.price_ngn == null ? "" : String(variant.price_ngn),
        stock: String(variant.stock_quantity ?? 0),
        options: Object.entries(variant.options || {}).map(([key, value]) => `${key}=${value}`).join(", "),
      })));
      setLoading(false);
    }
    void load();
    return () => { live = false; };
  }, [id, isNew, reloadToken]);

  function change<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    const good = selected.filter((file) => acceptedTypes.includes(file.type) && file.size > 0 && file.size <= MAX_PRODUCT_IMAGE_BYTES);
    const existingKeys = new Set(photos.filter((photo) => photo.file).map((photo) => `${photo.file?.name}:${photo.file?.size}:${photo.file?.lastModified}`));
    const unique = good.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (good.length !== selected.length) setError("Use non-empty JPEG, PNG, WebP or AVIF images up to 5 MB each.");
    else if (unique.length !== good.length) setError("Duplicate file selections were skipped.");
    else setError("");
    setPhotos((previous) => [...previous, ...unique.map((file) => ({ url: URL.createObjectURL(file), file, alt: form.name || file.name }))]);
    setFileInputKey((key) => key + 1);
  }

  function movePhoto(index: number, step: number) {
    setPhotos((items) => {
      const next = [...items];
      const target = index + step;
      if (target < 0 || target >= next.length) return items;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removePhoto(index: number) {
    setPhotos((items) => {
      const removed = items[index];
      if (removed?.file) URL.revokeObjectURL(removed.url);
      return items.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function addUrl() {
    try {
      const imageUrl = new URL(urlInput.trim());
      if (imageUrl.protocol !== "https:" || imageUrl.username || imageUrl.password) throw new Error();
      if (photos.some((photo) => photo.url === imageUrl.toString())) { setError("That image URL is already in the product gallery."); return; }
      setPhotos((previous) => [...previous, { url: imageUrl.toString(), alt: form.name }]);
      setUrlInput("");
      setError("");
      setExternalImagesConfirmed(false);
    } catch {
      setError("Image URL must be a valid public HTTPS URL.");
    }
  }

  async function uploadFiles() {
    const db = getSupabaseBrowserClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) throw new Error("Sign in is required to upload product images.");
    const filePhotos = photos.filter((photo) => photo.file);
    const output: Photo[] = [];
    const uploadedPaths: string[] = [];
    setUploadProgress({ complete: 0, total: filePhotos.length });
    let complete = 0;
    for (const photo of photos) {
      if (!photo.file) { output.push(photo); continue; }
      const extension = photo.file.name.split(".").pop()?.toLowerCase() || "webp";
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from("product-images").upload(path, photo.file, {
        upsert: false,
        cacheControl: "31536000",
        contentType: photo.file.type,
      });
      if (uploadError) {
        throw new Error(`Image upload failed for ${photo.file.name}. Check the product-images bucket, file type and 5 MB limit. ${safeError(uploadError)}`);
      }
      uploadedPaths.push(path);
      const { data } = db.storage.from("product-images").getPublicUrl(path);
      output.push({ ...photo, url: data.publicUrl, file: undefined });
      complete += 1;
      setUploadProgress({ complete, total: filePhotos.length });
    }
    return { photos: output, uploadedPaths };
  }

  async function save(action: "draft" | "published" | "current", event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setSuccess("");
    if (!form.name.trim()) { setError("Product name is required."); return; }
    const price = Number(form.price);
    const stock = Number(form.stock);
    const compare = form.compare.trim() ? Number(form.compare) : null;
    if (!Number.isFinite(price) || price < 0) { setError("Enter a valid NGN selling price."); return; }
    if (compare !== null && (!Number.isFinite(compare) || compare < price)) { setError("Compare-at price must be a valid NGN amount greater than or equal to the selling price."); return; }
    if (!Number.isInteger(stock) || stock < 0) { setError("Stock must be a non-negative whole number."); return; }
    if (!form.category_id) { setError("Choose a department before saving."); return; }
    let supplierCost: ReturnType<typeof validateSupplierCost>;
    try { supplierCost = validateSupplierCost(form.supplier_price, form.supplier_currency); }
    catch (caught) { setError(safeError(caught)); return; }
    if (form.supplier_url) {
      try {
        const supplierUrl = new URL(form.supplier_url);
        if (!["http:", "https:"].includes(supplierUrl.protocol) || supplierUrl.username || supplierUrl.password) throw new Error();
      } catch { setError("Supplier product URL must be a valid HTTP(S) address without embedded credentials."); return; }
    }
    const chosenStatus = resolveProductStatus(action, form.status, isNew);
    const slug = slugify(form.slug || form.name);
    if (!slug) { setError("Enter a product name or URL slug that produces a valid slug."); return; }
    if (externalImageCount > 0 && !externalImagesConfirmed) { setError("Confirm that externally hosted image URLs are permitted and may become unavailable, or copy permitted images into Storage."); return; }

    setSaving(true);
    let uploadedPaths: string[] = [];
    const db = getSupabaseBrowserClient();
    try {
      const { data: duplicate, error: slugCheckError } = await db.from("products").select("id,name").eq("slug", slug).neq("id", isNew ? "00000000-0000-0000-0000-000000000000" : id).maybeSingle();
      if (slugCheckError) throw new Error(`Could not confirm slug uniqueness; no changes were saved. ${safeError(slugCheckError)}`);
      if (duplicate) { setError(`That product URL slug is already used by “${duplicate.name}”. Choose another slug.`); return; }

      const uploaded = await uploadFiles();
      uploadedPaths = uploaded.uploadedPaths;
      setUploadProgress({ complete: 0, total: 0 });
      const product = {
        ...(isNew ? {} : { id }),
        slug,
        name: form.name.trim(),
        description: form.description.trim(),
        brand: form.brand.trim() || null,
        price_ngn: price,
        compare_at_price_ngn: compare,
        currency_code: "NGN",
        category_id: form.category_id,
        subcategory_id: form.subcategory_id || null,
        image_url: uploaded.photos[0]?.url || null,
        stock_quantity: stock,
        featured: form.featured,
        is_new_arrival: form.new_arrival,
        active: chosenStatus === "published",
        attributes: mergeProductAttributes(originalAttributes, specifications, form.short_description),
        search_terms: Array.from(new Set([...originalSearchTerms, ...form.name.toLowerCase().split(/\s+/).filter(Boolean)])),
      };
      const privateData = {
        short_description: form.short_description.trim(),
        supplier_name: form.supplier_name.trim(),
        supplier_product_url: form.supplier_url.trim(),
        supplier_price: supplierCost.supplierPrice,
        supplier_currency: supplierCost.supplierCurrency || "NGN",
        source_image_urls: uploaded.photos.filter((photo) => photo.sourceUrl && photo.sourceUrl !== photo.url).map((photo) => ({ image_url: photo.url, source_url: photo.sourceUrl })),
        status: chosenStatus,
      };
      const imageRows = uploaded.photos.map((photo, index) => ({ image_url: photo.url, alt_text: photo.alt || form.name, sort_order: index }));
      const variants = variantList.filter((variant) => variant.label.trim()).map((variant) => {
        const variantPrice = variant.price.trim() ? Number(variant.price) : null;
        const variantStock = Number(variant.stock);
        if (variantPrice !== null && (!Number.isFinite(variantPrice) || variantPrice < 0)) throw new Error(`Enter a valid NGN price for variant “${variant.label}”.`);
        if (!Number.isInteger(variantStock) || variantStock < 0) throw new Error(`Enter a non-negative whole stock quantity for variant “${variant.label}”.`);
        return {
          ...(variant.id ? { id: variant.id } : {}),
          label: variant.label.trim(),
          sku: variant.sku.trim() || null,
          price_ngn: variantPrice,
          stock_quantity: variantStock,
          options: parseOptions(variant.options),
        };
      });

      const { data: savedId, error: saveError } = await db.rpc("nextvo_admin_save_product", {
        p_product: product,
        p_private: privateData,
        p_images: imageRows,
        p_variants: variants,
      });
      if (saveError) {
        if (saveError.code === "23505") throw new Error("That product URL slug is already in use. Choose a unique slug.");
        throw saveError;
      }
      if (!savedId) throw new Error("The database did not return a saved product ID.");
      uploadedPaths = [];
      setSuccess(chosenStatus === "published" ? "Product saved and marked published in the shared catalogue." : chosenStatus === "draft" ? "Product saved as a draft in the shared catalogue." : `Product changes saved. Current status: ${chosenStatus}.`);
      setForm((current) => ({ ...current, status: chosenStatus }));
      setOriginalAttributes(product.attributes);
      setOriginalSearchTerms(product.search_terms);
      if (isNew) {
        router.replace(`/products/${savedId}`);
        router.refresh();
      } else {
        router.refresh();
        setReloadToken((token) => token + 1);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await db.storage.from("product-images").remove(uploadedPaths);
        if (cleanupError) setError(`Save failed and uploaded image cleanup needs attention: ${safeError(cleanupError)}. ${safeError(caught)}`);
        else setError(`Save failed; the catalogue was not confirmed updated. Uploaded temporary images were removed. ${safeError(caught)}`);
      } else {
        setError(`Save failed; the catalogue was not confirmed updated. ${safeError(caught)}`);
      }
    } finally {
      setSaving(false);
      setUploadProgress({ complete: 0, total: 0 });
    }
  }

  if (loading) return <div className="card loading-skeleton" style={{ height: 500 }} />;
  return <>
    <div className="page-heading">
      <div><div className="eyebrow">CATALOGUE EDITOR</div><h1>{isNew ? "Add product" : "Edit product"}</h1><p>Changes are written to the shared NEXTVO Supabase catalogue.</p></div>
      <Link href="/products" className="button ghost"><ArrowLeft size={15}/>Back to products</Link>
    </div>
    {!SUPABASE_CONFIGURED && <div className="notice warn" style={{ marginBottom: 15 }}>Add Supabase public connection variables before editing catalogue data.</div>}
    {error && <div className="notice error" role="alert" style={{ marginBottom: 15 }}>{error}</div>}
    {success && <div className="notice success" role="status" style={{ marginBottom: 15 }}><Check size={17}/>{success}</div>}

    <form onSubmit={(event) => void save("draft", event)} className="stack">
      <div className="two-col">
        <div className="stack">
          <section className="card">
            <div className="section-title"><h2>Product details</h2><span className="status-badge">Public catalogue</span></div>
            <div className="form-grid">
              <div className="field full"><label htmlFor="product-name">Product name *</label><input id="product-name" className="input" required value={form.name} onChange={(event) => { change("name", event.target.value); if (!form.slug || form.slug === slugify(form.name)) change("slug", slugify(event.target.value)); }} placeholder="Name customers will see" /></div>
              <div className="field full"><label htmlFor="product-slug">Product URL slug *</label><input id="product-slug" className="input" value={form.slug} onChange={(event) => change("slug", slugify(event.target.value))} placeholder="generated-from-product-name" /><span className="field-note">Share link path: /products/{slugify(form.slug || form.name) || "product-name"}. Slugs must be unique. Previously shared slugs are not redirected by this Admin app.</span></div>
              <div className="field full"><label htmlFor="short-description">Short description</label><input id="short-description" className="input" value={form.short_description} onChange={(event) => change("short_description", event.target.value)} placeholder="One-line product summary" /></div>
              <div className="field full"><label htmlFor="product-description">Description</label><textarea id="product-description" className="textarea" value={form.description} onChange={(event) => change("description", event.target.value)} placeholder="Accurate product details and relevant information" /></div>
              <div className="field"><label htmlFor="product-category">Department *</label><select id="product-category" className="select" value={form.category_id} onChange={(event) => { change("category_id", event.target.value); change("subcategory_id", ""); }}><option value="">Choose department</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
              <div className="field"><label htmlFor="product-subcategory">Subcategory</label><select id="product-subcategory" className="select" value={form.subcategory_id} onChange={(event) => change("subcategory_id", event.target.value)} disabled={!subcategories.length}><option value="">No subcategory</option>{subcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}</select></div>
              <div className="field"><label htmlFor="product-brand">Brand (optional)</label><input id="product-brand" className="input" value={form.brand} onChange={(event) => change("brand", event.target.value)} placeholder="Brand" /></div>
              <div className="field"><label htmlFor="product-sku">SKU (internal / per variant)</label><input id="product-sku" className="input" value={variantList[0]?.sku || ""} onChange={(event) => setVariantList((variants) => variants.length ? variants.map((variant, index) => index === 0 ? { ...variant, sku: event.target.value } : variant) : [{ ...blankVariant, label: "Default", sku: event.target.value, stock: form.stock }])} placeholder="Optional SKU" /><span className="field-note">Stored on the default variant; not exposed with supplier cost.</span></div>
              <div className="field"><label htmlFor="selling-price">Selling price (NGN) *</label><input id="selling-price" className="input" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => change("price", event.target.value)} placeholder="0.00" /></div>
              <div className="field"><label htmlFor="compare-price">Regular / compare-at price (NGN)</label><input id="compare-price" className="input" type="number" min="0" step="0.01" value={form.compare} onChange={(event) => change("compare", event.target.value)} placeholder="Optional original price" /><span className="field-note">Stored and displayed as NGN; the storefront crosses it out when applicable.</span></div>
              <div className="field"><label htmlFor="product-stock">Stock quantity *</label><input id="product-stock" className="input" type="number" min="0" step="1" value={form.stock} onChange={(event) => change("stock", event.target.value)} /></div>
              <div className="field"><label htmlFor="product-status">Publishing status</label><select id="product-status" className="select" value={form.status} onChange={(event) => change("status", event.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="unpublished">Unpublished</option><option value="unavailable">Unavailable</option></select><span className="field-note">Save changes preserves this selection. Save draft always sets Draft; Publish always sets Published. Only Published sets products.active=true.</span></div>
            </div>
            <div className="actions" style={{ marginTop: 17 }}><label className="checkbox"><input type="checkbox" checked={form.featured} onChange={(event) => change("featured", event.target.checked)} /> Featured product</label><label className="checkbox"><input type="checkbox" checked={form.new_arrival} onChange={(event) => change("new_arrival", event.target.checked)} /> New arrival</label></div>
          </section>

          <section className="card">
            <div className="section-title"><h2>Product photos</h2><span className="tag">Use images you’re permitted to publish · up to 5 MB</span></div>
            <label className="select-photo"><ImagePlus size={25}/><b>Tap to add product photos</b><span className="tag">JPEG, PNG, WebP or AVIF</span><input key={fileInputKey} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={addFiles} style={{ display: "none" }} /></label>
            <div className="actions" style={{ marginTop: 10 }}><input className="input" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="Add a public HTTPS image URL" /><button className="button" type="button" onClick={addUrl}><Link2 size={14}/>Add URL</button></div>
            {externalImageCount > 0 && <div className="notice warn" style={{ marginTop: 10 }}><Link2 size={15}/><span>{externalImageCount} image{externalImageCount === 1 ? " is" : "s are"} still hosted outside NEXTVO Storage and may disappear if the source URL changes. Copy permitted images into Storage using Import, or confirm this external source is permitted and that you understand the availability risk.</span></div>}
            {externalImageCount > 0 && <label className="checkbox" style={{ marginTop: 9 }}><input type="checkbox" checked={externalImagesConfirmed} onChange={(event) => setExternalImagesConfirmed(event.target.checked)} /> I have permission to use these external image URLs and understand they depend on the source website.</label>}
            <div className="photo-strip" style={{ marginTop: 13 }}>
              {photos.map((photo, index) => <div className="photo-tile" key={`${photo.url}-${index}`}>
                <img src={photo.url} alt={photo.alt}/>
                <span style={{ position: "absolute", left: 4, top: 4, padding: "2px 4px", background: "#080b12d9", borderRadius: 5, fontSize: 8 }}>{index === 0 ? "MAIN" : index + 1}{photo.file ? " · NEW" : ""}</span>
                {photo.sourceUrl && <a href={photo.sourceUrl} target="_blank" rel="noreferrer" title={photo.sourceUrl} aria-label={`Open original image source for photo ${index + 1}`} style={{ position: "absolute", left: 4, bottom: 38, padding: "3px 5px", background: "#080b12d9", borderRadius: 5, color: "#d7e5ff", fontSize: 9 }}>SOURCE</a>}
                <div className="photo-actions"><button type="button" onClick={() => movePhoto(index, -1)} aria-label="Move photo up"><ArrowUp size={12}/></button><button type="button" onClick={() => movePhoto(index, 1)} aria-label="Move photo down"><ArrowDown size={12}/></button><button type="button" onClick={() => removePhoto(index)} aria-label="Remove photo"><Trash2 size={12}/></button></div>
              </div>)}
            </div>
            {uploadProgress.total > 0 && <div role="status" className="helper" style={{ marginTop: 10 }}><LoaderCircle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />Uploading image {uploadProgress.complete + 1} of {uploadProgress.total} to the product-images bucket…</div>}
          </section>

          <section className="card">
            <div className="section-title"><h2>Variants</h2><button type="button" className="button small" onClick={() => setVariantList((variants) => [...variants, { ...blankVariant }])}><Plus size={13}/>Add variant</button></div>
            <p className="helper">Variant options and stock are stored in the existing shared product_variants table.</p>
            {variantList.map((variant, index) => <div key={variant.id || index} className="form-grid" style={{ padding: "14px 0", borderTop: "1px solid #263144" }}>
              <div className="field"><label>Label</label><input className="input" value={variant.label} onChange={(event) => setVariantList((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="e.g. Blue / Medium" /></div>
              <div className="field"><label>Variant SKU</label><input className="input" value={variant.sku} onChange={(event) => setVariantList((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item))} /></div>
              <div className="field"><label>Variant price override (NGN)</label><input className="input" type="number" min="0" step="0.01" value={variant.price} onChange={(event) => setVariantList((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} placeholder="Use main price" /></div>
              <div className="field"><label>Variant stock</label><input className="input" type="number" min="0" step="1" value={variant.stock} onChange={(event) => setVariantList((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, stock: event.target.value } : item))} /></div>
              <div className="field full"><label>Options (key=value, comma-separated)</label><input className="input" value={variant.options} onChange={(event) => setVariantList((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, options: event.target.value } : item))} placeholder="colour=Blue, size=Medium" /></div>
              <div className="field full"><button type="button" className="button danger small" onClick={() => setVariantList((variants) => variants.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={13}/>Remove option</button></div>
            </div>)}
          </section>

          <section className="card"><div className="section-title"><h2>Specifications</h2><span className="tag">One key: value per line</span></div><textarea className="textarea" value={specifications} onChange={(event) => setSpecifications(event.target.value)} placeholder={'Material: Cotton\nColour: Navy'} /></section>
        </div>

        <aside className="stack">
          <section className="card"><div className="section-title"><h2>Supplier & internal cost</h2><span className="status-badge amber">Admin-only</span></div><p className="helper">Supplier details are stored in a separate RLS-protected table, not the public product row.</p><div className="stack">
            <div className="field"><label>Supplier name</label><input className="input" value={form.supplier_name} onChange={(event) => change("supplier_name", event.target.value)} placeholder="Supplier" /></div>
            <div className="field"><label>Supplier product URL</label><input className="input" type="url" value={form.supplier_url} onChange={(event) => change("supplier_url", event.target.value)} placeholder="https://…" /></div>
            <div className="form-grid"><div className="field"><label>Supplier cost</label><input className="input" type="number" min="0" step="0.01" value={form.supplier_price} onChange={(event) => change("supplier_price", event.target.value)} placeholder="0.00" /></div><div className="field"><label>Supplier currency</label><input className="input" value={form.supplier_currency} onChange={(event) => change("supplier_currency", event.target.value.toUpperCase())} maxLength={3} placeholder="USD / GBP / EUR / NGN" /></div></div>
          </div></section>
          <section className="card"><div className="section-title"><h2>Share preview</h2></div><div style={{ display: "grid", gap: 12 }}><div className="product-cell">{photos[0]?.url ? <img className="product-thumb" src={photos[0].url} alt=""/> : <div className="product-thumb empty"><ImagePlus size={18}/></div>}<div><b>{form.name || "Your product name"}</b><div className="tag">{form.price ? formatMoney(form.price, "NGN") : "Selling price (NGN)"}</div></div></div><div className="notice"><Link2 size={15}/><span>{STOREFRONT_URL ? `${STOREFRONT_URL}/products/${slugify(form.slug || form.name) || "product-name"}` : "Set NEXT_PUBLIC_STOREFRONT_URL to generate public links."}</span></div></div></section>
          <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <button className="button" type="submit" disabled={saving || !SUPABASE_CONFIGURED}><Save size={15}/>{saving ? "Saving…" : "Save draft"}</button>
            <button className="button ghost" type="button" disabled={saving || !SUPABASE_CONFIGURED} onClick={() => void save("current")}>{saving ? "Saving…" : "Save changes"}</button>
            <button className="button primary" type="button" disabled={saving || !SUPABASE_CONFIGURED} onClick={() => void save("published")}><Check size={15}/>{saving ? "Publishing…" : "Publish product"}</button>
            {saving && <div className="helper" style={{ textAlign: "center" }}><LoaderCircle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{uploadProgress.total > 0 ? `Uploading images ${uploadProgress.complete}/${uploadProgress.total}…` : "Wait for database confirmation."}</div>}
          </div>
        </aside>
      </div>
    </form>
  </>;
}
