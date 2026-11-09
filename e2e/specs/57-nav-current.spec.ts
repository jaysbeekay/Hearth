import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #558: the nav marks where you are with aria-current. The link to the page
// you're on is "page"; a section link above it (Contracts on a contract,
// Settings on a Settings section) is "true", so only one link per nav
// claims to be the current page.

test.use({ storageState: ADMIN_AUTH_FILE });

const sidebar = (page: Page) => page.locator("aside nav");
const bottomBar = (page: Page) => page.locator("nav.fixed.bottom-0");
const moreSheet = (page: Page) => page.getByRole("dialog", { name: "More navigation options" });

test.describe("desktop sidebar", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("marks the current page, and only that one", async ({ page }) => {
    await page.goto("/contracts");
    const current = sidebar(page).locator("[aria-current]");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Contracts");
    await expect(current).toHaveAttribute("aria-current", "page");
  });

  test("marks a section above the current page as true, not page", async ({ page }) => {
    await page.goto("/settings/household");
    const settings = page.locator("aside").getByRole("link", { name: "Settings", exact: true });
    await expect(settings).toHaveAttribute("aria-current", "true");
    // The Settings tabs own the "page" marker on this route.
    await expect(
      page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Household" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator('aside [aria-current="page"]')).toHaveCount(0);
    // Across the whole page, sidebar and Settings tabs together, one link
    // claims to be the current page.
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(1);
  });

  test("a record page claims no current page in the nav", async ({ page }) => {
    await page.goto("/contracts/new");
    const contracts = page.locator("aside").getByRole("link", { name: "Contracts", exact: true });
    await expect(contracts).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(0);
  });

  test("marks nothing on a page outside the nav", async ({ page }) => {
    await page.goto("/import");
    await expect(page.locator("aside [aria-current]")).toHaveCount(0);
  });
});

test.describe("phone tab bar and More sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the tab bar marks the current tab", async ({ page }) => {
    await page.goto("/contracts");
    const current = bottomBar(page).locator("[aria-current]");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Contracts");
    await expect(current).toHaveAttribute("aria-current", "page");
  });

  test("the More sheet marks a page that lives in it", async ({ page }) => {
    await page.goto("/vehicles");
    await expect(bottomBar(page).locator("[aria-current]")).toHaveCount(0);
    // Retried: a tap that lands before hydration does nothing.
    await expect(async () => {
      await bottomBar(page).getByRole("button", { name: /More navigation options/ }).click();
      await expect(moreSheet(page)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(moreSheet(page).getByRole("link", { name: "Vehicles" })).toHaveAttribute("aria-current", "page");
  });
});
