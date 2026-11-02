import { randomUUID } from "crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import { ADMIN_AUTH_FILE, DATABASE_URL } from "../env";

// #400 — role gates actions, not visibility. A READONLY member sees every
// household record, but none of the controls that write one: no Add, Edit,
// Delete, Upload, star, banner action or inbox Save, and every create/edit
// page sends them back to the record or the list instead of rendering a
// form whose save can only fail. The extract endpoints refuse them too.
//
// Everything this spec seeds is deleted again in afterAll, straight from the
// database, so it doesn't depend on running last or on the UI cooperating.

const RO_NAME = "Read Only Viewer";
const RO_EMAIL = "readonly-400@e2e.local";
const RO_PASSWORD = "E2eTestPassw0rd!23";
const READ_ONLY_ERROR = "Your account has read-only access.";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastSegment(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function hrefSegment(page: Page, selector: string, index: number): Promise<string> {
  const href = await page.locator(selector).first().getAttribute("href");
  expect(href, `no link matching ${selector}`).toBeTruthy();
  return href!.split("/")[index];
}

const stamp = Date.now();
const ids = {
  contract: "",
  product: "",
  trashedProduct: "",
  vehicle: "",
  vehicleItem: "",
  property: "",
  homeItem: "",
  agreement: "",
  statement: "",
  trip: "",
  segment: "",
  portfolio: "",
  holding: "",
  trade: "",
  inventory: "",
  inbox: "",
};

let db: Client;

// Buttons that write. Names are matched whole, so a record whose title
// happens to start with "Delete" (a link, not a button) can't trip this.
const WRITE_BUTTON =
  /^(Edit|Delete.*|Remove.*|More actions.*|Upload|Save.*|Discard.*|Confirm.*|Send test reminder|Unlink|Link|Restore.*|Mark .*|Unmark .*|Cancel|Not renewing\? Mark as cancelled|Stop tracking tenancy|Take photo|Keep as separate document|Attach as new version|Refresh|Add.*|New .*|Import.*)$/;
// Links that lead to a write: by name for the actions whose target is the
// record itself, and by href for every create, edit and import page.
const WRITE_LINK =
  /^(Edit|Renew|Renew or cancel|Set the new end date|Set the new lease end|Update tenancy|Upload document|Upload a document|Upload|Fill in|Confirm details|Review|Configure reminders|Add.*|New .*|Import CSV)$/;
const WRITE_HREF = 'a[href$="/new"], a[href*="/new?"], a[href$="/edit"], a[href$="/import"], a[href="/import"]';
// A form bound to a server action carries Next's $ACTION_ hidden inputs.
// Plain GET forms (search, export, list filters) are the only forms a
// read-only member should be offered, and none of them post to an action.
const ACTION_FORM = 'form:not([method="get" i]):not([role="search"]):has(input[name^="$ACTION_"])';

async function expectNoWriteControls(page: Page, path: string) {
  await page.goto(path);
  await expect(page, `${path} should stay put for a read-only member`).toHaveURL(new RegExp(`${escapeRegExp(path)}$`));
  const main = page.locator("main");
  await expect(main).toBeVisible();
  await expect(main.getByRole("button", { name: WRITE_BUTTON }), `write button on ${path}`).toHaveCount(0);
  await expect(main.getByRole("link", { name: WRITE_LINK }), `write link on ${path}`).toHaveCount(0);
  await expect(main.locator(WRITE_HREF), `create/edit link on ${path}`).toHaveCount(0);
  await expect(main.locator('input[type="file"]'), `upload input on ${path}`).toHaveCount(0);
  await expect(main.locator(ACTION_FORM), `server-action form on ${path}`).toHaveCount(0);
}

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/dashboard/);
  return page;
}

