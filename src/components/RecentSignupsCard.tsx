"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/config";
import { safeError } from "@/lib/format";

type Signup = { id: string; email: string | null; full_name: string; created_at: string };

export function RecentSignupsCard() {
  const [rows, setRows] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    if (!SUPABASE_CONFIGURED) {
      setRows([]);
      setError("Connect Supabase to view user signups.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await getSupabaseBrowserClient().rpc("nextvo_admin_list_customers", {
        p_query: null,
        p_limit: 5,
        p_offset: 0
      });
      if (queryError) throw queryError;
      if (currentRequest === requestId.current) setRows((data || []) as Signup[]);
    } catch (e) {
      if (currentRequest === requestId.current) {
        setRows([]);
        setError(`${safeError(e)} Apply the admin SQL setup to enable the guarded signup directory.`);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  return <section className="card" style={{ marginTop: 18 }}>
    <div className="section-title">
      <div><h2>Recent signups</h2><small>Newest user accounts · Supabase Auth creation time</small></div>
      <div className="actions">
        <button className="button small ghost" onClick={() => void load()} disabled={loading}><RefreshCw size={13} />Refresh</button>
        <Link className="button small ghost" href="/customers">All accounts <ArrowUpRight size={13} /></Link>
      </div>
    </div>
    {error ? <div className="notice error"><Users size={16} /><div>{error}</div></div> : rows.length ? <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>User</th><th>Email</th><th>Signed up</th></tr></thead>
        <tbody>{rows.map((signup) => <tr key={signup.id}>
          <td data-label="User"><div className="product-cell"><div className="avatar">{(signup.full_name?.[0] || signup.email?.[0] || "?").toUpperCase()}</div><b>{signup.full_name || "Name not provided"}</b></div></td>
          <td data-label="Email">{signup.email || "—"}</td>
          <td data-label="Signed up">{new Date(signup.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="empty-state">
      <div className="empty-icon"><Users size={20} /></div>
      <strong>{loading ? "Loading recent signups…" : "No user accounts have signed up yet"}</strong>
      <p>New accounts appear here by signup time. Passwords and tokens are never shown.</p>
    </div>}
  </section>;
}
