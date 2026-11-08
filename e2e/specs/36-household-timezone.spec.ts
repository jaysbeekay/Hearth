import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, MEMBER_AUTH_FILE } from "../env";

// #383 — reminders and due dates will count days in the household
// timezone. Admins set it in Household settings; everyone else only sees it.

async function saveHouseholdTimeZone(page: Page, value: string) {
  await page.goto("/settings/household");
  // Already set: nothing to save, so Save changes stays disabled.
  if ((await page.locator("#householdTimeZone").inputValue()) === value) return;
  await page.locator("#householdTimeZone").selectOption(value);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("body")).toContainText("Household timezone saved.");
}

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  // Put the server default back even if a test fails midway, so no later
  // spec runs with a stored household timezone.
  test.afterEach(async ({ page }) => {
    await saveHouseholdTimeZone(page, "");
  });

  test("saves the household timezone, and clearing it goes back to the server default", async ({ page }) => {
    await page.goto("/settings/household");
    const select = page.locator("#householdTimeZone");
    await expect(select).toHaveValue("");
    await expect(select.locator("option").first()).toContainText("Server default");

    await saveHouseholdTimeZone(page, "Australia/Perth");

    await page.goto("/settings");
    await expect(page.locator("body")).toContainText("The household timezone is Australia/Perth.");

    await page.goto("/settings/household");
    await expect(page.locator("#householdTimeZone")).toHaveValue("Australia/Perth");
    await saveHouseholdTimeZone(page, "");
    await page.reload();
    await expect(page.locator("#householdTimeZone")).toHaveValue("");
  });

  test("any IANA zone can be saved, not just the common ones, and stays selected", async ({ page }) => {
    await saveHouseholdTimeZone(page, "Pacific/Kiritimati");
    await page.reload();
    await expect(page.locator("#householdTimeZone")).toHaveValue("Pacific/Kiritimati");
  });
});

test.describe("as a member", () => {
  test.use({ storageState: MEMBER_AUTH_FILE });

  test("sees the household timezone read-only, on both Settings screens", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("body")).toContainText("The household timezone is");
    await expect(page.locator("body")).toContainText("Only an admin can change it.");
    await expect(page.locator("#householdTimeZone")).toHaveCount(0);

    // #363 — members can open Household settings; the timezone is text there.
    await page.goto("/settings/household");
    await expect(page).toHaveURL(/\/settings\/household$/);
    await expect(page.locator("main")).toContainText("Only an admin can change it.");
    await expect(page.locator("#householdTimeZone")).toHaveCount(0);
  });
});
