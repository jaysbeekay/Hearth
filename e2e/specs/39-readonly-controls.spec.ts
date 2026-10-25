import fs from "fs";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

// #400 — role gates actions, not visibility. A READONLY member sees every
// household record, but none of the controls that write one: no Add, Edit,
// Delete, Upload, star, banner action or inbox Save, and every create/edit
// page sends them back to the record or the list instead of rendering a
// form whose save can only fail.

const RO_NAME = "Read Only Viewer";
const RO_EMAIL = "readonly-400@e2e.local";
const RO_PASSWORD = "E2eTestPassw0rd!23";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function lastSegment(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop()!;
}

const ids = {
  contract: "",
  product: "",
  vehicle: "",
  vehicleItem: "",
  property: "",
  homeItem: "",
  agreement: "",
  trip: "",
  segment: "",
  portfolio: "",
  holding: "",
  trade: "",
  inventory: "",
};

// Buttons that write. Names are matched whole, so a record whose title
// happens to start with "Delete" (a link, not a button) can't trip this.
const WRITE_BUTTON =
  /^(Edit|Delete.*|More actions|Upload|Save|Save changes|Discard.*|Confirm details|Send test reminder|Unlink|Link|Restore.*|Mark .*|Unmark .*|Cancel|Not renewing\? Mark as cancelled|Disable rental tracking|Take photo|Keep as separate document|Attach as new version|Refresh|Add.*|New .*|Import.*)$/;
// Links that lead to a write: by name for the actions whose target is the
// record itself, and by href for every create, edit and import page.
const WRITE_LINK =
  /^(Edit|Renew policy|Renew or cancel|Set the new end date|Set the new lease end|Update lease|Upload document|Upload a document|Upload|Fill in|Confirm details|Review|Configure reminders|Add.*|New .*|Import CSV)$/;
const WRITE_HREF = 'a[href$="/new"], a[href*="/new?"], a[href$="/edit"], a[href$="/import"], a[href="/import"]';

async function expectNoWriteControls(page: Page, path: string) {
  await page.goto(path);
  await expect(page, `${path} should stay put for a read-only member`).toHaveURL(new RegExp(`${path.replace(/[?]/g, "\\?")}$`));
  const main = page.locator("main");
  await expect(main).toBeVisible();
  await expect(main.getByRole("button", { name: WRITE_BUTTON }), `write button on ${path}`).toHaveCount(0);
  await expect(main.getByRole("link", { name: WRITE_LINK }), `write link on ${path}`).toHaveCount(0);
  await expect(main.locator(WRITE_HREF), `create/edit link on ${path}`).toHaveCount(0);
  await expect(main.locator('input[type="file"]'), `upload input on ${path}`).toHaveCount(0);
}

async function readOnlyPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(RO_EMAIL);
  await page.locator('input[name="password"]').fill(RO_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/dashboard/);
  return page;
}

