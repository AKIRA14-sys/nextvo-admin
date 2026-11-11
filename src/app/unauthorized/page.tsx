import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return <main className="error-page"><div className="card" style={{ maxWidth: 440 }}><div className="empty-icon" style={{ margin: "0 auto 16px" }}><ShieldAlert size={22} /></div><h1 className="font-display">Administrator access required</h1><p className="helper">This account does not have an administrator role. Access is assigned by the project owner on the backend.</p><div className="actions" style={{ justifyContent: "center", marginTop: 20 }}><Link className="button primary" href="/login">Return to sign in</Link></div></div></main>;
}
