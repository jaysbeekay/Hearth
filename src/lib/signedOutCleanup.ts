import type { SessionCheck } from "@/lib/pushClient";

// #576 — the sign-in page's cleanup, kept free of the browser so the gate
// can be tested on its own. See SignedOutCacheCleanup for what each step does.

export interface SignedOutCleanupDeps {
  /** Who `/api/auth/session` says is signed in; null when it couldn't be asked. */
  readSession: () => Promise<SessionCheck>;
  /** Drops the cached pages, the service worker's marker, offline Documents and cached lists. */
  clear: () => Promise<void>;
  /** Tells this browser's other tabs that nobody is signed in. */
  broadcast: () => void;
  /** Starts the push cleanup, handed the answer the gate got. */
  startPush: (first: SessionCheck) => void;
}

/**
 * Asks once whether anyone is signed in, before doing anything:
 * - signed in (Back to a cached sign-in page): nothing is cleared, no tab is
 *   told, push is left alone;
 * - signed out, or the server couldn't be asked (most likely offline, after
 *   a sign-out): the other tabs are told, the data is cleared, and only then
 *   does the push cleanup start, since the clear deletes the marker it may
 *   write.
 */
export async function runSignedOutCleanup(deps: SignedOutCleanupDeps): Promise<"kept" | "cleared"> {
  const session = await deps.readSession().catch((): SessionCheck => null);
  if (session?.signedIn) return "kept";
  deps.broadcast();
  await deps.clear().catch(() => {});
  deps.startPush(session);
  return "cleared";
}

/**
 * A session reader that answers its first ask with `first`, the gate's
 * answer, so the push cleanup doesn't ask the server again straight away.
 * An unknown answer isn't reused: the first ask then goes to the server.
 */
export function reuseFirstSession(first: SessionCheck, read: () => Promise<SessionCheck>): () => Promise<SessionCheck> {
  let pending = first;
  return () => {
    if (pending === null) return read();
    const answer = pending;
    pending = null;
    return Promise.resolve(answer);
  };
}
