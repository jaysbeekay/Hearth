import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function getListeners(key: string) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

// Backs a "dismiss this banner" localStorage flag with useSyncExternalStore
// so the dismissed state can be read after mount without setState-in-effect —
// the server/pre-hydration snapshot always assumes dismissed to avoid a
// flash of the banner before we know the real value.
export function useDismissible(key: string): [dismissed: boolean, dismiss: () => void] {
  const subscribe = useCallback((callback: () => void) => {
    const set = getListeners(key);
    set.add(callback);
    return () => set.delete(callback);
  }, [key]);

  const getSnapshot = useCallback(() => localStorage.getItem(key) === "1", [key]);
  const getServerSnapshot = useCallback(() => true, []);

  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismiss = useCallback(() => {
    localStorage.setItem(key, "1");
    for (const callback of getListeners(key)) callback();
  }, [key]);

  return [dismissed, dismiss];
}
