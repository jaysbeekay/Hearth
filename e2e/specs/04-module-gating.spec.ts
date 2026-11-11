import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test.describe.serial("module-toggle gating", () => {
  test("disabling Travel hides the nav item and redirects /travel", async ({ page }) => {
    await page.goto("/settings/modules");
    const travelRow = page.locator("li", { hasText: "Travel" });
    await travelRow.getByRole("button", { name: "Disable" }).click();
    await expect(page.locator("body")).toContainText("Module disabled.");

    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toContainText("Travel");

    await page.goto("/travel");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // Leaves Travel enabled afterwards so the suite's state matches what
  // seed.setup.ts established, in case these specs are re-run in isolation.
  test("re-enabling Travel restores the nav item and route access", async ({ page }) => {
    await page.goto("/settings/modules");
    const travelRow = page.locator("li", { hasText: "Travel" });
    await travelRow.getByRole("button", { name: "Enable" }).click();
    await expect(page.locator("body")).toContainText("Module enabled.");

    await page.goto("/dashboard");
    await expect(page.locator("body")).toContainText("Travel");

    await page.goto("/travel");
    await expect(page).toHaveURL(/\/travel$/);
  });

  // Inventory had a hard-coded nav carve-out until #597, so check the real
  // toggle → layout → sidebar path, not just getNavItems.
  test("disabling Inventory hides its sidebar link and redirects /inventory", async ({ page }) => {
    await page.goto("/settings/modules");
    const row = page.locator("li", { hasText: "Inventory" });
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(page.locator("body")).toContainText("Module disabled.");

    await page.goto("/dashboard");
    await expect(page.getByRole("complementary").getByRole("link", { name: "Inventory", exact: true })).toHaveCount(0);

    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("re-enabling Inventory restores its sidebar link and route access", async ({ page }) => {
    await page.goto("/settings/modules");
    const row = page.locator("li", { hasText: "Inventory" });
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(page.locator("body")).toContainText("Module enabled.");

    await page.goto("/dashboard");
    await expect(page.getByRole("complementary").getByRole("link", { name: "Inventory", exact: true })).toBeVisible();

    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/inventory$/);
  });
});
