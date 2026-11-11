"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const router = useRouter(); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); if (password.length < 10) { setError("Use at least 10 characters for a stronger password."); return; } if (password !== confirm) { setError("The passwords do not match."); return; } setBusy(true); try { const { error } = await getSupabaseBrowserClient().auth.updateUser({ password }); if (error) throw error; router.replace("/login?password=updated"); } catch (e) { setError(e instanceof Error ? e.message : "Password could not be updated."); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-card"><div className="login-brand"><div className="brand-mark">NEXT<span>VO</span></div><span className="brand-caption">Admin</span></div><div className="eyebrow">ACCOUNT RECOVERY</div><h1 className="login-title">Choose a new password</h1><p className="login-subtitle">The reset link must be open and valid in this browser.</p>{error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}<form className="login-form" onSubmit={submit}><div className="field"><label htmlFor="password">New password</label><input id="password" className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></div><div className="field"><label htmlFor="confirm">Confirm password</label><input id="confirm" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div><button className="button primary" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form></section></main>;
}
