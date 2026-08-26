import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  const header = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  return header;
}

test("deleting a contract removes its document files from disk", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Delete Test Contract");
  await page.locator("#provider").fill("Test Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const contractId = new URL(page.url()).pathname.split("/").pop()!;

  // Upload a document
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: 10_000 });

  // Verify file exists
  const fileDir = path.join(UPLOADS_DIR, contractId);
  expect(fs.existsSync(fileDir)).toBe(true);
  const files = fs.readdirSync(fileDir);
  expect(files.length).toBeGreaterThan(0);

  // Delete the contract
  await page.goto(`/contracts/${contractId}`);
  await page.locator('button:has-text("Delete")').click();
  await page.locator('button[data-test="confirm-delete"]').click();
  await page.waitForURL(/\/contracts$/);

  // Verify file directory is gone
  expect(fs.existsSync(fileDir)).toBe(false);
});

test("deleting a product removes its document files from disk", async ({ page }) => {
  await page.goto("/products/new");
  await page.locator("#title").fill("Delete Test Product");
  await page.locator("#category").selectOption("APPLIANCE");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
  const productId = new URL(page.url()).pathname.split("/").pop()!;

  // Upload a document
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: 10_000 });

  // Verify file exists
  const fileDir = path.join(UPLOADS_DIR, "products", productId);
  expect(fs.existsSync(fileDir)).toBe(true);
  const files = fs.readdirSync(fileDir);
  expect(files.length).toBeGreaterThan(0);

  // Delete the product
  await page.goto(`/products/${productId}`);
  await page.locator('button:has-text("Delete")').click();
  await page.locator('button[data-test="confirm-delete"]').click();
  await page.waitForURL(/\/products$/);

  // Verify file directory is gone
  expect(fs.existsSync(fileDir)).toBe(false);
});