async function uploadFirst(page: Page, name: string) {
  const form = page.locator('form:has(input[type="file"][name="file"])').first();
  await form.locator('input[type="file"][name="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  // An entry row's "Add document" (#405) uploads as soon as a file is
  // chosen; a record page's upload form has its own submit button.
  const submit = form.locator('button[type="submit"]');
  if ((await submit.count()) > 0) await submit.click();
  await expect(page.locator("main")).toContainText(name, { timeout: 30_000 });
}

async function submit(page: Page, url: RegExp) {
  await page.locator("main button[type=submit]").last().click();
  await page.waitForURL(url);
}

test.describe("read-only member (#400)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    db = createClient({ url: DATABASE_URL });
    // The app server writes to the same file; wait out its locks instead of
    // failing with SQLITE_BUSY (seen in CI on #429).
    await db.execute("PRAGMA busy_timeout = 5000");
    await db.execute("PRAGMA foreign_keys = ON");
    // A leftover account from an aborted run would make the create below
    // fail; clear it so that create can be held to succeeding.
    await db.execute({ sql: "DELETE FROM users WHERE email = ?", args: [RO_EMAIL] });
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    const del = async (table: string, id: string) => {
      if (!id) return;
      try {
        await db.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] });
      } catch (error) {
        failures.push(`${table} ${id}: ${error instanceof Error ? error.message : error}`);
      }
    };
    // Children cascade from these (items, agreements, statements,
    // segments, holdings, trades, documents, review fields).
    await del("contracts", ids.contract);
    await del("products", ids.product);
    await del("products", ids.trashedProduct);
    await del("vehicles", ids.vehicle);
    await del("properties", ids.property);
    await del("trips", ids.trip);
    await del("portfolios", ids.portfolio);
    await del("inventory_items", ids.inventory);
    await del("inbox_documents", ids.inbox);
    try {
      await db.execute({ sql: "DELETE FROM price_cache WHERE ticker = ?", args: [`ro400coin${stamp}`] });
      await db.execute({ sql: "DELETE FROM users WHERE email = ?", args: [RO_EMAIL] });
      const left = await db.execute({ sql: "SELECT count(*) AS n FROM users WHERE email = ?", args: [RO_EMAIL] });
      if (Number(left.rows[0].n) !== 0) failures.push("read-only user still present");
    } catch (error) {
      failures.push(`users: ${error instanceof Error ? error.message : error}`);
    }
    db.close();
    expect(failures, "afterAll cleanup").toEqual([]);
  });

  test("admin seeds one record of each type and a read-only member", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();

    // A Contract ending soon (its banner and the dashboard row carry
    // actions), with a Document, and auto-filled details awaiting review.
    await page.goto("/contracts/new");
    await page.locator("#title").fill(`RO Contract ${stamp}`);
    await page.locator("#category").selectOption("OTHER");
    await page.locator("#provider").fill("RO Insurer");
    await page.locator("#endDate").fill(daysFromNow(10));
    await submit(page, /\/contracts\/(?!new$)[^/]+$/);
    ids.contract = lastSegment(page);
    await uploadFirst(page, `ro-contract-${stamp}.pdf`);
    await db.execute({ sql: "UPDATE contracts SET extractionPending = 1 WHERE id = ?", args: [ids.contract] });
    await db.execute({
      sql: `INSERT INTO extraction_review_fields (id, ownerType, ownerId, contractId, fieldName, value, source, confidence, createdAt, updatedAt)
            VALUES (?, 'CONTRACT', ?, ?, 'provider', 'RO Insurer', 'heuristic', 0.8, ?, ?)`,
      args: [randomUUID(), ids.contract, ids.contract, new Date().toISOString(), new Date().toISOString()],
    });

    // A Warranty with a Document, also Needs review but with no field list:
    // the banner's own Needs review row.
    await page.goto("/products/new");
    await page.locator("#description").fill(`RO Warranty ${stamp}`);
    await submit(page, /\/products\/(?!new$)[^/]+$/);
    ids.product = lastSegment(page);
    await uploadFirst(page, `ro-warranty-${stamp}.pdf`);
    await db.execute({ sql: "UPDATE products SET extractionPending = 1 WHERE id = ?", args: [ids.product] });

    await page.goto("/vehicles/new");
    await page.locator("#label").fill(`RO Vehicle ${stamp}`);
    await submit(page, /\/vehicles\/(?!new$)[^/]+$/);
    ids.vehicle = lastSegment(page);
    await page.goto(`/vehicles/${ids.vehicle}/items/new`);
    await page.locator("#title").fill("RO Service");
    await submit(page, new RegExp(`/vehicles/${ids.vehicle}$`));
    ids.vehicleItem = await hrefSegment(page, `a[href^="/vehicles/${ids.vehicle}/items/"][href$="/edit"]`, 4);
    await uploadFirst(page, `ro-service-${stamp}.pdf`);

    // A let-out Property with a lease ending soon (the Tenancy banner), a
    // repair with a Document, a valuation, and a statement with a Document.
    await page.goto("/home/new");
    await page.locator("#label").fill(`RO Property ${stamp}`);
    await page.locator("#occupancyStatus").selectOption("RENTED");
    await submit(page, /\/home\/(?!new$)[^/]+$/);
    ids.property = lastSegment(page);
    await page.goto(`/home/${ids.property}/items/new`);
    await page.locator("#title").fill("RO Repair");
    await submit(page, new RegExp(`/home/${ids.property}$`));
    ids.homeItem = await hrefSegment(page, `a[href^="/home/${ids.property}/items/"][href$="/edit"]`, 4);
    await uploadFirst(page, `ro-repair-${stamp}.pdf`);
    await page.locator('input[name="value"]').fill("750000");
    await page.getByRole("button", { name: "Save valuation" }).click();
    await expect(page.getByRole("button", { name: /^More actions for valuation / })).toBeVisible();
    await page.goto(`/home/${ids.property}/rental/agreements/new`);
    await page.locator("#weeklyRent").fill("500");
    await page.locator("#tenantName").fill("RO Tenant");
    await page.locator("#leaseStart").fill(daysFromNow(-300));
    await page.locator("#leaseEnd").fill(daysFromNow(20));
    await submit(page, new RegExp(`/home/${ids.property}/rental$`));
    ids.agreement = await hrefSegment(page, 'a[href*="/rental/agreements/"][href$="/edit"]', 5);
    await page.goto(`/home/${ids.property}/rental/statements/new`);
    await page.locator("#statementDate").fill(daysFromNow(-5));
    await page.locator("#grossRent").fill("2000");
    await submit(page, new RegExp(`/home/${ids.property}/rental$`));
    ids.statement = await hrefSegment(page, 'a[href*="/rental/statements/"][href$="/edit"]', 5);
    await uploadFirst(page, `ro-statement-${stamp}.pdf`);

    // A Trip with a flight that has a number but no status yet (Refresh).
    await page.goto("/travel/new");
    await page.locator("#title").fill(`RO Trip ${stamp}`);
    await page.locator("#destination").fill("Osaka");
    await page.locator("#startDate").fill("2027-03-01");
    await page.locator("#endDate").fill("2027-03-08");
    await submit(page, /\/travel\/(?!new$)[^/]+$/);
    ids.trip = lastSegment(page);
    await page.goto(`/travel/${ids.trip}/segments/new`);
    await page.locator('select[name="type"]').selectOption("FLIGHT");
    await page.locator('input[name="title"]').fill("RO Flight");
    await page.locator('input[name="flightNumber"]').fill("QF79");
    await page.locator('input[name="startDate"]').fill("2027-03-01");
    await submit(page, new RegExp(`/travel/${ids.trip}$`));
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    ids.segment = await hrefSegment(page, `a[href^="/travel/${ids.trip}/segments/"][href$="/edit"]`, 4);

    // A Portfolio, with a Holding and Trade written straight to the
    // database and a fresh cached price, so nothing here waits on a live
    // price feed.
    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill(`RO Portfolio ${stamp}`);
    await submit(page, /\/wealth\/portfolios\/(?!new$)[^/]+$/);
    ids.portfolio = lastSegment(page);
    const now = new Date().toISOString();
    const ticker = `ro400coin${stamp}`;
    ids.holding = `ro400h${stamp}`;
    ids.trade = `ro400t${stamp}`;
    await db.execute({
      sql: "INSERT INTO price_cache (ticker, price, currency, changePct, source, cachedAt) VALUES (?, 120, 'AUD', 0, 'e2e', ?)",
      args: [ticker, now],
    });
    await db.execute({
      sql: "INSERT INTO holdings (id, portfolioId, ticker, name, assetClass, exchange, createdAt, updatedAt) VALUES (?, ?, ?, 'RO Coin', 'CRYPTO', 'CRYPTO', ?, ?)",
      args: [ids.holding, ids.portfolio, ticker, now, now],
    });
    await db.execute({
      sql: "INSERT INTO trades (id, holdingId, type, date, units, pricePerUnit, currency, createdAt, updatedAt) VALUES (?, ?, 'BUY', ?, 2, 100, 'AUD', ?, ?)",
      args: [ids.trade, ids.holding, "2026-01-01T00:00:00.000Z", now, now],
    });
    await page.goto(`/wealth/portfolios/${ids.portfolio}/holdings/${ids.holding}`);
    await uploadFirst(page, `ro-trade-${stamp}.pdf`);

    await page.goto("/inventory/new");
    await page.locator("#label").fill(`RO Item ${stamp}`);
    await submit(page, /\/inventory\/(?!new$)[^/]+$/);
    ids.inventory = lastSegment(page);
    await uploadFirst(page, `ro-item-${stamp}.pdf`);

    // Something waiting in the Inbox.
    await page.goto("/dashboard");
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: `ro-inbox-${stamp}.pdf`,
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("Saved to your Inbox for review.")).toBeVisible();
    const inbox = await db.execute({ sql: "SELECT id FROM inbox_documents WHERE filename = ?", args: [`ro-inbox-${stamp}.pdf`] });
    ids.inbox = String(inbox.rows[0].id);

    // And something in Trash.
    await page.goto("/products/new");
    await page.locator("#description").fill(`RO Trashed ${stamp}`);
    await submit(page, /\/products\/(?!new$)[^/]+$/);
    ids.trashedProduct = lastSegment(page);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("button", { name: /^Delete$/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForURL(/\/products$/);

    // Positive control: the same checks do find the admin's controls.
    await page.goto(`/contracts/${ids.contract}`);
    await expect(page.locator("main").getByRole("button", { name: WRITE_BUTTON }).first()).toBeVisible();
    await expect(page.locator("main").locator('input[type="file"]')).toHaveCount(1);

    await page.goto("/settings/users");
    await page.locator("#name").fill(RO_NAME);
    await page.locator("#email").fill(RO_EMAIL);
    await page.locator("#password").fill(RO_PASSWORD);
    await page.locator("#role").selectOption("READONLY");
    await page.locator("form:has(#password) button[type=submit]").click();
    await expect(page.locator("main")).toContainText(`${RO_NAME} was added.`);
    const created = await db.execute({ sql: "SELECT role FROM users WHERE email = ?", args: [RO_EMAIL] });
    expect(created.rows.map((r) => r.role)).toEqual(["READONLY"]);

    await context.close();
  });

  test("shows no write controls anywhere a read-only member can look", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signIn(browser, RO_EMAIL, RO_PASSWORD);
    const main = page.locator("main");

    await expectNoWriteControls(page, "/dashboard");
    await expect(main).toContainText("You have read-only access.");
    // The rows are still there to open; only their actions are gone.
    await expect(main.getByRole("link", { name: new RegExp(`RO Contract ${stamp}`) }).first()).toBeVisible();

    for (const list of [
      "/contracts",
      "/products",
      "/vehicles",
      "/home",
      "/travel",
      "/inventory",
      "/wealth",
      "/wealth/portfolios",
      "/documents",
      "/calendar",
      "/spend",
    ]) {
      await expectNoWriteControls(page, list);
    }

    await expectNoWriteControls(page, `/contracts/${ids.contract}`);
    // Due status, Reminder health, unconfirmed details and the Document
    // all still show.
    await expect(main).toContainText("Reminder health");
    await expect(main).toContainText("Needs review");
    await expect(main).toContainText("Reminders are on hold until a household member confirms them.");
    await expect(main.getByRole("link", { name: new RegExp(`ro-contract-${stamp}`) })).toBeVisible();

    await expectNoWriteControls(page, `/products/${ids.product}`);
    await expect(main).toContainText("Needs review");
    await expectNoWriteControls(page, `/vehicles/${ids.vehicle}`);
    await expect(main).toContainText(`ro-service-${stamp}.pdf`);
    await expectNoWriteControls(page, `/home/${ids.property}`);
    await expect(main).toContainText("Lease ends");
    await expect(main).toContainText(`ro-repair-${stamp}.pdf`);
    await expectNoWriteControls(page, `/home/${ids.property}/rental`);
    await expect(main).toContainText("RO Tenant");
    await expect(main).toContainText(`ro-statement-${stamp}.pdf`);
    await expectNoWriteControls(page, `/travel/${ids.trip}`);
    await expect(main).toContainText("RO Flight");
    await expectNoWriteControls(page, `/wealth/portfolios/${ids.portfolio}`);
    await expectNoWriteControls(page, `/wealth/portfolios/${ids.portfolio}/holdings/${ids.holding}`);
    await expect(main).toContainText(`ro-trade-${stamp}.pdf`);
    await expectNoWriteControls(page, `/inventory/${ids.inventory}`);
    await expect(main).toContainText(`ro-item-${stamp}.pdf`);

    await expectNoWriteControls(page, "/documents/inbox");
    await expect(main).toContainText(`ro-inbox-${stamp}.pdf`);
    await expect(main.locator("select, textarea, input:not([type=hidden]):not([type=search])")).toHaveCount(0);

    await expectNoWriteControls(page, "/settings/trash");
    await expect(main).toContainText(`RO Trashed ${stamp}`);

    await page.context().close();
  });

  test("still offers a read-only member their own account settings and the calendar feed", async ({ browser }) => {
    const page = await signIn(browser, RO_EMAIL, RO_PASSWORD);
    const main = page.locator("main");

    await page.goto("/settings");
    await expect(main.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Save preferences" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Update password" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Passkeys", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Enable two-factor authentication" })).toBeVisible();

    await page.goto("/calendar");
    await expect(main.getByRole("button", { name: "Subscribe in your calendar" })).toBeVisible();

    await page.context().close();
  });

  test("an Archived Vehicle and Property show a read-only member the notice but no Archive or Restore (#355)", async ({ browser }) => {
    const now = new Date().toISOString();
    await db.execute({ sql: "UPDATE vehicles SET archivedAt = ? WHERE id = ?", args: [now, ids.vehicle] });
    await db.execute({ sql: "UPDATE properties SET archivedAt = ? WHERE id = ?", args: [now, ids.property] });
    const page = await signIn(browser, RO_EMAIL, RO_PASSWORD);
    const main = page.locator("main");
    for (const path of [`/vehicles/${ids.vehicle}`, `/home/${ids.property}`]) {
      await expectNoWriteControls(page, path);
      await expect(main.getByTestId("archived-notice"), path).toBeVisible();
      await expect(main.getByRole("button", { name: /^(Archive|Restore)$/ }), path).toHaveCount(0);
    }
    await page.context().close();
    await db.execute({ sql: "UPDATE vehicles SET archivedAt = NULL WHERE id = ?", args: [ids.vehicle] });
    await db.execute({ sql: "UPDATE properties SET archivedAt = NULL WHERE id = ?", args: [ids.property] });
  });

  test("every create, edit and import page redirects a read-only member", async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await signIn(browser, RO_EMAIL, RO_PASSWORD);
    const p = `/wealth/portfolios/${ids.portfolio}`;
    const h = `${p}/holdings/${ids.holding}`;
    const rental = `/home/${ids.property}/rental`;

    const redirects: [string, string][] = [
      ["/import", "/documents"],
      ["/contracts/new", "/contracts"],
      [`/contracts/${ids.contract}/edit`, `/contracts/${ids.contract}`],
      ["/products/new", "/products"],
      [`/products/${ids.product}/edit`, `/products/${ids.product}`],
      ["/vehicles/new", "/vehicles"],
      [`/vehicles/${ids.vehicle}/edit`, `/vehicles/${ids.vehicle}`],
      [`/vehicles/${ids.vehicle}/items/new`, `/vehicles/${ids.vehicle}`],
      [`/vehicles/${ids.vehicle}/items/${ids.vehicleItem}/edit`, `/vehicles/${ids.vehicle}`],
      ["/home/new", "/home"],
      [`/home/${ids.property}/edit`, `/home/${ids.property}`],
      [`/home/${ids.property}/items/new`, `/home/${ids.property}`],
      [`/home/${ids.property}/items/${ids.homeItem}/edit`, `/home/${ids.property}`],
      [`${rental}/agreements/new`, rental],
      [`${rental}/agreements/${ids.agreement}/edit`, rental],
      [`${rental}/statements/new`, rental],
      [`${rental}/statements/${ids.statement}/edit`, rental],
      ["/travel/new", "/travel"],
      [`/travel/${ids.trip}/edit`, `/travel/${ids.trip}`],
      [`/travel/${ids.trip}/segments/new`, `/travel/${ids.trip}`],
      [`/travel/${ids.trip}/segments/${ids.segment}/edit`, `/travel/${ids.trip}`],
      ["/inventory/new", "/inventory"],
      [`/inventory/${ids.inventory}/edit`, `/inventory/${ids.inventory}`],
      ["/wealth/portfolios/new", "/wealth/portfolios"],
      [`${p}/edit`, p],
      [`${p}/import`, p],
      [`${p}/holdings/new`, p],
      [`${h}/edit`, h],
      [`${h}/trades/new`, h],
      [`${h}/trades/${ids.trade}/edit`, h],
    ];
    expect(redirects).toHaveLength(30);

    for (const [from, to] of redirects) {
      await page.goto(from);
      await expect(page, `${from} should redirect to ${to}`).toHaveURL(new RegExp(`${escapeRegExp(to)}$`));
    }

    await page.context().close();
  });

  test("the extract and sync endpoints refuse a read-only member", async ({ browser }) => {
    const page = await signIn(browser, RO_EMAIL, RO_PASSWORD);
    const file = { name: "probe.pdf", mimeType: "application/pdf", buffer: PDF };

    for (const endpoint of [
      "/api/documents/extract",
      `/api/documents/inbox/${ids.inbox}/extract`,
      "/api/products/extract",
      "/api/home/extract",
      "/api/home/lease-extract",
      "/api/home/rental-extract",
      "/api/inventory/extract",
      "/api/travel/extract",
      "/api/vehicles/extract",
      "/api/sync",
    ]) {
      const res = await page.request.post(endpoint, { multipart: { file, operations: "[]" } });
      expect(res.status(), endpoint).toBe(403);
      expect(await res.json(), endpoint).toEqual({ error: READ_ONLY_ERROR });
    }
    await page.context().close();

    // Positive control: an admin still gets an extraction result.
    const admin = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const res = await admin.request.post("/api/products/extract", { multipart: { file } });
    expect(res.status()).toBe(200);
    await admin.close();
  });
});
