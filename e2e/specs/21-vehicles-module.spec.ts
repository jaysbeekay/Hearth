import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

test.describe.serial("Vehicles module", () => {
  let vehicleId: string;
  let itemId: string;

  test("enable the Vehicles module", async ({ page }) => {
    await page.goto("/settings/modules");
    const vehiclesRow = page.locator("li", { hasText: "Vehicles" });
    await expect(vehiclesRow).toBeVisible();

    if (await vehiclesRow.getByRole("button", { name: "Enable" }).count()) {
      await vehiclesRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }
  });

  test("create a vehicle", async ({ page }) => {
    await page.goto("/vehicles/new");
    await page.locator("#label").fill("Test Vehicle");
    await page.locator("#make").fill("Toyota");
    await page.locator("#model").fill("Camry");
    await page.locator("#year").fill("2020");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    // Exclude "new" itself — a bare /vehicles\/[^/]+$/ also matches while
    // still on /vehicles/new, before the real post-submit redirect.
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    vehicleId = new URL(page.url()).pathname.split("/").pop()!;
    expect(vehicleId).toBeTruthy();
    await expect(page.locator("body")).toContainText("Test Vehicle");
  });

  test("add a service record to the vehicle", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.getByRole("link", { name: "Add record" }).click();
    await page.waitForURL(/\/vehicles\/[^/]+\/items\/new$/);

    await page.locator("#title").fill("Test Service Record");
    await page.getByRole("button", { name: "Add record" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Test Service Record",
    });
    const editHref = await row.getByRole("link", { name: "Edit" }).getAttribute("href");
    itemId = editHref!.split("/").slice(-2, -1)[0];
    expect(itemId).toBeTruthy();
    await expect(page.locator("body")).toContainText("Test Service Record");
  });

  test("upload a document to the service record", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);

    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Test Service Record",
    });
    await row.locator('input[type="file"]').setInputFiles({
      name: "maintenance.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    await row.getByRole("button", { name: "Upload" }).click();
    await expect(row).toContainText("Document uploaded.");

    const fileDir = path.join(UPLOADS_DIR, "vehicle-items", itemId);
    expect(fs.existsSync(fileDir)).toBe(true);
  });

  test("edit the service record", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}/items/${itemId}/edit`);
    await page.locator("#title").fill("Updated Service Record");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    await expect(page.locator("body")).toContainText("Updated Service Record");
  });

  test("deleting the service record removes its files from disk", async ({ page }) => {
    const fileDir = path.join(UPLOADS_DIR, "vehicle-items", itemId);
    expect(fs.existsSync(fileDir)).toBe(true);

    await page.goto(`/vehicles/${vehicleId}`);
    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Updated Service Record",
    });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: 'Delete "Updated Service Record"' }).click();

    await expect(page.locator("body")).not.toContainText("Updated Service Record");
    expect(fs.existsSync(fileDir)).toBe(false);
  });

  test("delete the vehicle", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete vehicle" }).click();
    await page.waitForURL(/\/vehicles$/);

    await expect(page.locator("body")).not.toContainText("Test Vehicle");
  });
});
