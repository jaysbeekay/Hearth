import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canQueueOffline,
  clearOfflineOwner,
  getOfflineOwner,
  isOwnedBy,
  isUserDataCache,
  isValidSessionMarker,
  OfflineStorageTimeoutError,
  ownerScopedCacheKey,
  setOfflineOwner,
  stuckSyncing,
  unownedToAdopt,
  withTimeout,
} from "@/lib/offlineOwner";
import type { SerwistPlugin } from "serwist";
import { createSessionCachePlugin } from "@/lib/swSessionPlugin";

// #424 — one user's offline data never reaches another on a shared device.

const alice = { userId: "alice", canWrite: true };
const reader = { userId: "reader", canWrite: false };

afterEach(() => clearOfflineOwner());

describe("offline owner", () => {
  it("keys entries to the signed-in user only", () => {
    expect(isOwnedBy("alice", alice)).toBe(true);
    expect(isOwnedBy("bob", alice)).toBe(false);
    // Unowned (pre-#424) entries aren't anyone's until claimed.
    expect(isOwnedBy(undefined, alice)).toBe(false);
    // Nobody signed in: nothing is anyone's.
    expect(isOwnedBy("alice", null)).toBe(false);
  });

  it("tracks the current owner and clears on sign-out", () => {
    expect(getOfflineOwner()).toBeNull();
    setOfflineOwner(alice);
    expect(getOfflineOwner()).toEqual(alice);
    setOfflineOwner(reader);
    expect(getOfflineOwner()).toEqual(reader);
    clearOfflineOwner();
    expect(getOfflineOwner()).toBeNull();
  });

  it("lets only a signed-in member who can write queue changes", () => {
    expect(canQueueOffline(alice)).toBe(true);
    expect(canQueueOffline(reader)).toBe(false);
    expect(canQueueOffline(null)).toBe(false);
  });
});

describe("pre-upgrade (unowned) entries", () => {
  const entries = [{ id: "1", ownerId: "alice" }, { id: "2" }, { id: "3", ownerId: "bob" }, { id: "4" }];

  it("are adopted by the first member who can write", () => {
    expect(unownedToAdopt(entries, alice).map((e) => e.id)).toEqual(["2", "4"]);
  });

  it("are never adopted by a read-only member (purged instead)", () => {
    expect(unownedToAdopt(entries, reader)).toEqual([]);
  });
});

describe("writes stuck mid-sync", () => {
  it("are the signed-in user's 'syncing' ops, to put back to pending", () => {
    const ops = [
      { id: "1", ownerId: "alice", status: "syncing" },
      { id: "2", ownerId: "alice", status: "pending" },
      { id: "3", ownerId: "bob", status: "syncing" },
      { id: "4", ownerId: "alice", status: "failed" },
    ];
    expect(stuckSyncing(ops, "alice").map((op) => op.id)).toEqual(["1"]);
  });
});

describe("withTimeout", () => {
  it("passes a result through", async () => {
    await expect(withTimeout(Promise.resolve(3), 50)).resolves.toBe(3);
  });

  it("rejects when the work stalls, instead of hanging", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(OfflineStorageTimeoutError);
  });

  it("passes a failure through", async () => {
    await expect(withTimeout(Promise.reject(new Error("blocked")), 50)).rejects.toThrow("blocked");
  });
});

describe("the production service worker's caches", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    vi.stubEnv("NODE_ENV", original ?? "test");
    vi.resetModules();
  });

  it("has the session plugin on every cache that holds signed-in content", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { defaultCache } = await import("@serwist/next/worker");
    const { Strategy } = await import("serwist");
    const { scopeRuntimeCaching } = await import("@/lib/swSessionPlugin");
    const plugin = createSessionCachePlugin(async () => null);

    const scoped = scopeRuntimeCaching(defaultCache, plugin);
    const strategies = scoped.map((e) => e.handler).filter((h): h is InstanceType<typeof Strategy> => h instanceof Strategy);
    const names = new Set(strategies.map((s) => s.cacheName));

    // The cache names this app clears and scopes are the ones serwist uses.
    for (const name of ["pages", "pages-rsc", "pages-rsc-prefetch", "apis", "others"]) {
      expect(names.has(name), name).toBe(true);
    }
    for (const strategy of strategies) {
      expect(strategy.plugins.includes(plugin), strategy.cacheName).toBe(isUserDataCache(strategy.cacheName));
    }
    // Running it twice doesn't add the plugin twice.
    scopeRuntimeCaching(defaultCache, plugin);
    for (const strategy of strategies) {
      expect(strategy.plugins.filter((p) => p === plugin).length).toBeLessThanOrEqual(1);
    }
  });
});


