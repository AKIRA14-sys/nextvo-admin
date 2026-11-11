"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { RefreshCw, Save, Settings } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { STORE_CURRENCY, STORE_NAME, SUPABASE_CONFIGURED } from "@/lib/supabase/config";
import { safeError } from "@/lib/format";

type SettingsForm = {
  store_name: string;
  currency: string;
  contact_email: string;
  contact_phone: string;
  announcement: string;
  store_available: boolean;
  low_stock_threshold: number;
  shipping_note: string;
};
type SettingRow = { key: string; value: unknown };

const initialSettings: SettingsForm = {
  store_name: STORE_NAME,
  currency: STORE_CURRENCY,
  contact_email: "",
  contact_phone: "",
  announcement: "",
  store_available: true,
  low_stock_threshold: 5,
  shipping_note: "",
};

function parseSettings(value: unknown): Partial<SettingsForm> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.store_name === "string" ? { store_name: record.store_name } : {}),
    ...(typeof record.currency === "string" ? { currency: record.currency } : {}),
    ...(typeof record.contact_email === "string" ? { contact_email: record.contact_email } : {}),
    ...(typeof record.contact_phone === "string" ? { contact_phone: record.contact_phone } : {}),
    ...(typeof record.announcement === "string" ? { announcement: record.announcement } : {}),
    ...(typeof record.store_available === "boolean" ? { store_available: record.store_available } : {}),
    ...(typeof record.low_stock_threshold === "number" && Number.isFinite(record.low_stock_threshold) ? { low_stock_threshold: record.low_stock_threshold } : {}),
    ...(typeof record.shipping_note === "string" ? { shipping_note: record.shipping_note } : {}),
  };
}

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(initialSettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function load() {
      if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
      const { data, error: loadError } = await getSupabaseBrowserClient().from("nextvo_store_settings").select("key,value");
      if (!loadError && data) {
        for (const row of data as SettingRow[]) {
          if (row.key === "general") setForm((current) => ({ ...current, ...parseSettings(row.value) }));
        }
      } else if (loadError) {
        setError(`${safeError(loadError)} Apply Admin SQL setup to enable private settings storage.`);
      }
      setLoading(false);
    }
    void load();
  }, []);

  function setField<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.store_name.trim()) {
      setError("Enter a store name for the Admin reference settings.");
      return;
    }
    if (!Number.isInteger(form.low_stock_threshold) || form.low_stock_threshold < 1) {
      setError("Low stock threshold must be a positive whole number.");
      return;
    }
    setBusy(true);
    try {
      const { error: saveError } = await getSupabaseBrowserClient().from("nextvo_store_settings").upsert({
        key: "general",
        value: form,
        updated_at: new Date().toISOString(),
      });
      if (saveError) setError(`Settings were not saved: ${safeError(saveError)}`);
      else setSuccess("Settings saved in the Admin-only Supabase table; the storefront does not read them.");
    } catch (caught) {
      setError(`Settings could not be saved: ${safeError(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">ADMIN-ONLY CONFIGURATION</div><h1>Admin settings</h1><p>Saved privately for Admin reference; these values do not currently control the storefront.</p></div>
      <button className="button ghost" type="button" onClick={() => location.reload()}><RefreshCw size={15}/>Reload</button>
    </div>
    {error && <div className="notice error" role="alert" style={{ marginBottom: 15 }}>{error}</div>}
    {success && <div className="notice success" role="status" style={{ marginBottom: 15 }}>{success}</div>}
    <div className="notice warn" style={{ marginBottom: 16 }}><Settings size={16}/><div>The current storefront does not read this Admin settings table. Store name, currency, contact details, announcement, shipping note, stock threshold and availability changes remain Admin-only until a separate storefront integration is approved and implemented.</div></div>
    {loading ? <div className="card loading-skeleton" style={{ height: 370 }} /> : <form className="card" onSubmit={save}>
      <div className="section-title"><h2>General details</h2><span className="status-badge amber">Admin-only until synced</span></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="settings-store-name">Store name</label><input id="settings-store-name" className="input" value={form.store_name} onChange={(event) => setField("store_name", event.target.value)} /></div>
        <div className="field"><label htmlFor="settings-currency">Store currency</label><select id="settings-currency" className="select" value={form.currency} onChange={(event) => setField("currency", event.target.value)}>{["NGN", "USD", "GBP", "EUR"].map((currency) => <option key={currency}>{currency}</option>)}</select></div>
        <div className="field"><label htmlFor="settings-contact-email">Contact email</label><input id="settings-contact-email" className="input" type="email" value={form.contact_email} onChange={(event) => setField("contact_email", event.target.value)} /></div>
        <div className="field"><label htmlFor="settings-contact-phone">Contact phone</label><input id="settings-contact-phone" className="input" type="tel" value={form.contact_phone} onChange={(event) => setField("contact_phone", event.target.value)} /></div>
        <div className="field full"><label htmlFor="settings-announcement">Store announcement</label><textarea id="settings-announcement" className="textarea" value={form.announcement} onChange={(event) => setField("announcement", event.target.value)} placeholder="Optional announcement" /></div>
        <div className="field full"><label htmlFor="settings-shipping-note">Shipping/delivery note</label><textarea id="settings-shipping-note" className="textarea" value={form.shipping_note} onChange={(event) => setField("shipping_note", event.target.value)} /></div>
        <div className="field"><label htmlFor="settings-stock-threshold">Low stock threshold</label><input id="settings-stock-threshold" className="input" type="number" min="1" step="1" value={form.low_stock_threshold} onChange={(event) => setField("low_stock_threshold", Number(event.target.value))} /></div>
        <div className="field"><label htmlFor="settings-store-availability">Store availability (Admin-only)</label><select id="settings-store-availability" className="select" value={String(form.store_available)} onChange={(event) => setField("store_available", event.target.value === "true")}><option value="true">Available</option><option value="false">Unavailable (not enforced on storefront)</option></select></div>
      </div>
      <div className="actions" style={{ marginTop: 18 }}><button className="button primary" disabled={busy || !SUPABASE_CONFIGURED}><Save size={15}/>{busy ? "Saving…" : "Save Admin settings"}</button></div>
    </form>}
  </>;
}
