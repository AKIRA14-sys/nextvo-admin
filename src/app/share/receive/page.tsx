"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock3, ExternalLink } from "lucide-react";
import {
  PRODUCT_HANDOFF_SESSION_KEY,
  validateProductHandoffPayload,
} from "@/lib/product-handoff";

export default function ReceiveSharedProductDraftPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Checking the shared draft…");
  const [error, setError] = useState("");

  useEffect(() => {
    let draftText: string | null = null;
    try {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      draftText = fragment.get("draft");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (!draftText) throw new Error("No product draft was included in the share.");
      const draft = validateProductHandoffPayload(JSON.parse(draftText));
      if (!draft) throw new Error("This shared draft is invalid or expired. Return to the Android app and send it again.");
      window.sessionStorage.setItem(PRODUCT_HANDOFF_SESSION_KEY, JSON.stringify(draft));
      setStatus(`Received ${draft.sources.length} supplier source${draft.sources.length === 1 ? "" : "s"}. Opening the existing product editor…`);
      router.replace("/products/new?handoff=1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The shared draft could not be opened.");
      setStatus("");
    }
  }, [router]);

  return <main className="login-page"><section className="login-card">
    <div className="eyebrow">NEXTVO ADMIN · PRODUCT HANDOFF</div>
    {error ? <>
      <h1 className="login-title">Draft not received</h1>
      <p className="login-subtitle">{error}</p>
      <div className="actions">
        <Link className="button primary" href="/import"><ExternalLink size={15}/>Open Import</Link>
        <Link className="button ghost" href="/login">Sign in</Link>
      </div>
      <p className="field-note" style={{ marginTop: 16 }}>This transfer is temporary. No draft was saved to the server.</p>
    </> : <>
      <h1 className="login-title">Product draft received</h1>
      <p className="login-subtitle">{status}</p>
      <div className="notice"><Check size={16}/><span>The draft is held only in this browser tab for review. It expires after ten minutes and is not saved to the server until you use the product editor.</span></div>
      <p className="field-note" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 14 }}><Clock3 size={13}/> Supplier fields still need review; selling price and local sourcing cost remain blank.</p>
    </>}
  </section></main>;
}