describe("service worker session scoping", () => {
  it("clears only the caches that hold signed-in content", () => {
    for (const name of ["pages", "pages-rsc", "pages-rsc-prefetch", "apis", "others", "hearth-session"]) {
      expect(isUserDataCache(name), name).toBe(true);
    }
    for (const name of ["serwist-precache-v2-https://hearth.local/", "next-static-js-assets", "static-style-assets", "static-font-assets"]) {
      expect(isUserDataCache(name), name).toBe(false);
    }
  });

  it("accepts only an unexpired marker with a user id", () => {
    const now = 1_000;
    expect(isValidSessionMarker({ userId: "alice", expires: 2_000 }, now)).toBe(true);
    expect(isValidSessionMarker({ userId: "alice", expires: 500 }, now)).toBe(false);
    expect(isValidSessionMarker({ userId: "", expires: 2_000 }, now)).toBe(false);
    expect(isValidSessionMarker(null, now)).toBe(false);
    expect(isValidSessionMarker("alice", now)).toBe(false);
  });

  it("gives each user a different cache key for the same page", () => {
    const url = "https://hearth.local/contracts/abc?tab=docs";
    const a = ownerScopedCacheKey(url, "alice");
    const b = ownerScopedCacheKey(url, "bob");
    expect(a).not.toBe(b);
    expect(new URL(a).searchParams.get("tab")).toBe("docs");
    expect(new URL(a).pathname).toBe("/contracts/abc");
  });

  const now = () => 1_000;
  const request = new Request("https://hearth.local/contracts/abc");
  const cached = new Response("cached admin page");
  type PluginEvent = Parameters<NonNullable<SerwistPlugin["cacheWillUpdate"]>>[0]["event"];
  const fakeEvent = {} as PluginEvent;

  async function plugin(marker: unknown) {
    return createSessionCachePlugin(async () => marker, now);
  }

  it("serves and stores nothing for a signed-out visitor", async () => {
    const p = await plugin(null);
    expect(await p.cachedResponseWillBeUsed!({ cacheName: "pages", request, cachedResponse: cached, event: fakeEvent })).toBeNull();
    expect(await p.cacheWillUpdate!({ request, response: cached, event: fakeEvent })).toBeNull();
  });

  it("serves and stores nothing once the session has expired", async () => {
    const p = await plugin({ userId: "alice", expires: 500 });
    expect(await p.cachedResponseWillBeUsed!({ cacheName: "pages", request, cachedResponse: cached, event: fakeEvent })).toBeNull();
    expect(await p.cacheWillUpdate!({ request, response: cached, event: fakeEvent })).toBeNull();
  });

  it("treats an unreadable marker as signed out", async () => {
    const p = createSessionCachePlugin(async () => {
      throw new Error("cache storage unavailable");
    }, now);
    expect(await p.cachedResponseWillBeUsed!({ cacheName: "pages", request, cachedResponse: cached, event: fakeEvent })).toBeNull();
  });

  it("serves a signed-in user's entries under a key scoped to them", async () => {
    const asAlice = await plugin({ userId: "alice", expires: 2_000 });
    const asBob = await plugin({ userId: "bob", expires: 2_000 });
    expect(await asAlice.cachedResponseWillBeUsed!({ cacheName: "pages", request, cachedResponse: cached, event: fakeEvent })).toBe(cached);
    expect(await asAlice.cacheWillUpdate!({ request, response: cached, event: fakeEvent })).toBe(cached);

    const keyA = (await asAlice.cacheKeyWillBeUsed!({ request, mode: "read", event: fakeEvent })) as Request;
    const keyB = (await asBob.cacheKeyWillBeUsed!({ request, mode: "read", event: fakeEvent })) as Request;
    expect(keyA.url).toBe(ownerScopedCacheKey(request.url, "alice"));
    expect(keyA.url).not.toBe(keyB.url);
  });
});
