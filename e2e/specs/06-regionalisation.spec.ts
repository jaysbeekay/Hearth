import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test("switching region changes number formatting, and resets cleanly", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Region Format Test Contract");
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Region Format Test Provider");
  await page.locator("#cost").fill("1234.5");
  await page.locator("main button[type=submit]").click();
  // Exclude "new" itself — see 01-regression.spec.ts's "create a contract
  // end-to-end" for why a bare /\/contracts\/[^/]+$/ resolves instantly here.
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  // Default region (Australia) uses "." for decimals and "," for thousands.
  await expect(page.locator("body")).toContainText("1,234.50");

  await page.goto("/settings#preferences");
  await page.locator("#region").selectOption("de-DE");
  // #363 — one Save changes per Settings screen.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#main").getByText("Preferences saved.")).toBeVisible();

  await page.goto("/contracts");
  await page.getByText("Region Format Test Contract").click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  // German convention swaps the separators: "1.234,50".
  await expect(page.locator("body")).toContainText("1.234,50");

  // Reset back to the default so this test doesn't leak state into later runs.
  await page.goto("/settings#preferences");
  await page.locator("#region").selectOption("en-AU");
  // #363 — one Save changes per Settings screen.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#main").getByText("Preferences saved.")).toBeVisible();
});
