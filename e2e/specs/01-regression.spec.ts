import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

const PAGES: Array<[string, string[]]> = [
  ["/dashboard", ["Dashboard"]],
  ["/contracts", ["Contracts"]],
  ["/products", ["Products"]],
  ["/settings", ["Settings"]],
  ["/settings/webhooks", ["Webhook"]],
  ["/settings/modules", ["Travel"]],
  ["/travel", ["Travel", "E2E Trip A"]],
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
  await expect(body).toContainText("Contracts");
  // Products' nav label reads "Warranties" (matches what users search for);
  // the /products route, page heading, and data model are unchanged.
  await expect(body).toContainText("Warranties");
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
  await page.waitForURL(/\/contracts\/[^/]+$/);
  await expect(page.locator("body")).toContainText("Regression Test Contract");
});

test("create a product end-to-end", async ({ page }) => {
  await page.goto("/products/new");
  await page.locator("#name").fill("Regression Test Product");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/products\/[^/]+$/);
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
