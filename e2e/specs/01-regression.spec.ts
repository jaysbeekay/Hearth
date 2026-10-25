import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

const PAGES: Array<[string, string[]]> = [
  ["/dashboard", ["Dashboard"]],
  ["/contracts", ["Contracts"]],
  ["/products", ["Warranties"]],
  ["/travel", ["Travel"]],
  ["/home", ["Properties"]],
  ["/vehicles", ["Vehicles"]],
  ["/inventory", ["Inventory"]],
  ["/wealth", ["Wealth"]],
  ["/documents", ["Documents"]],
  ["/documents/inbox", ["Documents"]],
  ["/spend", ["Spending"]],
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

// #362 — one name per page: the sidebar link, the page's <h1> and its
// document title all use the same label. The /contracts, /products, /home,
// /calendar and /spend routes and the Prisma model names are unchanged.
const TOP_LEVEL: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/contracts", "Contracts"],
  ["/products", "Warranties"],
  ["/travel", "Travel"],
  ["/home", "Properties"],
  ["/vehicles", "Vehicles"],
  ["/wealth", "Wealth"],
  ["/documents", "Documents"],
  ["/calendar", "Upcoming"],
  ["/spend", "Spending"],
  ["/settings", "Settings"],
  ["/help", "Help"],
];

test("all nav items appear together on one page", async ({ page }) => {
  await page.goto("/dashboard");
  const sidebar = page.getByRole("complementary");
  for (const [, label] of TOP_LEVEL) {
    await expect(sidebar.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});

test("nav label, page heading and document title agree for every top-level page", async ({ page }) => {
  for (const [url, label] of TOP_LEVEL) {
    await page.goto(url);
    await expect(page.getByRole("complementary").getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(label);
    await expect(page).toHaveTitle(`${label} · Hearth`);
  }
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
