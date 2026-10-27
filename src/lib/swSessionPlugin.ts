import type { SerwistPlugin } from "serwist";
import { isValidSessionMarker, ownerScopedCacheKey, type SessionMarker } from "@/lib/offlineOwner";

// #424 — a plugin for every service-worker cache that holds signed-in
// content. With no live session marker (signed out, or the session expired)
// nothing is read from or written to those caches, so a signed-out visitor
// is never served a cached authenticated page. With one, entries are keyed
// by the marker's user, so one user's lookups never match another's.
export function createSessionCachePlugin(
  readMarker: () => Promise<unknown>,
  now: () => number = Date.now,
): SerwistPlugin {
  async function currentMarker(): Promise<SessionMarker | null> {
    try {
      const marker = await readMarker();
      return isValidSessionMarker(marker, now()) ? marker : null;
    } catch {
      return null;
    }
  }

  return {
    cacheKeyWillBeUsed: async ({ request }) => {
      const marker = await currentMarker();
      if (!marker) return request;
      return new Request(ownerScopedCacheKey(request.url, marker.userId), { headers: request.headers });
    },
    cacheWillUpdate: async ({ response }) => ((await currentMarker()) ? response : null),
    cachedResponseWillBeUsed: async ({ cachedResponse }) =>
      (await currentMarker()) ? (cachedResponse ?? null) : null,
  };
}
