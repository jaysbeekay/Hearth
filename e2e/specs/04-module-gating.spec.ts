import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test.describe.serial("module-toggle gating", () => {
  test("disabling Travel hides the nav item and redirects /travel", async ({ page }) => {
    await page.goto("/settings/modules");
    await page.locator('button:has-text("Disable")').first().click();
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
    await page.locator('button:has-text("Enable")').first().click();
    await expect(page.locator("body")).toContainText("Module enabled.");

    await page.goto("/dashboard");
    await expect(page.locator("body")).toContainText("Travel");

    await page.goto("/travel");
    await expect(page).toHaveURL(/\/travel$/);
  });
});
