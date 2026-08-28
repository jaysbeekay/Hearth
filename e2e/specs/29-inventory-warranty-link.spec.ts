import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #241 — an Inventory item can register its warranty against a Product
// (Warranty) record, visible from both sides, via a real FK
// (InventoryItem.warrantyProductId -> Product) rather than a free-text ID.
test.describe.serial("Inventory warranty linking", () => {
  let productId: string;

  test("enable the Inventory module", async ({ page }) => {
    await page.goto("/settings/modules");
    const row = page.locator("li", { hasText: "Inventory" });
    await expect(row).toBeVisible();

    if (await row.getByRole("button", { name: "Enable" }).count()) {
      await row.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }
  });

  test("create a warranty", async ({ page }) => {
    await page.goto("/products/new");
    await page.locator("#description").fill("Warranty Link Test Warranty");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/products\/(?!new$)[^/]+$/);

    productId = new URL(page.url()).pathname.split("/").pop()!;
    expect(productId).toBeTruthy();
  });

  test("create an inventory item linking that warranty", async ({ page }) => {
    await page.goto("/inventory/new");
    await page.locator("#label").fill("Warranty Link Test Item");
    await page.locator("label", { hasText: "Warranty registered" }).locator("input").check();
    await page
      .locator("#warrantyProductId")
      .selectOption({ label: "Warranty Link Test Warranty" });
    await page.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);

    await expect(page.locator("body")).toContainText("Warranty Link Test Item");
  });

  test("the linked warranty shows the inventory item back-reference", async ({ page }) => {
    await page.goto(`/products/${productId}`);
    await expect(page.getByText("Linked to")).toBeVisible();
    await expect(page.getByText("Warranty Link Test Item")).toBeVisible();
    await expect(page.getByText("Inventory item — warranty registered here")).toBeVisible();
  });

  test("deleting the warranty clears the inventory item's link instead of orphaning it", async ({
    page,
  }) => {
    await page.goto(`/products/${productId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete warranty", exact: true }).click();
    await page.waitForURL(/\/products$/);

    // Permanently delete from Trash so the FK's SetNull actually fires
    // (soft-delete alone leaves the row, and the link, intact).
    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: "Warranty Link Test Warranty" });
    await row.getByRole("button", { name: "Delete permanently" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(page.locator("body")).not.toContainText("Warranty Link Test Warranty");

    await page.goto("/inventory");
    const itemLink = page.locator("a", { hasText: "Warranty Link Test Item" });
    await itemLink.click();
    await page.waitForURL(/\/inventory\/[^/]+$/);
    await expect(page.locator("body")).toContainText("Warranty Link Test Item");
  });
});
