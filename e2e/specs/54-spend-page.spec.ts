import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #367 — Spend warns about the same contracts the dashboard leaves out,
// leads with the category breakdown, folds the timeline, and projects the
// next 12 months instead of monthly × 12.

test("Spend warns about a cost with no billing frequency and leads with categories", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Spend No Frequency ${Date.now()}`);
  await page.locator("#category").selectOption("UTILITY");
  await page.locator("#provider").fill("Spend Provider");
  await page.locator("#cost").fill("40");
  // #361 — a cost defaults the frequency to Monthly; "" picks Not set back.
  await page.selectOption("#billingFrequency", "");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);

  await page.goto("/spend");
  const main = page.locator("main");
  await expect(main.getByText(/contracts? (has|have) a cost but no billing frequency/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Set the billing frequency" })).toHaveAttribute(
    "href",
    "/contracts?missing=details",
  );
  await expect(main.getByText("Next 12 months", { exact: true })).toBeVisible();
  await expect(main.getByText("Annual projection")).toHaveCount(0);

  // The timeline is folded until opened, and stays open on the Yearly toggle.
  const timeline = main.locator("details", { hasText: "Recurring cost over time" });
  await expect(timeline).not.toHaveAttribute("open", "");
  await timeline.locator("summary").click();
  await timeline.getByRole("link", { name: "Yearly" }).click();
  await page.waitForURL(/view=yearly/);
  await expect(main.locator("details", { hasText: "Recurring cost over time" })).toHaveAttribute("open", "");
  await expect(main.getByText("Last 5 years", { exact: true })).toBeVisible();
});
