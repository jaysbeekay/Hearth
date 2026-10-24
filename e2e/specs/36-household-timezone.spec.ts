import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, MEMBER_AUTH_FILE } from "../env";

// #383 — the household timezone decides which day it is for Due day counts.
// Admins set it in Household & System; everyone else only sees it.

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  test("saves the household timezone, and clearing it goes back to the server default", async ({ page }) => {
    await page.goto("/settings/household");
    const select = page.locator("#householdTimeZone");
    await expect(select).toHaveValue("");
    await expect(select.locator("option").first()).toContainText("Server default");

    await select.selectOption("Australia/Perth");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.locator("body")).toContainText("Household timezone saved.");

    await page.goto("/settings");
    await expect(page.locator("body")).toContainText("counted in the household timezone, Australia/Perth");

    await page.goto("/settings/household");
    await expect(page.locator("#householdTimeZone")).toHaveValue("Australia/Perth");
    await page.locator("#householdTimeZone").selectOption("");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.locator("body")).toContainText("Household timezone saved.");
    await page.reload();
    await expect(page.locator("#householdTimeZone")).toHaveValue("");
  });
});

test.describe("as a member", () => {
  test.use({ storageState: MEMBER_AUTH_FILE });

  test("sees the household timezone read-only and can't open the admin page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("body")).toContainText("counted in the household timezone");
    await expect(page.locator("body")).toContainText("Only an admin can change it.");
    await expect(page.locator("#householdTimeZone")).toHaveCount(0);

    await page.goto("/settings/household");
    await expect(page).toHaveURL(/\/settings$/);
  });
});
