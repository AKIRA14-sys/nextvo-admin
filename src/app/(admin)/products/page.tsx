"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Eye, MessageCircle, Package, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { STOREFRONT_URL, SUPABASE_CONFIGURED } from "@/lib/supabase/config";
import { formatMoney, safeError } from "@/lib/format";
import { createRefreshQueue } from "@/lib/refresh-queue";

type Product = { id: string; slug: string; name: string; price_ngn: number; compare_at_price_ngn: number | null; image_url: string | null; stock_quantity: number; active: boolean; created_at: string; currency_code: string; brand: string | null };
type Details = { product_id: string; status: string };
const filters = ["All", "Published", "Draft", "Unpublished", "Unavailable", "Out of stock"];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]); const [details, setDetails] = useState<Record<string, Details>>({}); const [filter, setFilter] = useState("All"); const [search, setSearch] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null); const [missingSetup, setMissingSetup] = useState(false); const [page, setPage] = useState(0); const [hasMore, setHasMore] = useState(false); const loadId = useRef(0);
  const load = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    const requestId = ++loadId.current;
    setLoading(true);
    setError("");
    try {
      const db = getSupabaseBrowserClient();
      const start = page * 50;
      const { data, error: queryError } = await db.from("products")
        .select("id,slug,name,price_ngn,compare_at_price_ngn,image_url,stock_quantity,active,created_at,currency_code,brand")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + 50);
      if (requestId !== loadId.current) return;
      if (queryError) throw queryError;
      const rows = ((data || []) as Product[]).slice(0, 50);
      let privateDetails: Record<string, Details> = {};
      let missing = false;
      if (rows.length) {
        const result = await db.from("nextvo_admin_product_details").select("product_id,status").in("product_id", rows.map((product) => product.id));
        if (requestId !== loadId.current) return;
        missing = Boolean(result.error);
        if (!missing) privateDetails = Object.fromEntries(((result.data || []) as Details[]).map((detail) => [detail.product_id, detail]));
      }
      setProducts(rows);
      setHasMore((data || []).length > 50);
      setDetails(privateDetails);
      setMissingSetup(missing);
    } catch (caught) {
      if (requestId === loadId.current) setError(`Catalogue refresh failed; displayed records may be older. ${safeError(caught)}`);
    } finally {
      if (requestId === loadId.current) setLoading(false);
    }
  }, [page]);
  const refresh = useMemo(() => createRefreshQueue(load), [load]);
  useEffect(() => {
    refresh.activate();
    void refresh.run();
    const requestCounter = loadId;
    if (!SUPABASE_CONFIGURED) return () => refresh.dispose();
    const db = getSupabaseBrowserClient();
    const schedule = () => { if (document.visibilityState === "visible") refresh.schedule(); };
    const channel = db.channel("products-list-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "nextvo_admin_product_details" }, schedule).subscribe();
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => { refresh.dispose(); ++requestCounter.current; window.removeEventListener("focus", schedule); document.removeEventListener("visibilitychange", schedule); void db.removeChannel(channel); };
  }, [refresh]);
  const shown = useMemo(() => products.filter((p) => { const status = details[p.id]?.status || (p.active ? "published" : "unpublished"); const matched = !search || `${p.name} ${p.slug} ${p.brand || ""}`.toLowerCase().includes(search.toLowerCase()); const byFilter = filter === "All" || (filter === "Published" && status === "published") || (filter === "Draft" && status === "draft") || (filter === "Unpublished" && status === "unpublished") || (filter === "Unavailable" && status === "unavailable") || (filter === "Out of stock" && p.stock_quantity <= 0); return matched && byFilter; }), [products, details, filter, search]);
  async function toggle(p: Product) {
    const next = p.active ? "unpublished" : "published";
    setBusy(p.id);
    setError("");
    try {
      const { error } = await getSupabaseBrowserClient().rpc("nextvo_admin_set_product_status", {
        p_product_id: p.id,
        p_status: next,
      });
      if (error) throw error;
      setProducts((rows) => rows.map((row) => row.id === p.id ? { ...row, active: next === "published" } : row));
      setDetails((current) => ({ ...current, [p.id]: { product_id: p.id, status: next } }));
      refresh.schedule();
    } catch (caught) {
      setError(`No status change was confirmed: ${safeError(caught)}`);
    } finally {
      setBusy(null);
    }
  }
  async function remove(p: Product) { if (!window.confirm(`Permanently delete “${p.name}”? This also removes its variants and image records. This cannot be undone.`)) return; setBusy(p.id); try { const { error } = await getSupabaseBrowserClient().from("products").delete().eq("id", p.id); if (error) throw error; await load(); } catch (e) { setError(safeError(e)); } finally { setBusy(null); } }
  async function copyLink(p: Product) { const href = `${STOREFRONT_URL}/products/${p.slug}`; if (!STOREFRONT_URL) { setError("Set NEXT_PUBLIC_STOREFRONT_URL in the Admin deployment to enable product sharing."); return; } try { await navigator.clipboard.writeText(href); } catch { setError("Could not access clipboard. Copy the product URL from the edit screen instead."); } }
  return <><div className="page-heading"><div><div className="eyebrow">SHARED CATALOGUE</div><h1>Products</h1><p>Manage real NEXTVO catalogue records. Publishing controls public visibility.</p></div><div className="actions"><button className="button ghost" onClick={() => void refresh.run()} disabled={loading}><RefreshCw size={15}/>Refresh</button><Link href="/products/new" className="button primary"><Plus size={15}/>Add product</Link></div></div>
    {!SUPABASE_CONFIGURED && <div className="notice warn" style={{ marginBottom: 16 }}><Package size={17}/><div>Connect Supabase in Vercel to read and manage the shared product catalogue. No placeholder products are included.</div></div>}
    {missingSetup && <div className="notice warn" style={{ marginBottom: 16 }}><Package size={17}/><div>Private publishing details are unavailable. Apply <code>supabase/admin-setup.sql</code> to enable draft and unpublished tracking.</div></div>}
    {error && <div className="notice error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
    <div className="toolbar"><div className="search-box"><Search size={16}/><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or slug…" /></div><div className="pill-row">{filters.map((f) => <button className={`pill${filter === f ? " active" : ""}`} key={f} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
    <div className="card" style={{ padding: 12 }}><div className="section-title" style={{ padding: "4px 6px 7px" }}><h2>{loading ? "Loading catalogue…" : `${shown.length} product${shown.length === 1 ? "" : "s"}`}</h2><span className="tag">Page {page + 1} · filters/search on this page only</span></div>{shown.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Share / actions</th></tr></thead><tbody>{shown.map((p) => { const status = details[p.id]?.status || (p.active ? "published" : "unpublished"); const statusTone = status === "published" ? "green" : status === "unavailable" ? "red" : "amber"; const href = STOREFRONT_URL ? `${STOREFRONT_URL}/products/${p.slug}` : ""; return <tr key={p.id}><td data-label="Product"><div className="product-cell">{p.image_url ? <img className="product-thumb" src={p.image_url} alt=""/> : <div className="product-thumb empty"><Package size={17}/></div>}<div><Link href={`/products/${p.id}`}><b>{p.name}</b></Link><div className="tag">{p.slug}</div></div></div></td><td data-label="Price" className="money">{formatMoney(p.price_ngn, p.currency_code)}{p.compare_at_price_ngn ? <div className="tag" style={{ textDecoration: "line-through" }}>{formatMoney(p.compare_at_price_ngn,p.currency_code)}</div> : null}</td><td data-label="Stock">{p.stock_quantity ?? 0}</td><td data-label="Status"><span className={`status-badge ${statusTone}`}>{status}</span></td><td data-label="Actions"><div className="actions"><Link className="button small" href={`/products/${p.id}`} aria-label="Edit product"><Eye size={14}/>Edit</Link><button className="button small" disabled={busy === p.id} onClick={() => toggle(p)}>{busy === p.id ? "Saving…" : p.active ? "Unpublish" : "Publish"}</button>{href && <><button className="button small ghost" onClick={() => copyLink(p)} title="Copy storefront link"><Copy size={14}/></button><a className="button small ghost" href={`https://wa.me/?text=${encodeURIComponent(`${p.name} — ${href}`)}`} target="_blank" rel="noreferrer" aria-label="Share on WhatsApp"><MessageCircle size={14}/></a><a className="button small ghost" href={href} target="_blank" rel="noreferrer" aria-label="Preview product"><ExternalLink size={14}/></a></>}{!p.active && <button className="button small danger" onClick={() => remove(p)} aria-label="Delete product"><Trash2 size={14}/></button>}</div></td></tr>; })}</tbody></table></div> : <div className="empty-state"><div className="empty-icon"><Package size={20}/></div><strong>{loading ? "Loading catalogue…" : search || filter !== "All" ? "No matching products on this page" : "No products yet"}</strong><p>{loading ? "Reading the shared store catalogue." : search || filter !== "All" ? "Try another search or status filter, or browse another page." : "Start building the catalogue with your first real product. No sample inventory is shown."}</p>{!loading && !products.length && <Link href="/products/new" className="button primary" style={{ marginTop: 10 }}><Plus size={15}/>Add product</Link>}</div>}<div className="actions" style={{ justifyContent: "flex-end", marginTop: 12 }}><button className="button small" disabled={loading || page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous page</button><button className="button small" disabled={loading || !hasMore} onClick={() => setPage((p) => p + 1)}>Next page</button></div></div>
  </>;
}
