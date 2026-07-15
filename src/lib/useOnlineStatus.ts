import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

// `navigator.onLine` in a WebView is known to false-positive (e.g. connected
// to Wi-Fi with no real internet, captive portals) — inside the native
// Android/iOS shell, prefer @capacitor/network's actual connectivity check.
// Falls back to the standard browser online/offline events everywhere else
// (plain web/PWA), where @capacitor/core's isNativePlatform() is just false.
export function useOnlineStatus(): boolean {
  // Always starts true, matching SSR output (no `navigator` there) — corrected
  // in the effect below, which only runs post-hydration, so the first client
  // render still matches the server-rendered HTML (avoids a hydration warning
  // if the client happens to be offline on first paint).
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      let cancelled = false;
      Network.getStatus().then((status) => {
        if (!cancelled) setOnline(status.connected);
      });
      const listenerPromise = Network.addListener("networkStatusChange", (status) => {
        setOnline(status.connected);
      });
      return () => {
        cancelled = true;
        listenerPromise.then((listener) => listener.remove());
      };
    }

    queueMicrotask(() => setOnline(navigator.onLine));
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