async function uploadFirst(page: Page, name: string) {
  await page.locator('input[type="file"][name="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  const submit = page.locator('form:has(input[name="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(page.locator("main")).toContainText(name, { timeout: 30_000 });
}

test.describe("read-only member (#400)", () => {
  test.describe.configure({ mode: "serial" });

  test("admin seeds one record of each type and a read-only member", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();
    const stamp = Date.now();

    // A Contract ending soon, so its banner and the dashboard row both carry actions.
    await page.goto("/contracts/new");
    await page.locator("#title").fill(`RO Contract ${stamp}`);
    await page.locator("#provider").fill("RO Insurer");
    await page.locator("#endDate").fill(daysFromNow(10));
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    ids.contract = lastSegment(page);
    await uploadFirst(page, `ro-contract-${stamp}.pdf`);

    await page.goto("/products/new");
    await page.locator("#description").fill(`RO Warranty ${stamp}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
    ids.product = lastSegment(page);
    await uploadFirst(page, `ro-warranty-${stamp}.pdf`);

    await page.goto("/vehicles/new");
    await page.locator("#label").fill(`RO Vehicle ${stamp}`);
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);
    ids.vehicle = lastSegment(page);
    await page.goto(`/vehicles/${ids.vehicle}/items/new`);
    await page.locator("#title").fill("RO Service");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(new RegExp(`/vehicles/${ids.vehicle}$`));
    ids.vehicleItem = (await page.locator(`a[href^="/vehicles/${ids.vehicle}/items/"]`).first().getAttribute("href"))!.split("/")[4];

    // A Property let out, with a lease ending soon: the Tenancy banner.
    await page.goto("/home/new");
    await page.locator("#label").fill(`RO Property ${stamp}`);
    await page.locator("#occupancyStatus").selectOption("RENTED");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
    ids.property = lastSegment(page);
    await page.goto(`/home/${ids.property}/rental/agreements/new`);
    await page.locator("#weeklyRent").fill("500");
    await page.locator("#tenantName").fill("RO Tenant");
    await page.locator("#leaseStart").fill(daysFromNow(-300));
    await page.locator("#leaseEnd").fill(daysFromNow(20));
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(new RegExp(`/home/${ids.property}/rental$`));
    ids.agreement = (await page.locator('a[href*="/rental/agreements/"][href$="/edit"]').first().getAttribute("href"))!.split("/")[5];
    await page.goto(`/home/${ids.property}/items/new`);
    await page.locator("#title").fill("RO Repair");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(new RegExp(`/home/${ids.property}$`));
    ids.homeItem = (await page.locator(`a[href^="/home/${ids.property}/items/"]`).first().getAttribute("href"))!.split("/")[4];

    const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
    ids.trip = tripAId;
    await page.goto(`/travel/${ids.trip}`);
    ids.segment = (await page.locator(`a[href^="/travel/${ids.trip}/segments/"][href$="/edit"]`).first().getAttribute("href"))!.split("/")[4];

    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill(`RO Portfolio ${stamp}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/);
    ids.portfolio = lastSegment(page);
    await page.goto(`/wealth/portfolios/${ids.portfolio}/holdings/new`);
    await page.locator("#ticker").fill("MSFT");
    await page.getByRole("button", { name: "Add holding" }).click();
    await page.waitForURL(/\/holdings\/(?!new$)[^/]+$/);
    ids.holding = lastSegment(page);
    await page.goto(`/wealth/portfolios/${ids.portfolio}/holdings/${ids.holding}/trades/new`);
    await page.locator("#type").selectOption("BUY");
    await page.locator("#date").fill("2026-01-01");
    await page.locator("#units").fill("2");
    await page.locator("#pricePerUnit").fill("100");
    await page.getByRole("button", { name: "Add trade" }).click();
    await page.waitForURL(new RegExp(`/holdings/${ids.holding}$`));
    ids.trade = (await page.locator('a[href*="/trades/"][href$="/edit"]').first().getAttribute("href"))!.split("/")[7];

    await page.goto("/inventory/new");
    await page.locator("#label").fill(`RO Item ${stamp}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);
    ids.inventory = lastSegment(page);

    // Something waiting in the Inbox.
    await page.goto("/dashboard");
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: `ro-inbox-${stamp}.pdf`,
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("Saved to your Inbox for review.")).toBeVisible();

    // And something in Trash.
    await page.goto("/products/new");
    await page.locator("#description").fill(`RO Trashed ${stamp}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: /^Delete$/ }).click();
    await page.getByRole("button", { name: "Delete warranty" }).click();
    await page.waitForURL(/\/products$/);

    await page.goto("/settings/users");
    await page.locator("#name").fill(RO_NAME);
    await page.locator("#email").fill(RO_EMAIL);
    await page.locator("#password").fill(RO_PASSWORD);
    await page.locator("#role").selectOption("READONLY");
    await page.locator("form:has(#password) button[type=submit]").click();
    await expect(page.locator("body")).toContainText(RO_EMAIL);

    await context.close();
  });

  test("shows no write controls anywhere a read-only member can look", async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await readOnlyPage(browser);

    await expectNoWriteControls(page, "/dashboard");
    await expect(page.locator("main")).toContainText("You have read-only access.");
    // The rows are still there to open; only their actions are gone.
    await expect(page.locator("main").getByRole("link", { name: /RO Contract/ })).toBeVisible();

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
    // The Due status and Reminder health read-out still show, and the
    // Document still opens.
    await expect(page.locator("main")).toContainText("Reminder health");
    await expect(page.locator("main").getByRole("link", { name: /ro-contract-.*\.pdf/ })).toBeVisible();

    await expectNoWriteControls(page, `/products/${ids.product}`);
    await expectNoWriteControls(page, `/vehicles/${ids.vehicle}`);
    await expectNoWriteControls(page, `/home/${ids.property}`);
    await expect(page.locator("main")).toContainText("Lease ends");
    await expectNoWriteControls(page, `/home/${ids.property}/rental`);
    await expect(page.locator("main")).toContainText("RO Tenant");
    await expectNoWriteControls(page, `/travel/${ids.trip}`);
    await expectNoWriteControls(page, `/wealth/portfolios/${ids.portfolio}`);
    await expectNoWriteControls(page, `/wealth/portfolios/${ids.portfolio}/holdings/${ids.holding}`);
    await expectNoWriteControls(page, `/inventory/${ids.inventory}`);

    await expectNoWriteControls(page, "/documents/inbox");
    await expect(page.locator("main")).toContainText(/ro-inbox-.*\.pdf/);
    await expect(page.locator("main select, main textarea, main input:not([type=hidden]):not([type=search])")).toHaveCount(0);

    await expectNoWriteControls(page, "/settings/trash");
    await expect(page.locator("main")).toContainText("RO Trashed");

    await page.context().close();
  });

  test("every create, edit and import page redirects a read-only member", async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await readOnlyPage(browser);
    const p = `/wealth/portfolios/${ids.portfolio}`;
    const h = `${p}/holdings/${ids.holding}`;

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
      [`/home/${ids.property}/rental/agreements/new`, `/home/${ids.property}/rental`],
      [`/home/${ids.property}/rental/agreements/${ids.agreement}/edit`, `/home/${ids.property}/rental`],
      [`/home/${ids.property}/rental/statements/new`, `/home/${ids.property}/rental`],
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

    for (const [from, to] of redirects) {
      await page.goto(from);
      await expect(page, `${from} should redirect to ${to}`).toHaveURL(new RegExp(`${to}$`));
    }

    await page.context().close();
  });

  test("the read-only account is removed", async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();
    await page.goto("/settings/users");
    const row = page.locator("li", { hasText: RO_EMAIL });
    await row.getByRole("button", { name: /Remove .* from the household/ }).click();
    await page.getByRole("button", { name: `Remove ${RO_NAME}`, exact: true }).click();
    await expect(page.locator("body")).not.toContainText(RO_EMAIL);
    await context.close();
  });
});
