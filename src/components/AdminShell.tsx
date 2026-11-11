"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Bell, Boxes, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, CreditCard, FolderTree, House, LogOut, Menu, Package, Plus, Settings, ShieldCheck, Users, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PwaClient } from "@/components/PwaClient";

const nav = [
  { label: "Dashboard", href: "/dashboard", icon: House, group: "STORE" },
  { label: "Products", href: "/products", icon: Package, group: "STORE" },
  { label: "Import Products", href: "/import", icon: Plus, group: "STORE" },
  { label: "Categories", href: "/categories", icon: FolderTree, group: "STORE" },
  { label: "Inventory", href: "/inventory", icon: Boxes, group: "OPERATIONS" },
  { label: "Orders", href: "/orders", icon: ClipboardList, group: "OPERATIONS" },
  { label: "Payments", href: "/payments", icon: CreditCard, group: "OPERATIONS" },
  { label: "Customers", href: "/customers", icon: Users, group: "OPERATIONS" },
  { label: "Profit Calculator", href: "/profit", icon: CircleDollarSign, group: "INSIGHTS" },
  { label: "Analytics", href: "/analytics", icon: BarChart3, group: "INSIGHTS" },
  { label: "Store Settings", href: "/settings", icon: Settings, group: "MANAGE" },
  { label: "Admin Account", href: "/account", icon: ShieldCheck, group: "MANAGE" }
];
const bottomNav = [nav[0], nav[1], nav[5], nav[6]];

function Brand() { return <div className="brand"><div className="brand-mark">NEXT<span>VO</span></div><span className="brand-caption">Admin</span></div>; }
function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <div>{["STORE", "OPERATIONS", "INSIGHTS", "MANAGE"].map((group) => <div key={group} style={{ marginBottom: 17 }}><div className="side-label">{collapsed ? "···" : group}</div><div className="nav-stack">{nav.filter((item) => item.group === group).map((item) => { const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)); const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={onNavigate} title={collapsed ? item.label : undefined} className={`nav-link${active ? " active" : ""}`}><span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span>{!collapsed && <span className="nav-text">{item.label}</span>}</Link>; })}</div></div>)}</div>;
}

export function AdminShell({ children, email }: { children: React.ReactNode; email: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const current = nav.find((item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)))?.label || "Dashboard";
  const mobileItems = [...bottomNav, { label: "More", href: "#more", icon: Menu, group: "" }];
  async function logout() { await getSupabaseBrowserClient().auth.signOut({ scope: "local" }); router.replace("/login"); router.refresh(); }
  return <div className="admin-frame">
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}><Brand /><NavLinks collapsed={collapsed} /><div className="side-spacer" /><div className="sidebar-foot"><button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>{collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} /><span className="nav-text">Collapse sidebar</span></>}</button><button className="collapse-button" onClick={logout}><LogOut size={17} /><span className="nav-text">Sign out</span></button></div></aside>
    <div className={`main-area${collapsed ? " sidebar-collapsed" : ""}`}>
      <header className="topbar"><div className="topbar-left"><span className="topbar-title">Workspace</span><ChevronRight size={14} color="#5f6d84" /><b style={{ fontSize: 13 }}>{current}</b></div><div className="topbar-actions"><span className="connection"><i className="status-dot" /> Secure admin session</span><button className="icon-button" title="Notifications are not enabled in this version"><Bell size={18} /></button><div className="avatar" title={email}>{(email[0] || "A").toUpperCase()}</div></div></header>
      <div className="mobile-top"><button className="icon-button" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu size={21} /></button><div className="mobile-brand"><Brand /></div><div className="mobile-actions"><button className="icon-button" title="Notifications are not enabled in this version"><Bell size={18} /></button><div className="avatar" style={{ width: 31, height: 31 }}>{(email[0] || "A").toUpperCase()}</div></div></div>
      <PwaClient />
      <main className="content">{children}<div className="page-footer">NEXTVO Admin · Private workspace · No push notifications enabled</div></main>
    </div>
    <nav className="bottom-nav mobile-safe">{mobileItems.map((item) => { const Icon = item.icon; const active = item.href === "#more" ? !mobileItems.slice(0, 4).some((link) => pathname === link.href || pathname.startsWith(`${link.href}/`)) : pathname === item.href || pathname.startsWith(`${item.href}/`); return <button key={item.label} className={`bottom-link${active ? " active" : ""}`} onClick={() => item.href === "#more" ? setDrawer(true) : router.push(item.href)}><Icon size={20} strokeWidth={1.8} /><span>{item.label}</span></button>; })}</nav>
    {drawer && <><div className="drawer-backdrop" onClick={() => setDrawer(false)} /><div className="mobile-drawer"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Brand /><button className="icon-button" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={19} /></button></div><NavLinks onNavigate={() => setDrawer(false)} /><div className="subtle-divider" /><button className="collapse-button" onClick={logout}><LogOut size={17} /> Sign out</button></div></>}
  </div>;
}
