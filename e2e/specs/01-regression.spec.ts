import { test, expect, type Locator, type Page } from "@playwright/test";
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

// Settings lives in the account menu, behind the sidebar's avatar button.
async function sidebarLink(page: Page, label: string) {
  const sidebar = page.getByRole("complementary");
  if (label === "Settings") {
    const account = sidebar.getByRole("button", { name: /account menu$/ });
    if ((await account.getAttribute("aria-expanded")) !== "true") await account.click();
  }
  return sidebar.getByRole("link", { name: label, exact: true });
}

test("all nav items appear together on one page", async ({ page }) => {
  await page.goto("/dashboard");
  for (const [, label] of TOP_LEVEL) {
    await expect(await sidebarLink(page, label)).toBeVisible();
  }
});

test("account menu: Escape returns focus to the avatar, a click on a field keeps it there", async ({ page }) => {
  await page.goto("/contracts/new");
  const account = page.getByRole("complementary").getByRole("button", { name: /account menu$/ });
  await account.click();
  await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Account" })).toBeHidden();
  await expect(account).toBeFocused();

  await account.click();
  await page.locator("#title").click();
  await expect(page.getByRole("dialog", { name: "Account" })).toBeHidden();
  await expect(page.locator("#title")).toBeFocused();
});

// The current footer entry has a bar, not only the accent colour (WCAG 1.4.1, #558).
async function barWidth(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el, "::after").width);
}

test("account footer: the current entry has aria-current and a bar, not just colour", async ({ page }) => {
  const sidebar = page.getByRole("complementary");
  const account = sidebar.getByRole("button", { name: /account menu$/ });
  const help = sidebar.getByRole("link", { name: "Help", exact: true });

  await page.goto("/help");
  await expect(help).toHaveAttribute("aria-current", "page");
  expect(await barWidth(help)).toBe("2px");
  expect(await barWidth(account)).not.toBe("2px");

  await page.goto("/settings");
  await expect(help).not.toHaveAttribute("aria-current", "page");
  expect(await barWidth(help)).not.toBe("2px");
  expect(await barWidth(account)).toBe("2px");
  await account.click();
  const settings = page.getByRole("dialog", { name: "Account" }).getByRole("link", { name: "Settings", exact: true });
  await expect(settings).toHaveAttribute("aria-current", "page");
  expect(await barWidth(settings)).toBe("2px");
});

test("nav label, page heading and document title agree for every top-level page", async ({ page }) => {
  for (const [url, label] of TOP_LEVEL) {
    await page.goto(url);
    await expect(await sidebarLink(page, label)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(label);
    await expect(page).toHaveTitle(`${label} · Hearth`);
  }
});

test("create a contract end-to-end", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Regression Test Contract");
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Regression Test Provider");
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
