import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test("switching region changes number formatting, and resets cleanly", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Region Format Test Contract");
  await page.locator("#provider").fill("Region Format Test Provider");
  await page.locator("#cost").fill("1234.5");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  // Default region (Australia) uses "." for decimals and "," for thousands.
  await expect(page.locator("body")).toContainText("1,234.50");

  await page.goto("/settings");
  await page.locator("#region").selectOption("de-DE");
  await page.locator('form:has(#region) button[type="submit"]').click();
  await expect(page.locator("body")).toContainText("Save preferences");

  await page.goto("/contracts");
  await page.getByText("Region Format Test Contract").click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  // German convention swaps the separators: "1.234,50".
  await expect(page.locator("body")).toContainText("1.234,50");

  // Reset back to the default so this test doesn't leak state into later runs.
  await page.goto("/settings");
  await page.locator("#region").selectOption("en-AU");
  await page.locator('form:has(#region) button[type="submit"]').click();
  await expect(page.locator("body")).toContainText("Save preferences");
});
