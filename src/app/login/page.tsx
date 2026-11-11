"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isAuthorizedAdmin, SUPABASE_CONFIGURED } from "@/lib/supabase/config";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [rememberEmail,setRememberEmail]=useState(true);
  useEffect(()=>{const saved=localStorage.getItem("nextvo-admin-email");if(saved)setEmail(saved);setRememberEmail(localStorage.getItem("nextvo-admin-remember-email")!=="false");},[]);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    if (!SUPABASE_CONFIGURED) { setError("Add NEXT_PUBLIC_SUPABASE_URL and a publishable/anon key in Vercel, then redeploy."); setBusy(false); return; }
    try {
      try{if(rememberEmail){localStorage.setItem("nextvo-admin-email",email.trim());localStorage.setItem("nextvo-admin-remember-email","true");}else{localStorage.removeItem("nextvo-admin-email");localStorage.setItem("nextvo-admin-remember-email","false");}}catch{/* Storage may be disabled; authentication still proceeds. */}
      const { data, error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.user) throw authError || new Error("Sign-in failed.");
      if (!isAuthorizedAdmin(data.user)) { await getSupabaseBrowserClient().auth.signOut(); throw new Error("This account is authenticated but has not been granted an administrator role. Ask the project owner to authorize it server-side."); }
      router.replace("/dashboard"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in could not be completed."); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><div className="login-brand"><div className="brand-mark">NEXT<span>VO</span></div><span className="brand-caption">Admin</span></div><div className="eyebrow">PRIVATE STORE WORKSPACE</div><h1 className="login-title">Welcome back</h1><p className="login-subtitle">Sign in with an administrator account authorized for this store.</p>
    {params.get("setup") === "1" && !SUPABASE_CONFIGURED && <div className="notice warn" style={{ marginBottom: 14 }}><KeyRound size={16} />Supabase connection is not configured yet. Add the public URL and key in the Vercel project settings.</div>}
    {!SUPABASE_CONFIGURED && <div className="notice warn" style={{ marginBottom: 14 }}><KeyRound size={16} />Supabase connection variables are missing. The app will not show or change store data until configured.</div>}
    {error && <div className="form-error" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
    <form className="login-form" onSubmit={submit}><div className="field"><label htmlFor="email">Administrator email</label><input className="input" id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div><div className="field"><label htmlFor="password">Password</label><div style={{ position: "relative" }}><input className="input" id="password" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" style={{ paddingRight: 44 }} /><button type="button" className="icon-button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 3, top: 3 }} >{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div><div className="login-foot"><label className="checkbox"><input type="checkbox" checked={rememberEmail} onChange={e=>setRememberEmail(e.target.checked)} /> Remember my email on this device</label><Link href="/forgot-password" style={{ color: "#8daaff" }}>Forgot password?</Link></div><button className="button primary" type="submit" disabled={busy || !SUPABASE_CONFIGURED} style={{ width: "100%", height: 46, marginTop: 2 }}>{busy ? "Checking access…" : "Sign in securely"}</button></form><div className="subtle-divider" style={{ margin: "22px 0 14px" }} /><div style={{ display: "flex", gap: 8, alignItems: "center", color: "#75849c", fontSize: 10, lineHeight: 1.5 }}><ShieldCheck size={16} color="#6596ff" />Admin permissions are checked by Supabase Auth and database policies—not by a browser flag.</div></section></main>;
}
export default function LoginPage() { return <Suspense fallback={<main className="login-page"><div className="login-card loading-skeleton" style={{ height: 400 }} /></main>}><LoginForm /></Suspense>; }
