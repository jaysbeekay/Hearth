import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test.describe.serial("contracts and warranties can link to a property", () => {
  test("enable the Property module and create a property", async ({ page }) => {
    await page.goto("/settings/modules");
    const propertyRow = page.locator("li", { hasText: "Properties" });
    await expect(propertyRow).toBeVisible();
    if (await propertyRow.getByRole("button", { name: "Enable" }).count()) {
      await propertyRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    await page.goto("/home/new");
    await page.locator("#label").fill("Linking Test Property");
    await page.locator("main button[type=submit]").click();
    // "/home/new" itself satisfies a bare /\/home\/[^/]+$/, so without
    // excluding it this resolves instantly instead of waiting for the
    // post-submit redirect — the test then tore down its context mid-POST and
    // the property was never written (ECONNRESET server-side). Same footgun
    // guarded against in seed.setup.ts for /travel/.
    await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
  });

  test("a contract can be linked to a property and shows up on its detail page", async ({
    page,
  }) => {
    await page.goto("/contracts/new");
    await page.locator("#title").fill("Property-Linked Insurance");
    await page.locator("#provider").fill("Test Insurer");
    // #370 — one grouped "Linked to" select for homes and vehicles.
    const propertySelect = page.getByLabel("Linked to");
    await expect(propertySelect).toBeVisible();
    await propertySelect.selectOption({ label: "Linking Test Property" });
    await page.locator("main button[type=submit]").click();
    // Exclude "new" itself — same footgun as line 19's /home/new note above,
    // here for /contracts/new.
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    await page.goto("/home");
    await page.locator("a", { hasText: "Linking Test Property" }).first().click();
    await page.waitForURL(/\/home\/[^/]+$/);

    await expect(page.getByText("Contracts and warranties linked to this property")).toBeVisible();
    await expect(page.getByText("Property-Linked Insurance")).toBeVisible();
  });

  // #456 - "Add insurance" opens the contract form already linked to the property.
  test("Add insurance on a property opens the contract form pre-linked", async ({ page }) => {
    await page.goto("/home");
    await page.locator("a", { hasText: "Linking Test Property" }).first().click();
    await page.waitForURL(/\/home\/[^/]+$/);
    const propertyId = new URL(page.url()).pathname.split("/").pop()!;

    await page.getByRole("link", { name: "Add insurance" }).click();
    await page.waitForURL(/\/contracts\/new\?/);
    await expect(page.locator("#category")).toHaveValue("HOME_INSURANCE");
    await expect(page.getByLabel("Linked to")).toHaveValue(`property:${propertyId}`);
  });

  test("a contract not linked to any property doesn't appear on the property's detail page", async ({
    page,
  }) => {
    await page.goto("/contracts/new");
    await page.locator("#title").fill("Unlinked Contract");
    await page.locator("#provider").fill("Some Provider");
    await page.locator("main button[type=submit]").click();
    // Exclude "new" itself — same footgun as line 19's /home/new note above,
    // here for /contracts/new.
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    await page.goto("/home");
    await page.locator("a", { hasText: "Linking Test Property" }).first().click();
    await page.waitForURL(/\/home\/[^/]+$/);

    await expect(page.getByText("Unlinked Contract")).toHaveCount(0);
  });
});
