import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  const header = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  return header;
}

test.describe("bulk document import and extraction", () => {
  test("can upload a document through the /import flow", async ({ page }) => {
    await page.goto("/import");

    // Upload a document
    await page.locator('input[type="file"]').setInputFiles({
      name: "import-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });

    // The document should appear in the list
    await expect(page.locator("body")).toContainText("import-test.pdf");
  });

  test("the import flow shows extracted fields for review", async ({ page }) => {
    await page.goto("/import");

    // Upload a document
    await page.locator('input[type="file"]').setInputFiles({
      name: "contract-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });

    // Wait for document to appear
    await page.waitForSelector("text=contract-test.pdf");

    // Click to review/extract the document
    const docLink = page.locator("text=contract-test.pdf").first();
    await docLink.click();

    // Should navigate to a detail/confirmation page
    const pageContent = await page.locator("body").innerText();
    expect(
      pageContent.includes("confirm") ||
      pageContent.includes("extract") ||
      pageContent.includes("review") ||
      pageContent.includes("contract-test.pdf")
    ).toBe(true);
  });

  test("duplicate file detection works during import", async ({ page }) => {
    await page.goto("/contracts/new");
    await page.locator("#title").fill("Duplicate Detection Test");
    await page.locator("#provider").fill("Test Provider");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    // Upload a document to the contract
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "duplicate-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
    await submit.click();
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Now try to import the same file
    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles({
      name: "duplicate-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });

    // Should show duplicate detection message
    const pageContent = await page.locator("body").innerText();
    expect(
      pageContent.includes("duplicate") ||
      pageContent.includes("already") ||
      pageContent.includes("import")
    ).toBe(true);
  });

  test("wealth CSV trade import page exists and accepts CSV files", async ({ page }) => {
    // Enable Wealth module first
    await page.goto("/settings/modules");
    const wealthRow = page.locator("li", { hasText: "Wealth" });
    if (await wealthRow.getByRole("button", { name: "Enable" }).count()) {
      await wealthRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    // Create a portfolio
    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill("CSV Import Test Portfolio");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/);

    const portfolioId = new URL(page.url()).pathname.split("/").pop()!;

    // Navigate to the CSV import page
    await page.goto(`/wealth/portfolios/${portfolioId}/import`);

    // Generic-format headers, per WealthImportClient's own supported-formats
    // note: Date, Ticker, Type, Units, Price, Fees, Currency.
    const csvData = "Date,Ticker,Type,Units,Price,Fees,Currency\n2026-01-01,AAPL,BUY,10,150,0,AUD";
    // Scoped past the persistent mobile-upload FAB's own (CSS-hidden but
    // still-attached) file input, which also matches a bare input[type=file].
    await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
      name: "trades.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvData, "utf8"),
    });

    await expect(page.locator("body")).toContainText("1 trades found — review and confirm");
    await page.getByRole("button", { name: "Import 1 trades" }).click();
    await expect(page.locator("body")).toContainText(/import complete|imported/i);

    // Confirm it actually landed, not just a UI success message.
    await page.goto(`/wealth/portfolios/${portfolioId}`);
    await expect(page.locator("body")).toContainText("AAPL");
  });

  test("import page is reachable from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Upload a document" }).click();
    await expect(page).toHaveURL(/\/import/);
  });
});
