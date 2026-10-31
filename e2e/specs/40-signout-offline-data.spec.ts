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
const DEMOTED_NAME = "Signout Demoted";
const DEMOTED_EMAIL = "demoted-424@e2e.local";
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

interface SeededOp {
  id: string;
  ownerId?: string;
  timestamp: number;
  label: string;
  entity: string;
  operation: string;
  formValues: Record<string, string>;
  status: string;
}

// A queued contract create as stored before #424: no owner.
function legacyContractOp(title: string): SeededOp {
  return {
    id: `e2e-seeded-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    label: "Add contract",
    entity: "contract",
    operation: "create",
    formValues: { title, category: "OTHER", provider: "Seeded Provider", renewalType: "MANUAL_RENEWAL" },
    status: "pending",
  };
}

async function withQueueStore<T>(page: Page, mode: IDBTransactionMode, op: SeededOp | null): Promise<T> {
  return page.evaluate(
    async ([txMode, seeded]) => {
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("hearth-cache");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const result = await new Promise<unknown>((resolve, reject) => {
        const tx = idb.transaction("offline-queue", txMode);
        const store = tx.objectStore("offline-queue");
        const req = seeded ? store.put(seeded) : store.getAll();
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
      idb.close();
      return result;
    },
    [mode, op] as const,
  ) as Promise<T>;
}

async function seedQueueOp(page: Page, op: SeededOp) {
  await withQueueStore<unknown>(page, "readwrite", op);
}

async function queuedOps(page: Page): Promise<SeededOp[]> {
  return withQueueStore<SeededOp[]>(page, "readonly", null);
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
    await db.execute({ sql: "DELETE FROM users WHERE email IN (?, ?, ?)", args: [ADMIN_424_EMAIL, RO_EMAIL, DEMOTED_EMAIL] });

    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();
    for (const [name, email, role] of [
      [ADMIN_424_NAME, ADMIN_424_EMAIL, "ADMIN"],
      [RO_NAME, RO_EMAIL, "READONLY"],
      [DEMOTED_NAME, DEMOTED_EMAIL, "MEMBER"],
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
    await db.execute({ sql: "DELETE FROM users WHERE email IN (?, ?, ?)", args: [ADMIN_424_EMAIL, RO_EMAIL, DEMOTED_EMAIL] });
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

    // Read-only: can't queue a write offline either.
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

  test("a write queued before the upgrade is adopted by a writer, and purged for a read-only member", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const title = `Signout Legacy Op ${Date.now()}`;
    createdTitles.push(title);
    await seedQueueOp(page, legacyContractOp(title));
    await page.reload();

    // The admin adopts it, and it syncs as theirs.
    await expect(page.getByText(/1 change waiting to sync/)).toBeVisible();
    expect((await queuedOps(page)).map((op) => op.ownerId)).toEqual([await userId(ADMIN_424_EMAIL)]);
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText(/1 change synced successfully/).first()).toBeVisible();
    expect(await contractCount(title)).toBe(1);
    await signOutButton(page).click();
    await page.waitForURL(/\/login/);

    // A read-only member never adopts one: it's purged.
    await signIn(page, RO_EMAIL, PASSWORD);
    const roTitle = `Signout Legacy Op RO ${Date.now()}`;
    await seedQueueOp(page, legacyContractOp(roTitle));
    await page.reload();
    await expect.poll(async () => (await queuedOps(page)).length).toBe(0);
    await expect(page.getByText(/waiting to sync|can't be saved/)).toHaveCount(0);
    expect(await contractCount(roTitle)).toBe(0);
    await page.context().close();
  });

  test("a write left 'syncing' by an earlier session is resent, and counted at sign-out", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const title = `Signout Stuck Syncing ${Date.now()}`;
    createdTitles.push(title);
    // An existing install: a sync was cut off mid-request, leaving the op
    // marked "syncing" forever (it used to vanish from the count and be
    // deleted at sign-out without a warning).
    await seedQueueOp(page, {
      ...legacyContractOp(title),
      ownerId: await userId(ADMIN_424_EMAIL),
      status: "syncing",
    });
    await page.reload();
    await expect(page.getByText(/1 change waiting to sync/)).toBeVisible();
    expect((await queuedOps(page)).map((op) => op.status)).toEqual(["pending"]);

    await signOutButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("You have 1 change that hasn't synced.");
    await dialog.getByRole("button", { name: "Sync now" }).click();
    await page.waitForURL(/\/login/);
    expect(await contractCount(title)).toBe(1);
    await page.context().close();
  });

  test("a member made read-only is told their queued changes can't be saved", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, DEMOTED_EMAIL, PASSWORD);
    const title = `Signout Demoted ${Date.now()}`;
    await queueContractOffline(page, title);
    await setFakeOffline(page, false);
    await page.context().clearCookies();

    await db.execute({ sql: "UPDATE users SET role = 'READONLY' WHERE email = ?", args: [DEMOTED_EMAIL] });
    await signIn(page, DEMOTED_EMAIL, PASSWORD);
    await expect(page.getByText("1 change on this device can't be saved because your account is now read-only.")).toBeVisible();

    await signOutButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("These changes can't be saved because your account is now read-only.");
    await expect(dialog.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Discarding from the banner drops them.
    await page.locator("div", { hasText: /can.t be saved because/ }).last().getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByText(/can't be saved/)).toHaveCount(0);
    expect((await offlineStoreCounts(page))["offline-queue"]).toBe(0);
    expect(await contractCount(title)).toBe(0);
    await page.context().close();
  });

  test("when offline storage can't be read, sign-out says so instead of hanging", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    await page.goto("/contracts");
    // The app has its connection open (it has cached the list).
    await expect.poll(async () => (await offlineStoreCounts(page)).pages ?? 0).toBeGreaterThan(0);
    // Another tab upgrades the database past this build's version: this
    // tab's connection closes when asked (instead of blocking it), and its
    // next open then fails.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("hearth-cache", 99);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("blocked: the app didn't close its connection"));
      });
    });

    await signOutButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Couldn't check for unsynced changes");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await signOutButton(page).click();
    await dialog.getByRole("button", { name: "Sign out anyway" }).click();
    await page.waitForURL(/\/login/);
    await page.context().close();
  });

  test("signing out offline is refused, and offline use keeps working", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    await setFakeOffline(page, true);
    await signOutButton(page).click();
    await expect(page.getByText("You're offline. Sign out when you're back online.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
    // Still the owner: a change can still be queued.
    const title = `Signout Offline Refused ${Date.now()}`;
    await queueContractOffline(page, title);
    await page.context().close();
  });

  test("signing out in one tab signs out the others", async ({ browser }) => {
    const page = await newPage(browser);
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const other = await page.context().newPage();
    await other.goto("/contracts");
    await expect(signOutButton(other)).toBeVisible();

    await signOutButton(page).click();
    await page.waitForURL(/\/login/);
    // The other tab reloads, and with no session lands on the sign-in page.
    await other.waitForURL(/\/login/);
    await page.context().close();
  });

  test("on a phone, Escape closes the sign-out prompt but not the More sheet", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript((flag) => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => window.sessionStorage.getItem(flag) !== "1",
      });
    }, OFFLINE_FLAG);
    const page = await context.newPage();
    await signIn(page, ADMIN_424_EMAIL, PASSWORD);
    const title = `Signout Mobile ${Date.now()}`;
    await queueContractOffline(page, title);
    await setFakeOffline(page, false);

    await page.getByRole("button", { name: "More navigation options" }).click();
    const sheet = page.getByRole("dialog", { name: "More navigation options" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Sign out" }).click();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toContainText("You have 1 change that hasn't synced.");

    await page.keyboard.press("Escape");
    await expect(prompt).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Sign out" }).click();
    await prompt.getByRole("button", { name: "Sync now" }).click();
    await page.waitForURL(/\/login/);
    expect(await contractCount(title)).toBe(1);
    await context.close();
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
