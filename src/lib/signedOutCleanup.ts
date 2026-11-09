import type { SessionCheck } from "@/lib/pushClient";

// #576 — the sign-in page's cleanup, kept free of the browser so the gate
// can be tested on its own. See SignedOutCacheCleanup for what each step does.

export interface SignedOutCleanupDeps {
  /** Who `/api/auth/session` says is signed in; null when it couldn't be asked. */
  readSession: () => Promise<SessionCheck>;
  /** Whether the sign-in page has been left (a client-side navigation) since the cleanup began. */
  hasLeft: () => boolean;
  /** Drops the cached pages, the service worker's marker, offline Documents and cached lists. */
  clear: () => Promise<void>;
  /** Tells this browser's other tabs that nobody is signed in. */
  broadcast: () => void;
  /** Starts the push cleanup. */
  startPush: () => void;
}

async function isSignedIn(deps: SignedOutCleanupDeps): Promise<boolean> {
  const session = await deps.readSession().catch((): SessionCheck => null);
  return session?.signedIn === true;
}

/**
 * Asks whether anyone is signed in before doing anything:
 * - signed in (Back to a cached sign-in page): nothing is cleared, no tab is
 *   told, push is left alone;
 * - signed out, or the server couldn't be asked (most likely offline, after
 *   a sign-out): the other tabs are told, the data is cleared, and only then
 *   does the push cleanup start, since the clear deletes the marker it may
 *   write.
 * If the page was left while the answer was on its way, most likely by
 * signing in from it, that answer may predate the sign-in, so it asks once
 * more: clearing then would take the new session's marker and pages, and
 * reload its other tabs.
 */
export async function runSignedOutCleanup(deps: SignedOutCleanupDeps): Promise<"kept" | "cleared"> {
  if (await isSignedIn(deps)) return "kept";
  if (deps.hasLeft() && (await isSignedIn(deps))) return "kept";
  deps.broadcast();
  await deps.clear().catch(() => {});
  deps.startPush();
  return "cleared";
}
