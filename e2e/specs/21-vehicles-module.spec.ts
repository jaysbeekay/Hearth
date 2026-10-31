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
    await page.getByRole("link", { name: "Add service record" }).click();
    await page.waitForURL(/\/vehicles\/[^/]+\/items\/new$/);

    await page.locator("#title").fill("Test Service Record");
    await page.getByRole("button", { name: "Add service record" }).click();
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

  // #287's soft-delete applies here too: deleting a service record moves it
  // to Trash and leaves its files untouched until "Delete permanently" is
  // used from there — mirrors the contract/product lifecycle checked in
  // 17-parent-delete-cleanup.spec.ts.
  test("deleting the service record moves it to Trash without touching its files, until permanently deleted", async ({
    page,
  }) => {
    const fileDir = path.join(UPLOADS_DIR, "vehicle-items", itemId);
    expect(fs.existsSync(fileDir)).toBe(true);

    await page.goto(`/vehicles/${vehicleId}`);
    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Updated Service Record",
    });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();

    // Soft-deleted: gone from the active list, but the files are untouched.
    await expect(page.locator("body")).not.toContainText("Updated Service Record");
    expect(fs.existsSync(fileDir)).toBe(true);

    await page.goto("/settings/trash");
    await expect(page.locator("body")).toContainText("Updated Service Record");

    const trashRow = page.locator("li", { hasText: "Updated Service Record" });
    await trashRow.getByRole("button", { name: "Delete permanently" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(page.locator("body")).not.toContainText("Updated Service Record");

    expect(fs.existsSync(fileDir)).toBe(false);
  });

  // #230 — purchase receipts/invoices/finance agreements previously had no
  // dedicated place on a vehicle; self-contained (creates and deletes its
  // own item) so it doesn't disturb the shared vehicleId/itemId lifecycle.
  test("add a purchase record with a document to the vehicle", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.getByRole("link", { name: "Add service record" }).click();
    await page.waitForURL(/\/vehicles\/[^/]+\/items\/new$/);

    await page.locator("#type").selectOption("PURCHASE");
    await page.locator("#title").fill("Test Purchase Record");
    await page.getByRole("button", { name: "Add service record" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Test Purchase Record",
    });
    await expect(row).toContainText("Purchase");

    await row.locator('input[type="file"]').setInputFiles({
      name: "purchase-invoice.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    await row.getByRole("button", { name: "Upload" }).click();
    await expect(row).toContainText("Document uploaded.");

    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.locator("body")).not.toContainText("Test Purchase Record");
  });

  // #240 — reuses the same reminderDaysBefore/threshold/channel pipeline as
  // regoExpiry/insuranceExpiry, so this checks the surfacing (detail page,
  // reminder health card, list-page badge), not the delivery pipeline
  // itself, matching this file's existing level of coverage for the sibling
  // expiry fields.
  test("setting a next service date surfaces a service reminder", async ({ page }) => {
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

    await page.goto(`/vehicles/${vehicleId}/edit`);
    await page.locator("#nextServiceDue").fill(soon);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    await expect(page.getByText("Next service due")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Service reminder" })).toBeVisible();

    await page.goto("/vehicles");
    const card = page.locator("a", { hasText: "Test Vehicle" });
    // #384 — the Due policy's label for a service date inside its window.
    await expect(card.getByText(/^Service due \d{1,2} [A-Z][a-z]{2}( \d{4})?$/)).toBeVisible();
  });

  // #456 - a Contract that Covers the Vehicle supplies its insurance date.
  test.describe.serial("a Contract that Covers the Vehicle", () => {
    let policyId: string;
    const policyTitle = "Covers E2E Policy";

    test("with no covering Contract, the manual date stays with a hint", async ({ page }) => {
      await page.goto(`/vehicles/${vehicleId}/edit`);
      await page.locator("#insuranceExpiry").fill("2031-01-01");
      await page.getByRole("button", { name: "Save changes" }).click();
      await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

      await expect(page.getByText("Insurance expiry")).toBeVisible();
      await expect(page.getByText("Add the policy as a contract to track cost and documents")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Insurance reminder" })).toBeVisible();
    });

    test("Add insurance opens the contract form pre-linked, as car insurance", async ({ page }) => {
      await page.goto(`/vehicles/${vehicleId}`);
      await page.getByRole("link", { name: "Add insurance" }).click();
      await page.waitForURL(/\/contracts\/new\?/);

      await expect(page.locator("#category")).toHaveValue("CAR_INSURANCE");
      await expect(page.getByLabel("Linked to")).toHaveValue(`vehicle:${vehicleId}`);

      await page.locator("#title").fill(policyTitle);
      await page.locator("#provider").fill("Allianz");
      await page.locator("#endDate").fill("2031-06-15");
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
      policyId = new URL(page.url()).pathname.split("/").pop()!;
    });

    test("the Vehicle shows the date as derived, read-only, with one Reminder stream", async ({ page }) => {
      await page.goto(`/vehicles/${vehicleId}`);
      await expect(page.getByRole("link", { name: `From ${policyTitle} →` })).toHaveAttribute(
        "href",
        `/contracts/${policyId}`,
      );
      await expect(page.getByText("Add the policy as a contract to track cost and documents")).toHaveCount(0);
      // The Contract's Reminders replace the Vehicle's own for this date.
      await expect(page.getByRole("heading", { name: "Insurance reminder" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Add insurance" })).toHaveCount(0);

      await page.goto(`/vehicles/${vehicleId}/edit`);
      await expect(page.locator("input#insuranceExpiry")).toHaveCount(0);
      await expect(page.getByRole("link", { name: `From ${policyTitle} →` })).toBeVisible();
    });

    test("saving the Vehicle keeps its manual date for when the Contract is cancelled", async ({ page }) => {
      await page.goto(`/vehicles/${vehicleId}/edit`);
      await page.getByRole("button", { name: "Save changes" }).click();
      await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

      await page.goto(`/contracts/${policyId}/edit`);
      await page.selectOption("#status", "CANCELLED");
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(new RegExp(`/contracts/${policyId}$`));

      await page.goto(`/vehicles/${vehicleId}`);
      await expect(page.getByRole("link", { name: `From ${policyTitle} →` })).toHaveCount(0);
      await expect(page.getByText("Add the policy as a contract to track cost and documents")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Insurance reminder" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Add insurance" })).toBeVisible();
    });

    test("a Registration Contract Covers the rego date the same way", async ({ page }) => {
      await page.goto(`/vehicles/${vehicleId}`);
      await page.getByRole("link", { name: "Add registration" }).click();
      await expect(page.locator("#category")).toHaveValue("REGISTRATION");
      await page.locator("#title").fill("Covers E2E Rego");
      await page.locator("#provider").fill("Transport Dept");
      await page.locator("#endDate").fill("2031-08-20");
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

      await page.goto(`/vehicles/${vehicleId}`);
      await expect(page.getByText("Rego expiry")).toBeVisible();
      await expect(page.getByRole("link", { name: "From Covers E2E Rego →" })).toBeVisible();
    });
  });

  test("delete the vehicle", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await page.waitForURL(/\/vehicles$/);

    await expect(page.locator("body")).not.toContainText("Test Vehicle");
  });
});
