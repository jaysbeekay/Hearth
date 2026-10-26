import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import { ADMIN_AUTH_FILE, BASE_URL, DATABASE_URL } from "../env";

// #424 — signing out (or a different user signing in) must leave nothing
// from the last session on a shared device: no cached pages, no offline
// write queue, no offline Documents.
//
// The service worker is disabled under `next dev` (next.config.ts), so this
// spec can't watch it serve or refuse a cached page. Instead it seeds Cache
// Storage the way the worker would and checks the app clears it; the
// worker's own session/owner scoping is unit-tested in
// tests/unit/offline-owner.test.ts.

const ADMIN_424_NAME = "Signout Admin";
const ADMIN_424_EMAIL = "admin-424@e2e.local";
const RO_NAME = "Signout Read Only";
const RO_EMAIL = "readonly-424@e2e.local";
const PASSWORD = "E2eTestPassw0rd!23";
const OFFLINE_FLAG = "e2e-offline-424";
const PRECACHE = "serwist-precache-v2-e2e";

let db: Client;
const createdTitles: string[] = [];

// Like 08-offline-pending-records: navigator.onLine reports false while the
// flag is set, so the app queues writes without the real network going down
// (which would also stop the sign-out request itself). Kept in
// sessionStorage so it survives navigations in the same tab and can be
// flipped mid-test.
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((flag) => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => window.sessionStorage.getItem(flag) !== "1",
    });
  }, OFFLINE_FLAG);
  return context.newPage();
}

async function setFakeOffline(page: Page, offline: boolean) {
  await page.evaluate(
    ([flag, on]) => {
      if (on) window.sessionStorage.setItem(flag, "1");
      else window.sessionStorage.removeItem(flag);
    },
    [OFFLINE_FLAG, offline] as const,
  );
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/dashboard/);
}

function signOutButton(page: Page) {
  return page.locator("aside").getByRole("button", { name: "Sign out" });
}

// Only call once the app has opened the database itself: opening it without
// a version first would create it at v1 and skip the app's upgrade.
async function offlineStoreCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("hearth-cache");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const counts: Record<string, number> = {};
    for (const name of ["pages", "offline-queue", "pending-files", "offline-documents"]) {
      if (!idb.objectStoreNames.contains(name)) continue;
      counts[name] = await new Promise<number>((resolve, reject) => {
        const req = idb.transaction(name).objectStore(name).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    idb.close();
    return counts;
  });
}

async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).sort());
}

// What the service worker would have stored while the admin browsed.
async function seedWorkerCaches(page: Page) {
  await page.evaluate(async (precache) => {
    await (await caches.open("pages")).put("/contracts", new Response("<html>admin page</html>"));
    await (await caches.open("apis")).put("/api/documents/e2e", new Response("document bytes"));
    await (await caches.open(precache)).put("/_next/static/e2e.js", new Response("static"));
  }, PRECACHE);
}

async function userId(email: string): Promise<string> {
  const rows = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
  return String(rows.rows[0].id);
}

async function contractCount(title: string): Promise<number> {
  const rows = await db.execute({ sql: "SELECT count(*) AS n FROM contracts WHERE title = ?", args: [title] });
  return Number(rows.rows[0].n);
}

async function queueContractOffline(page: Page, title: string) {
  createdTitles.push(title);
  await setFakeOffline(page, true);
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Signout Provider");
  await page.locator("main button[type=submit]").click();
  await page.goto("/contracts");
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByText(/1 change waiting to sync/)).toBeVisible();
}

