import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

// Detects when a component has hydrated on the client, e.g. to gate
// createPortal() calls that would otherwise fail during SSR, or to keep a
// form's submit button disabled until hydration (SubmitButton's
// disabledUntilHydrated, #609) so a click can't submit natively first. The
// server snapshot must stay false: that is what puts `disabled` in the
// server-rendered HTML.
export function useHasMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
