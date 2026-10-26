import { defaultCache } from "@serwist/next/worker";
import { Serwist, Strategy, type RuntimeCaching } from "serwist";
import { isUserDataCache, SESSION_CACHE, SESSION_MARKER_PATH } from "@/lib/offlineOwner";
import { createSessionCachePlugin } from "@/lib/swSessionPlugin";

declare const self: typeof globalThis & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[];
};

// #424 — the signed-in user's marker, written by OfflineSessionGuard and
// removed on sign-out. Read per request: it's one small cache lookup.
async function readSessionMarker(): Promise<unknown> {
  const cache = await caches.open(SESSION_CACHE);
  const res = await cache.match(SESSION_MARKER_PATH);
  return res ? res.json() : null;
}

const sessionPlugin = createSessionCachePlugin(readSessionMarker);

// Scope every cache that can hold signed-in content to the current session
// (see swSessionPlugin.ts); static asset caches are left as they are.
const runtimeCaching: RuntimeCaching[] = defaultCache.map((entry) => {
  const { handler } = entry;
  if (handler instanceof Strategy && isUserDataCache(handler.cacheName)) {
    handler.plugins.push(sessionPlugin);
  }
  return entry;
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();
