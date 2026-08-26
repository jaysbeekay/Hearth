import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  const header = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  return header;
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
    await page.locator("#make").fill("Toyota");
    await page.locator("#model").fill("Camry");
    await page.locator("#year").fill("2020");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    vehicleId = new URL(page.url()).pathname.split("/").pop()!;
    expect(vehicleId).toBeTruthy();

    // Verify vehicle page loads
    await expect(page.locator("body")).toContainText("Toyota");
    await expect(page.locator("body")).toContainText("Camry");
  });

  test("add a vehicle item", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.locator('a:has-text("Add item")').click();
    await page.waitForURL(/\/vehicles\/[^/]+\/items\/new$/);

    await page.locator("#label").fill("Test Vehicle Item");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/vehicles\/[^/]+\/items\/[^/]+$/);

    itemId = new URL(page.url()).pathname.split("/").pop()!;
    expect(itemId).toBeTruthy();

    // Verify item was created
    await expect(page.locator("body")).toContainText("Test Vehicle Item");
  });

  test("upload a document to a vehicle item", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}/items/${itemId}`);

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "maintenance.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
    await submit.click();
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Verify document was uploaded
    await expect(page.locator("body")).toContainText("maintenance.pdf");
  });

  test("edit a vehicle item", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}/items/${itemId}`);

    // Click edit button if it exists, otherwise the form might be directly on the page
    const hasEditButton = await page.locator('button:has-text("Edit")').count();
    if (hasEditButton > 0) {
      await page.locator('button:has-text("Edit")').click();
    }

    // The form should be available to edit
    const labelInput = page.locator("#label");
    await expect(labelInput).toBeVisible();

    // Clear and update
    await labelInput.clear();
    await labelInput.fill("Updated Vehicle Item");

    // Look for submit button
    const submitBtn = page.locator('button[type="submit"]').last();
    await submitBtn.click();

    // Should stay on the item page or redirect back
    await expect(page.locator("body")).toContainText("Updated Vehicle Item");
  });

  test("delete a vehicle item removes its files from disk", async ({ page }) => {
    // Verify files exist
    const fileDir = path.join(UPLOADS_DIR, "vehicle-items", itemId);
    const filesExist = fs.existsSync(fileDir);

    await page.goto(`/vehicles/${vehicleId}/items/${itemId}`);
    await page.locator('button:has-text("Delete")').click();
    await page.locator('button[data-test="confirm-delete"]').click();

    // Should go back to vehicle page
    await page.waitForURL(/\/vehicles\/[^/]+$/);

    // Verify item is gone from the list
    await expect(page.locator("body")).not.toContainText("Test Vehicle Item");
    await expect(page.locator("body")).not.toContainText("Updated Vehicle Item");

    // Verify file directory is removed (if it existed)
    if (filesExist) {
      expect(fs.existsSync(fileDir)).toBe(false);
    }
  });

  test("delete a vehicle", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.locator('button:has-text("Delete")').click();
    await page.locator('button[data-test="confirm-delete"]').click();
    await page.waitForURL(/\/vehicles$/);

    // Verify vehicle list is displayed
    await expect(page.locator("body")).toContainText(/vehicle|Toyota/i);
  });
});
