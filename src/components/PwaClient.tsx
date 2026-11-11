"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";

export function PwaClient() {
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadForUpdate = useRef(false);

  useEffect(() => {
    let disposed = false;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onControllerChange = () => {
      if (reloadForUpdate.current) window.location.reload();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      void navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (disposed) return;
        if (registration.waiting && navigator.serviceWorker.controller) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (!disposed && installing.state === "installed" && navigator.serviceWorker.controller && registration.waiting) {
              setWaitingWorker(registration.waiting);
            }
          });
        });
      }).catch(() => undefined);
    }

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  function applyUpdate() {
    if (!waitingWorker) return;
    reloadForUpdate.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  return <>
    {!online && <div className="notice warn" role="status"><WifiOff size={16}/>Offline — live data and saving are unavailable until your connection returns.</div>}
    {waitingWorker && <div className="notice" role="status"><RefreshCw size={16}/><span>A NEXTVO Admin update is ready.</span><button className="button small" type="button" onClick={applyUpdate}>Reload to update</button></div>}
  </>;
}
