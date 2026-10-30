import { Strategy, type RuntimeCaching, type SerwistPlugin } from "serwist";
import {
  isUserDataCache,
  isValidSessionMarker,
  ownerScopedCacheKey,
  type SessionMarker,
} from "@/lib/offlineOwner";

// #424 — a plugin for every service-worker cache that holds signed-in
// content. With no live session marker (signed out, or the session expired)
// nothing is read from or written to those caches, so a signed-out visitor
// is never served a cached authenticated page. With one, entries are keyed
// by the marker's user, so one user's lookups never match another's.
//
// A session revoked on the server (role change, password reset elsewhere)
// can't reach a device that's offline: until it reconnects, its cache stays
// readable for the marker's user, bounded by the session's expiry and the
// caches' own 24h expiration.
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

/** Adds `plugin` to every runtime-caching strategy whose cache holds signed-in content. */
export function scopeRuntimeCaching(entries: RuntimeCaching[], plugin: SerwistPlugin): RuntimeCaching[] {
  for (const { handler } of entries) {
    if (handler instanceof Strategy && isUserDataCache(handler.cacheName) && !handler.plugins.includes(plugin)) {
      handler.plugins.push(plugin);
    }
  }
  return entries;
}
