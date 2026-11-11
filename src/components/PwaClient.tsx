"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function PwaClient() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online ? null : <div className="notice warn" role="status"><WifiOff size={16} /> Offline — live data and saving are unavailable until your connection returns.</div>;
}
