import { afterEach, describe, expect, it } from "vitest";
import {
  canQueueOffline,
  clearOfflineOwner,
  getOfflineOwner,
  isOwnedBy,
  isUserDataCache,
  isValidSessionMarker,
  ownerScopedCacheKey,
  partitionByOwner,
  setOfflineOwner,
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

describe("partitionByOwner", () => {
  const entries = [
    { id: "1", ownerId: "alice" },
    { id: "2", ownerId: "bob" },
    { id: "3" },
    { id: "4", ownerId: "alice" },
  ];
  const ids = (list: { id: string }[]) => list.map((e) => e.id);

  it("keeps the user's own entries and purges everyone else's", () => {
    const { keep, purge, adopt } = partitionByOwner(entries, "alice", false);
    expect(ids(keep)).toEqual(["1", "4"]);
    expect(ids(purge)).toEqual(["2", "3"]);
    expect(adopt).toEqual([]);
  });

  it("adopts unowned entries only on the first claim after the upgrade", () => {
    const { keep, purge, adopt } = partitionByOwner(entries, "alice", true);
    expect(ids(keep)).toEqual(["1", "4"]);
    expect(ids(purge)).toEqual(["2"]);
    expect(ids(adopt)).toEqual(["3"]);
  });

  it("purges a previous user's whole queue when a different user signs in", () => {
    const { keep, purge } = partitionByOwner(entries, "bob", false);
    expect(ids(keep)).toEqual(["2"]);
    expect(ids(purge)).toEqual(["1", "3", "4"]);
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
