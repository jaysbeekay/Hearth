import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

// #259 predates #287's soft-delete: deleting a contract/product used to
// remove its files from disk immediately. It now moves the record to Trash
// instead — files (and the DB row) stay put until "Delete permanently" is
// used from there, so these check the full lifecycle rather than just the
// first step.

test("deleting a contract moves it to Trash without touching its files, until permanently deleted", async ({
  page,
}) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Delete Test Contract");
  await page.locator("#provider").fill("Test Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const contractId = new URL(page.url()).pathname.split("/").pop()!;

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: 10_000 });

  const fileDir = path.join(UPLOADS_DIR, contractId);
  expect(fs.existsSync(fileDir)).toBe(true);
  expect(fs.readdirSync(fileDir).length).toBeGreaterThan(0);

  await page.goto(`/contracts/${contractId}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete contract", exact: true }).click();
  await page.waitForURL(/\/contracts$/);

  // Soft-deleted: gone from the active list, but the files are untouched.
  await expect(page.locator("body")).not.toContainText("Delete Test Contract");
  expect(fs.existsSync(fileDir)).toBe(true);

  await page.goto("/settings/trash");
  await expect(page.locator("body")).toContainText("Delete Test Contract");

  const row = page.locator("li", { hasText: "Delete Test Contract" });
  await row.getByRole("button", { name: "Delete permanently" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete permanently" })
    .click();
  await expect(page.locator("body")).not.toContainText("Delete Test Contract");

  expect(fs.existsSync(fileDir)).toBe(false);
});

test("deleting a product moves it to Trash without touching its files, until permanently deleted", async ({
  page,
}) => {
  await page.goto("/products/new");
  await page.locator("#description").fill("Delete Test Product");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
  const productId = new URL(page.url()).pathname.split("/").pop()!;

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: 10_000 });

  const fileDir = path.join(UPLOADS_DIR, "products", productId);
  expect(fs.existsSync(fileDir)).toBe(true);
  expect(fs.readdirSync(fileDir).length).toBeGreaterThan(0);

  await page.goto(`/products/${productId}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete warranty", exact: true }).click();
  await page.waitForURL(/\/products$/);

  await expect(page.locator("body")).not.toContainText("Delete Test Product");
  expect(fs.existsSync(fileDir)).toBe(true);

  await page.goto("/settings/trash");
  await expect(page.locator("body")).toContainText("Delete Test Product");

  const row = page.locator("li", { hasText: "Delete Test Product" });
  await row.getByRole("button", { name: "Delete permanently" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete permanently" })
    .click();
  await expect(page.locator("body")).not.toContainText("Delete Test Product");

  expect(fs.existsSync(fileDir)).toBe(false);
});
