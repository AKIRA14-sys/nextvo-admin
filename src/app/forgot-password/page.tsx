"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/config";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setMessage(""); try { if (!SUPABASE_CONFIGURED) throw new Error("Supabase is not configured."); const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback` }); if (error) throw error; setMessage("If an account exists for that address, a password-reset link has been sent."); } catch (e) { setError(e instanceof Error ? e.message : "Could not request a reset."); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-card"><div className="login-brand"><div className="brand-mark">NEXT<span>VO</span></div><span className="brand-caption">Admin</span></div><div className="eyebrow">ACCOUNT RECOVERY</div><h1 className="login-title">Reset your password</h1><p className="login-subtitle">Enter the administrator email address. The reset link returns to this app.</p>{error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}{message && <div className="form-success" style={{ marginBottom: 14 }}>{message}</div>}<form onSubmit={submit} className="login-form"><div className="field"><label htmlFor="email">Administrator email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div><button className="button primary" disabled={busy || !SUPABASE_CONFIGURED}>{busy ? "Sending…" : "Send reset link"}</button></form><Link href="/login" style={{ display: "block", marginTop: 18, color: "#8daaff", textAlign: "center", fontSize: 12 }}>Back to sign in</Link></section></main>;
}
