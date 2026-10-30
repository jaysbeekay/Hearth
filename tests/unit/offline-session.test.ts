import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";

// #424 — claiming a device's offline data for the signed-in user, and
// clearing it on sign-out, against a real (in-memory) IndexedDB.

const alice = { userId: "alice", canWrite: true };
const reader = { userId: "reader", canWrite: false };

// A minimal CacheStorage: enough to see which caches get deleted.
class FakeCaches {
  stores = new Map<string, Map<string, Response>>();
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const entries = this.stores.get(name)!;
    return {
      put: async (key: string, response: Response) => {
        entries.set(key, response);
      },
    };
  }
}

let fakeCaches: FakeCaches;

// A fresh copy of the modules, as on a new page load.
async function load() {
  vi.resetModules();
  const session = await import("@/lib/offlineSession");
  const cache = await import("@/lib/offlineCache");
  const queue = await import("@/lib/offlineQueue");
  const owner = await import("@/lib/offlineOwner");
  const sync = await import("@/lib/offlineSync");
  const db = await cache.getDb();
  return { session, cache, queue, owner, sync, db };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function op(id: string, ownerId: string | undefined, status = "pending") {
  return { id, ownerId, timestamp: Date.now(), label: "Add vehicle", entity: "vehicle", operation: "create", status };
}

function file(id: string, queueOpId: string) {
  return { id, queueOpId, fieldName: "file", filename: "a.txt", mimeType: "text/plain", size: 1, blob: "x" };
}

function doc(url: string, ownerId: string | undefined) {
  return { url, ownerId, filename: "a.pdf", mimeType: "application/pdf", size: 1, cachedAt: Date.now(), blob: "x" };
}

async function seed({ db, cache }: Loaded, data: { ops?: object[]; files?: object[]; docs?: object[]; pages?: [string, unknown][]; owner?: string }) {
  for (const o of data.ops ?? []) await db.put(cache.QUEUE_STORE, o);
  for (const f of data.files ?? []) await db.put(cache.FILES_STORE, f);
  for (const d of data.docs ?? []) await db.put(cache.DOCUMENTS_STORE, d);
  for (const [key, value] of data.pages ?? []) await db.put(cache.PAGES_STORE, value, key);
  if (data.owner) await db.put(cache.META_STORE, data.owner, "owner");
}

async function keys({ db, cache }: Loaded) {
  return {
    ops: (await db.getAllKeys(cache.QUEUE_STORE)).sort(),
    files: (await db.getAllKeys(cache.FILES_STORE)).sort(),
    docs: (await db.getAllKeys(cache.DOCUMENTS_STORE)).sort(),
    pages: (await db.getAllKeys(cache.PAGES_STORE)).sort(),
  };
}

async function claimAs(l: Loaded, who: { userId: string; canWrite: boolean }) {
  l.owner.setOfflineOwner(who);
  await l.session.claimOfflineData(who);
}

beforeEach(async () => {
  fakeCaches = new FakeCaches();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("caches", fakeCaches);
  const l = await load();
  for (const store of [l.cache.QUEUE_STORE, l.cache.FILES_STORE, l.cache.DOCUMENTS_STORE, l.cache.PAGES_STORE, l.cache.META_STORE]) {
    await l.db.clear(store);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claiming offline data", () => {
  it("lets a member who can write adopt pre-#424 queued writes, but not Documents", async () => {
    const l = await load();
    await seed(l, {
      ops: [op("u1", undefined), op("u2", undefined, "syncing")],
      files: [file("f1", "u1")],
      docs: [doc("/api/documents/old", undefined)],
    });
    await claimAs(l, alice);

    const ops = await l.queue.getAllOperations();
    expect(ops.map((o) => [o.id, o.ownerId, o.status]).sort()).toEqual([
      ["u1", "alice", "pending"],
      ["u2", "alice", "pending"],
    ]);
    expect((await l.queue.getFilesForOp("u1")).map((f) => f.id)).toEqual(["f1"]);
    expect((await keys(l)).docs).toEqual([]);
  });

  it("never lets a read-only member adopt them: they're purged", async () => {
    const l = await load();
    await seed(l, {
      ops: [op("u1", undefined)],
      files: [file("f1", "u1")],
      docs: [doc("/api/documents/old", undefined)],
    });
    await claimAs(l, reader);

    expect(await keys(l)).toEqual({ ops: [], files: [], docs: [], pages: [] });
  });

  it("purges another user's writes, their staged files, Documents and orphaned files", async () => {
    const l = await load();
    await seed(l, {
      owner: "bob",
      ops: [op("a1", "alice"), op("b1", "bob")],
      files: [file("fa", "a1"), file("fb", "b1"), file("orphan", "gone")],
      docs: [doc("/api/documents/a", "alice"), doc("/api/documents/b", "bob")],
    });
    await claimAs(l, alice);

    const left = await keys(l);
    expect(left.ops).toEqual(["a1"]);
    expect(left.files).toEqual(["fa"]);
    expect(left.docs).toEqual(["/api/documents/a"]);
  });

  it("puts the user's writes left mid-sync back in the queue", async () => {
    const l = await load();
    await seed(l, { owner: "alice", ops: [op("a1", "alice", "syncing"), op("a2", "alice", "failed")] });
    await claimAs(l, alice);

    const ops = await l.queue.getAllOperations();
    expect(ops.map((o) => [o.id, o.status]).sort()).toEqual([
      ["a1", "pending"],
      ["a2", "failed"],
    ]);
  });

  it("clears cached lists and runtime caches on a change of user, not for the same user", async () => {
    const first = await load();
    await seed(first, { pages: [["contracts", ["pre-424"]]] });
    fakeCaches.stores.set("pages", new Map());
    fakeCaches.stores.set("next-static-js-assets", new Map());
    await claimAs(first, alice);
    // First claim after the upgrade: nothing from before is kept.
    expect((await keys(first)).pages).toEqual([]);
    expect([...fakeCaches.stores.keys()]).toEqual(["next-static-js-assets"]);

    await first.cache.cachePageData("contracts", ["alice's"]);
    fakeCaches.stores.set("pages", new Map());

    const again = await load();
    await claimAs(again, alice);
    expect(await again.cache.getCachedPageData("contracts")).toEqual(["alice's"]);
    expect(fakeCaches.stores.has("pages")).toBe(true);

    const bob = await load();
    await claimAs(bob, { userId: "bob", canWrite: true });
    expect((await keys(bob)).pages).toEqual([]);
    expect(fakeCaches.stores.has("pages")).toBe(false);
  });

  it("runs the database work once per user, however often it's called", async () => {
    const l = await load();
    await claimAs(l, alice);
    await seed(l, { ops: [op("b1", "bob")] });
    await l.session.claimOfflineData(alice);
    expect((await keys(l)).ops).toEqual(["b1"]);
  });

  it("writes the session marker after the claim, so the claim can't clear it", async () => {
    const l = await load();
    fakeCaches.stores.set("hearth-session", new Map());
    l.owner.setOfflineOwner(alice);
    const claimed = l.session.claimOfflineData(alice);
    const marked = l.session.markOfflineSession("alice", Date.now() + 60_000);
    await Promise.all([claimed, marked]);
    expect(fakeCaches.stores.get("hearth-session")?.size).toBe(1);
  });
});

describe("signing out", () => {
  it("clears the queue, staged files, Documents, cached lists and runtime caches", async () => {
    const l = await load();
    await claimAs(l, alice);
    await seed(l, {
      ops: [op("a1", "alice")],
      files: [file("fa", "a1")],
      docs: [doc("/api/documents/a", "alice")],
      pages: [["alice:contracts", []]],
    });
    fakeCaches.stores.set("pages", new Map());
    fakeCaches.stores.set("hearth-session", new Map());

    await l.session.clearOfflineData();

    expect(await keys(l)).toEqual({ ops: [], files: [], docs: [], pages: [] });
    expect(fakeCaches.stores.size).toBe(0);
    expect(l.owner.getOfflineOwner()).toBeNull();
  });

  it("doesn't claim or mark the session again while signing out", async () => {
    const l = await load();
    await claimAs(l, alice);
    await l.session.clearOfflineData();
    expect(l.session.isSigningOut()).toBe(true);

    // A re-render of the signed-in layout before the page is replaced.
    await l.session.markOfflineSession("alice", Date.now() + 60_000);
    await seed(l, { ops: [op("u1", undefined)] });
    await l.session.claimOfflineData(alice);
    expect(fakeCaches.stores.has("hearth-session")).toBe(false);
    expect((await l.db.get(l.cache.QUEUE_STORE, "u1"))?.ownerId).toBeUndefined();
  });

  it("on the sign-in page, keeps only the write queue", async () => {
    const l = await load();
    await seed(l, {
      ops: [op("a1", "alice")],
      files: [file("fa", "a1")],
      docs: [doc("/api/documents/a", "alice")],
      pages: [["alice:contracts", []]],
    });
    fakeCaches.stores.set("pages-rsc", new Map());

    await l.session.clearSignedOutData();

    expect(await keys(l)).toEqual({ ops: ["a1"], files: ["fa"], docs: [], pages: [] });
    expect(fakeCaches.stores.size).toBe(0);
  });

  it("clears serwist's record of the cached signed-in URLs, not of static assets", async () => {
    const expiration = await openDB("serwist-expiration", 1, {
      upgrade(db) {
        const store = db.createObjectStore("cache-entries", { keyPath: "id" });
        store.createIndex("cacheName", "cacheName", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      },
    });
    await expiration.put("cache-entries", { id: "pages|/contracts/1", cacheName: "pages", url: "/contracts/1", timestamp: 1 });
    await expiration.put("cache-entries", { id: "apis|/api/x", cacheName: "apis", url: "/api/x", timestamp: 1 });
    await expiration.put("cache-entries", {
      id: "next-static-js-assets|/_next/a.js",
      cacheName: "next-static-js-assets",
      url: "/_next/a.js",
      timestamp: 1,
    });

    const l = await load();
    await l.session.clearRuntimeCaches();

    expect(await expiration.getAllKeys("cache-entries")).toEqual(["next-static-js-assets|/_next/a.js"]);
    expiration.close();
  });

  it("restores the owner and claim when signing out failed to reach the server", async () => {
    const l = await load();
    await claimAs(l, alice);
    await l.session.markOfflineSession("alice", Date.now() + 60_000);
    await l.session.clearOfflineData();
    expect(l.owner.getOfflineOwner()).toBeNull();

    await l.session.restoreOfflineSession();
    expect(l.owner.getOfflineOwner()).toEqual(alice);
    expect(fakeCaches.stores.get("hearth-session")?.size).toBe(1);
  });
});

describe("unsynced changes during a sync", () => {
  it("counts changes mid-sync, and waits for the sync before anyone counts again", async () => {
    const l = await load();
    await claimAs(l, alice);
    await seed(l, { ops: [op("a1", "alice"), op("a2", "alice")] });

    let respond: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => {
        respond = resolve;
      })),
    );

    const syncing = l.sync.syncPendingOperations();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    // Mid-sync: both still count as unsynced.
    expect(await l.queue.getPendingCount()).toBe(2);

    let idle = false;
    const waited = l.sync.awaitSyncIdle().then(() => {
      idle = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idle).toBe(false);

    respond(
      new Response(JSON.stringify({ results: [{ id: "a1", success: true }, { id: "a2", success: false, error: "no" }] })),
    );
    await syncing;
    await waited;
    expect(idle).toBe(true);
    expect(await l.queue.getPendingCount()).toBe(1);
  });

  it("sends writes stuck mid-sync by a crashed tab with the next sync", async () => {
    const l = await load();
    await claimAs(l, alice);
    await seed(l, { ops: [op("a1", "alice", "syncing")] });
    expect(await l.queue.getPendingCount()).toBe(1);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ id: "a1", success: true }] })));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await l.sync.syncPendingOperations();

    expect(outcome.successCount).toBe(1);
    expect(await l.queue.getPendingCount()).toBe(0);
  });
});
