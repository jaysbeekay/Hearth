import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

const PAGES: Array<[string, string[]]> = [
  ["/dashboard", ["Dashboard"]],
  ["/contracts", ["Policies & contracts"]],
  ["/products", ["Purchases & warranties"]],
  ["/travel", ["Travel"]],
  ["/home", ["Properties"]],
  ["/vehicles", ["Vehicles"]],
  ["/inventory", ["Inventory"]],
  ["/wealth", ["Wealth"]],
  ["/documents", ["Documents"]],
  ["/documents/inbox", ["Documents"]],
  ["/spend", ["Spend"]],
  ["/import", ["Upload"]],
  ["/calendar", ["Upcoming"]],
  ["/assistant", ["Assistant"]],
  ["/settings", ["Settings"]],
  ["/settings/webhooks", ["Webhook"]],
  ["/settings/modules", ["Travel"]],
];

for (const [url, snippets] of PAGES) {
  test(`${url} renders successfully`, async ({ page }) => {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    for (const snippet of snippets) {
      await expect(page.locator("body")).toContainText(snippet);
    }
  });
}

test("all nav items appear together on one page", async ({ page }) => {
  await page.goto("/dashboard");
  const body = page.locator("body");
  await expect(body).toContainText("Policies & contracts");
  // #332 supersedes #174: nav, page heading and page title still all agree
  // with each other (that's what #174 actually established) — just using
  // #332's task-oriented aliases instead of the bare "Contracts"/
  // "Warranties" #174 originally picked. The /contracts, /products routes,
  // the Prisma models and the component names are unchanged.
  await expect(body).toContainText("Purchases & warranties");
  await expect(body).toContainText("Travel");
  await expect(body).toContainText("Settings");
});

test("create a contract end-to-end", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Regression Test Contract");
  await page.locator("#provider").fill("Regression Test Provider");
  const category = page.locator('select[name="category"]');
  if (await category.count()) await category.selectOption({ index: 1 });
  await page.locator("main button[type=submit]").click();
  // Exclude "new" itself: we're already on /contracts/new when this is
  // called, which a bare /\/contracts\/[^/]+$/ also matches — so without the
  // exclusion this resolves instantly instead of waiting for the real
  // post-submit redirect. Same footgun as seed.setup.ts's /travel/ case.
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  await expect(page.locator("body")).toContainText("Regression Test Contract");
});

test("create a product end-to-end", async ({ page }) => {
  await page.goto("/products/new");
  await page.locator("#description").fill("Regression Test Product");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
  await expect(page.locator("body")).toContainText("Regression Test Product");
});

test("no uncaught client-side errors across core pages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  for (const [url] of PAGES) {
    await page.goto(url);
  }
  expect(errors).toEqual([]);
});