test.describe("sign-out clears offline data (#424)", () => {
  test.describe.configure({ mode: "serial" });

  // Its own accounts: earlier specs leave the seeded admin with two-factor
  // sign-in turned on (15-security-factors), so it can't sign in by password.
  test.beforeAll(async ({ browser }) => {
    db = createClient({ url: DATABASE_URL });
    await db.execute("PRAGMA busy_timeout = 5000");
    await db.execute({ sql: "DELETE FROM users WHERE email IN (?, ?)", args: [ADMIN_424_EMAIL, RO_EMAIL] });

    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();
    for (const [name, email, role] of [
      [ADMIN_424_NAME, ADMIN_424_EMAIL, "ADMIN"],
      [RO_NAME, RO_EMAIL, "READONLY"],
    ] as const) {
      await page.goto("/settings/users");
      await page.locator("#name").fill(name);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(PASSWORD);
      await page.locator("#role").selectOption(role);
      await page.locator("form:has(#password) button[type=submit]").click();
      await expect(page.locator("main")).toContainText(`${name} was added.`);
    }
    await context.close();
  });

  test.afterAll(async () => {
    for (const title of createdTitles) {
      await db.execute({ sql: "DELETE FROM contracts WHERE title = ?", args: [title] });
    }
    await db.execute({ sql: "DELETE FROM users WHERE email IN (?, ?)", args: [ADMIN_424_EMAIL, RO_EMAIL] });
    db.close();
  });

  test("signing out clears cached pages, cached lists and offline Documents", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const adminId = await userId(ADMIN_424_EMAIL);

    await page.goto("/contracts");
    await page.goto("/products");
    await expect.poll(async () => (await offlineStoreCounts(page)).pages ?? 0).toBeGreaterThan(0);
    // OfflineSessionGuard told the (would-be) service worker who's signed in.
    await expect.poll(() => cacheNames(page)).toContain("hearth-session");

    await seedWorkerCaches(page);
    await page.evaluate(async (ownerId) => {
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("hearth-cache");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction("offline-documents", "readwrite");
        tx.objectStore("offline-documents").put({
          url: "/api/documents/e2e-seeded",
          ownerId,
          filename: "seeded.pdf",
          mimeType: "application/pdf",
          size: 1,
          cachedAt: Date.now(),
          blob: new Blob(["x"]),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      idb.close();
    }, adminId);

    // Nothing unsynced, so no dialog: straight to the sign-in page.
    await signOutButton(page).click();
    await page.waitForURL(/\/login/);

    expect(await cacheNames(page)).toEqual([PRECACHE]);
    expect(await offlineStoreCounts(page)).toEqual({
      pages: 0,
      "offline-queue": 0,
      "pending-files": 0,
      "offline-documents": 0,
    });
    await page.context().close();
  });

  test("a READONLY member signing in after an admin sees none of the admin's offline data", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);

    // The admin visits pages and queues a write, then the session ends
    // without a clean sign-out (expired, or the tab was just closed).
    const adminTitle = `Signout Admin Leftover ${Date.now()}`;
    await queueContractOffline(page, adminTitle);
    await seedWorkerCaches(page);
    expect((await offlineStoreCounts(page))["offline-queue"]).toBe(1);
    await setFakeOffline(page, false);
    await page.context().clearCookies();

    await signIn(page, RO_EMAIL, PASSWORD);
    // The admin's queued write is purged, never listed, never replayed.
    await expect.poll(async () => (await offlineStoreCounts(page))["offline-queue"]).toBe(0);
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
    const names = await cacheNames(page);
    expect(names).not.toContain("pages");
    expect(names).not.toContain("apis");

    // No write can be queued: the create page sends a read-only member away,
    // and the list offers nothing to delete.
    await setFakeOffline(page, true);
    await page.goto("/contracts/new");
    await expect(page).not.toHaveURL(/\/contracts\/new$/);
    await page.goto("/contracts");
    await expect(page.locator("main").getByRole("button", { name: /^(Delete.*|Discard.*)$/ })).toHaveCount(0);
    await expect(page.getByText(adminTitle)).toHaveCount(0);
    expect((await offlineStoreCounts(page))["offline-queue"]).toBe(0);

    // Really offline: with no service worker in dev nothing is served, and
    // the admin's cached page was purged, so there's nothing it could serve.
    await page.context().setOffline(true);
    await expect(page.goto("/contracts")).rejects.toThrow();
    await page.context().setOffline(false);

    // Never reached the server either.
    expect(await contractCount(adminTitle)).toBe(0);
    await page.context().close();
  });

  test("unsynced changes: Cancel keeps you signed in, Sync now syncs then signs out", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const title = `Signout Sync Contract ${Date.now()}`;
    await queueContractOffline(page, title);

    const dialog = page.getByRole("alertdialog");
    await signOutButton(page).click();
    await expect(dialog).toContainText("You have 1 change that hasn't synced.");

    // Cancel: nothing happens.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/contracts$/);
    await expect(page.getByText(/1 change waiting to sync/)).toBeVisible();

    // Sync now while offline: refused, still signed in.
    await signOutButton(page).click();
    await dialog.getByRole("button", { name: "Sync now" }).click();
    await expect(dialog.getByRole("alert")).toContainText("You're offline");
    await expect(page).toHaveURL(/\/contracts$/);

    // Sync now when the sync fails: still signed in, change still queued.
    await setFakeOffline(page, false);
    await page.route("**/api/sync", (route) => route.fulfill({ status: 500, body: "{}" }));
    await dialog.getByRole("button", { name: "Sync now" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Sync failed");
    await expect(page).toHaveURL(/\/contracts$/);
    expect((await offlineStoreCounts(page))["offline-queue"]).toBe(1);
    expect(await contractCount(title)).toBe(0);

    // Sync now when it works: synced, then signed out.
    await page.unroute("**/api/sync");
    await dialog.getByRole("button", { name: "Sync now" }).click();
    await page.waitForURL(/\/login/);
    expect(await contractCount(title)).toBe(1);
    expect((await offlineStoreCounts(page))["offline-queue"]).toBe(0);
    await page.context().close();
  });

  test("unsynced changes: Discard and sign out drops them", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const title = `Signout Discard Contract ${Date.now()}`;
    await queueContractOffline(page, title);
    await setFakeOffline(page, false);

    await signOutButton(page).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard and sign out" }).click();
    await page.waitForURL(/\/login/);

    expect(await offlineStoreCounts(page)).toMatchObject({ "offline-queue": 0, "pending-files": 0 });
    expect(await contractCount(title)).toBe(0);
    await page.context().close();
  });
});

test.describe("/api/sync and the queue's owner (#424)", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  test("refuses a change queued by a different account", async ({ request }) => {
    const id = `e2e-other-owner-${Date.now()}`;
    const operations = [
      {
        id,
        ownerId: "someone-else",
        entity: "contract",
        operation: "create",
        formValues: { title: `Not mine ${id}`, category: "OTHER", provider: "X", renewalType: "MANUAL_RENEWAL" },
      },
    ];
    const res = await request.post(`${BASE_URL}/api/sync`, {
      multipart: { operations: JSON.stringify(operations) },
    });
    expect(res.ok()).toBe(true);
    const { results } = (await res.json()) as { results: { id: string; success: boolean; error?: string }[] };
    expect(results).toEqual([{ id, success: false, error: expect.stringContaining("different account") }]);
  });
});
