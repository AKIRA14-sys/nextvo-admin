"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FolderTree, ImagePlus, LoaderCircle, Plus, RefreshCw, Save, Tag } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/config";
import { safeError, slugify } from "@/lib/format";
import { createStableProductImage } from "@/lib/product-image-file";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/image-validation";

type Subcategory = { id: string; name: string; slug: string; active: boolean; display_order: number };
type Category = { id: string; name: string; slug: string; description: string | null; image_url: string | null; active: boolean; display_order: number; subcategories: Subcategory[] };
type CategoryLogoDraft = { file: File; previewUrl: string };

function logoExtension(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/avif": return "avif";
    default: throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  }
}

export default function CategoriesPage() {
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ name: "", description: "", image_url: "" });
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  const [logoDrafts, setLogoDrafts] = useState<Record<string, CategoryLogoDraft>>({});
  const logoDraftsRef = useRef<Record<string, CategoryLogoDraft>>({});
  const logoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => () => {
    for (const draft of Object.values(logoDraftsRef.current)) URL.revokeObjectURL(draft.previewUrl);
  }, []);

  const load = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: loadError } = await getSupabaseBrowserClient().from("categories")
      .select("id,name,slug,description,image_url,active,display_order,subcategories(id,name,slug,active,display_order)")
      .order("display_order");
    if (loadError) setError(`${safeError(loadError)} Apply admin RLS setup if this is a permission error.`);
    else setRows((data || []) as Category[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function replaceLogoDraft(categoryId: string, draft?: CategoryLogoDraft) {
    const previous = logoDraftsRef.current[categoryId];
    if (previous && previous.previewUrl !== draft?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    const next = { ...logoDraftsRef.current };
    if (draft) next[categoryId] = draft;
    else delete next[categoryId];
    logoDraftsRef.current = next;
    setLogoDrafts(next);
  }

  async function chooseCategoryLogo(categoryId: string, file: File) {
    if (busy) return;
    if (!file.size || file.size > MAX_PRODUCT_IMAGE_BYTES) {
      setError("Category image must be non-empty and no larger than 5 MB.");
      return;
    }
    setBusy(categoryId);
    setError("");
    setSuccess("");
    try {
      const stableFile = await createStableProductImage(file);
      replaceLogoDraft(categoryId, { file: stableFile, previewUrl: URL.createObjectURL(stableFile) });
    } catch (caught) {
      setError(`Could not read this category image. ${safeError(caught)}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveCategoryLogo(category: Category) {
    const draft = logoDrafts[category.id];
    if (!draft || busy) return;
    setBusy(category.id);
    setError("");
    setSuccess("");
    const db = getSupabaseBrowserClient();
    const storage = db.storage.from("product-images");
    let stage = "checking administrator access";
    let uploadedPath = "";
    try {
      const { data: { user }, error: authError } = await db.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Administrator sign-in is missing or expired. Sign in again and retry.");

      const extension = logoExtension(draft.file.type);
      uploadedPath = `${user.id}/categories/${category.id}-logo-${crypto.randomUUID()}.${extension}`;
      stage = "uploading the category image";
      const { error: uploadError } = await storage.upload(uploadedPath, draft.file, {
        upsert: false,
        cacheControl: "3600",
        contentType: draft.file.type,
      });
      if (uploadError) throw uploadError;

      const imageUrl = storage.getPublicUrl(uploadedPath).data.publicUrl;
      stage = "saving the category image link";
      const { data, error: updateError } = await db.from("categories")
        .update({ image_url: imageUrl })
        .eq("id", category.id)
        .select("id,image_url")
        .single();
      if (updateError) {
        const { error: cleanupError } = await storage.remove([uploadedPath]);
        uploadedPath = "";
        if (cleanupError) throw new Error(`The category image could not be linked, and the unused upload could not be removed. ${safeError(updateError)} ${safeError(cleanupError)}`);
        throw updateError;
      }
      setRows((current) => current.map((row) => row.id === category.id ? { ...row, image_url: data.image_url } : row));
      replaceLogoDraft(category.id);
      setSuccess(`${category.name} image updated. The department and subcategory IDs were not changed.`);
    } catch (caught) {
      const uncertainUpload = uploadedPath && stage !== "checking administrator access"
        ? " If the response was lost, an unused image may remain in Storage; the existing category image was not intentionally removed."
        : "";
      setError(`Could not finish ${stage} for ${category.name}. ${safeError(caught)}${uncertainUpload}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveCategory(id: string, patch: Partial<Category>) {
    setBusy(id);
    setError("");
    setSuccess("");
    try {
      const { data, error: updateError } = await getSupabaseBrowserClient().from("categories")
        .update(patch).eq("id", id)
        .select("id,name,slug,description,image_url,active,display_order").single();
      if (updateError) throw updateError;
      setRows((current) => current.map((category) => category.id === id ? { ...category, ...data } : category));
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!newCategory.name.trim()) return;
    setBusy("new-category");
    try {
      const slug = slugify(newCategory.name);
      const { error: insertError } = await getSupabaseBrowserClient().from("categories").insert({
        name: newCategory.name.trim(),
        slug,
        description: newCategory.description.trim(),
        image_url: newCategory.image_url.trim() || null,
        display_order: rows.length + 1,
        active: true,
      });
      if (insertError) throw insertError;
      setNewCategory({ name: "", description: "", image_url: "" });
      await load();
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function addSubcategory(event: FormEvent, id: string) {
    event.preventDefault();
    const name = newSub[id]?.trim();
    if (!name) return;
    setBusy(id);
    setError("");
    setSuccess("");
    try {
      const parent = rows.find((category) => category.id === id);
      const { error: insertError } = await getSupabaseBrowserClient().from("subcategories").insert({
        category_id: id,
        name,
        slug: slugify(name),
        display_order: (parent?.subcategories?.length || 0) + 1,
        active: true,
      });
      if (insertError) throw insertError;
      setNewSub((current) => ({ ...current, [id]: "" }));
      await load();
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSubcategory(subcategory: Subcategory) {
    setBusy(subcategory.id);
    setError("");
    setSuccess("");
    try {
      const { data, error: updateError } = await getSupabaseBrowserClient().from("subcategories")
        .update({ active: !subcategory.active })
        .eq("id", subcategory.id)
        .select("id,name,slug,active,display_order").single();
      if (updateError) throw updateError;
      setRows((current) => current.map((category) => ({
        ...category,
        subcategories: (category.subcategories || []).map((item) => item.id === subcategory.id ? { ...item, ...data } : item),
      })));
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(null);
    }
  }

  return <>
    <div className="page-heading">
      <div>
        <div className="eyebrow">STORE TAXONOMY</div>
        <h1>Categories</h1>
        <p>Manage the shared 14-department taxonomy and subcategories.</p>
      </div>
      <button className="button ghost" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw size={15} />Refresh</button>
    </div>
    {error && <div className="notice error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
    {success && <div className="notice success" role="status" style={{ marginBottom: 16 }}><Save size={15} />{success}</div>}
    {!SUPABASE_CONFIGURED && <div className="notice warn" style={{ marginBottom: 16 }}><FolderTree size={16} />Connect to the existing Supabase project to view category rows. This screen does not seed replacement categories.</div>}

    <div className="two-col">
      <div className="stack">
        {rows.map((category) => {
          const logoDraft = logoDrafts[category.id];
          const logoPreview = logoDraft?.previewUrl || category.image_url;
          return <section className="card" key={category.id}>
            <div className="category-card-heading">
              <div className="category-logo-column">
                <div className="category-logo-preview">
                  {logoPreview
                    ? <img src={logoPreview} alt={`${category.name} category image preview`} />
                    : <FolderTree size={21} aria-hidden="true" />}
                </div>
                <input
                  ref={(element) => { logoInputRefs.current[category.id] = element; }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  aria-label={`Choose a new logo image for ${category.name}`}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void chooseCategoryLogo(category.id, file);
                  }}
                  disabled={Boolean(busy)}
                  hidden
                />
                <button className="button small ghost category-logo-button" type="button" onClick={() => logoInputRefs.current[category.id]?.click()} disabled={Boolean(busy)}>
                  <ImagePlus size={13} />{logoPreview ? "Change logo" : "Add logo"}
                </button>
              </div>
              <div className="category-card-details">
                <div className="category-card-title">
                  <b className="font-display" style={{ fontSize: 15 }}>{category.name}</b>
                  <span className={`status-badge ${category.active ? "green" : "amber"}`}>{category.active ? "Active" : "Hidden"}</span>
                </div>
                <div className="tag">/{category.slug} · {category.subcategories?.length || 0} subcategories · order {category.display_order}</div>
                {category.description && <p className="helper" style={{ margin: "9px 0" }}>{category.description}</p>}
                <p className="field-note category-logo-note">Department image · JPEG, PNG, WebP or AVIF · maximum 5 MB</p>
                {logoDraft && <div className="category-logo-save-row">
                  <span className="tag">New image ready: {logoDraft.file.name}</span>
                  <button className="button small primary" type="button" onClick={() => void saveCategoryLogo(category)} disabled={Boolean(busy)}>
                    {busy === category.id ? <><LoaderCircle size={13} />Saving…</> : <><Save size={13} />Save logo</>}
                  </button>
                </div>}
              </div>
              <div className="actions category-admin-actions">
                <button className="button small" disabled={Boolean(busy)} onClick={() => void saveCategory(category.id, { active: !category.active })}>{category.active ? "Deactivate" : "Activate"}</button>
                <button className="button small ghost" disabled={Boolean(busy)} aria-label={`Move ${category.name} earlier`} onClick={() => void saveCategory(category.id, { display_order: Math.max(0, category.display_order - 1) })}>↑</button>
                <button className="button small ghost" disabled={Boolean(busy)} aria-label={`Move ${category.name} later`} onClick={() => void saveCategory(category.id, { display_order: category.display_order + 1 })}>↓</button>
              </div>
            </div>
            <div className="subtle-divider" style={{ margin: "15px 0 8px" }} />
            <div className="stack" style={{ gap: 7 }}>
              {[...(category.subcategories || [])].sort((a, b) => a.display_order - b.display_order).map((subcategory) => <div className="stat-line" key={subcategory.id}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Tag size={13} />{subcategory.name}<small className="tag">/{subcategory.slug}</small></span>
                <button className={`button small ${subcategory.active ? "ghost" : ""}`} disabled={Boolean(busy)} onClick={() => void toggleSubcategory(subcategory)}>{subcategory.active ? "Active" : "Inactive"}</button>
              </div>)}
            </div>
            <form onSubmit={(event) => void addSubcategory(event, category.id)} className="actions category-add-subcategory">
              <input className="input" value={newSub[category.id] || ""} onChange={(event) => setNewSub((current) => ({ ...current, [category.id]: event.target.value }))} placeholder="New subcategory" />
              <button className="button small primary" disabled={Boolean(busy) || !newSub[category.id]?.trim()}><Plus size={13} />Add</button>
            </form>
          </section>;
        })}
        {!rows.length && !loading && <div className="card empty-state"><div className="empty-icon"><FolderTree size={20} /></div><strong>No categories returned</strong><p>Check Supabase connection and admin database permissions. No categories are fabricated here.</p></div>}
      </div>

      <aside className="card" style={{ height: "fit-content" }}>
        <div className="section-title"><h2>Add department</h2><span className="status-badge">Shared table</span></div>
        <p className="helper">The existing storefront renders its configured department slugs. New departments require the approved storefront taxonomy changes before products will show there.</p>
        <form onSubmit={(event) => void addCategory(event)} className="stack" style={{ marginTop: 17 }}>
          <div className="field"><label>Department name</label><input className="input" required value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="Department name" /></div>
          <div className="field"><label>Slug preview</label><input className="input" value={slugify(newCategory.name)} readOnly placeholder="generated-from-name" /></div>
          <div className="field"><label>Description</label><textarea className="textarea" value={newCategory.description} onChange={(event) => setNewCategory((current) => ({ ...current, description: event.target.value }))} placeholder="Short, accurate category description" /></div>
          <div className="field"><label>Category image URL</label><input className="input" type="url" value={newCategory.image_url} onChange={(event) => setNewCategory((current) => ({ ...current, image_url: event.target.value }))} placeholder="https://… or existing public storage URL" /></div>
          <button className="button primary" disabled={busy === "new-category"}><Save size={14} />Add category</button>
        </form>
      </aside>
    </div>
  </>;
}
