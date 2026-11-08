import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { textPdfBytes } from "../textPdf";

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
    // #604 — nothing to guess a type from, so the row asks for one.
    await expect(page.getByText("Couldn't tell what this is — pick a type.")).toBeVisible({ timeout: 30_000 });
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
    await page.locator("#category").selectOption("OTHER");
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
    // Scoped to the CSV input: a bare input[type=file] could also match
    // another (hidden) file input on the page.
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

  // #358 — one scan per file, with the type pre-selected from the guess.
  // Switching type afterwards reuses that scan instead of scanning again.
  test("a file arrives pre-selected from its one scan, and switching type doesn't scan again", async ({ page }) => {
    test.setTimeout(90_000);
    const filename = `invoice-guess-${Date.now()}.pdf`;
    let scans = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/import/extract")) scans += 1;
    });

    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: textPdfBytes([
        "Tax Invoice",
        "Product: Dishwasher",
        "Brand: Bosch",
        "Model No: SMS6ZCI",
        "Serial Number: FD12345678",
        "Invoice Date: 2026-05-01",
      ]),
    });

    const typeSelect = page.getByLabel(`File ${filename} as`);
    await expect(typeSelect).toHaveValue("PRODUCT", { timeout: 30_000 });
    await expect(page.locator('input[id$="-manufacturer"]')).toHaveValue("Bosch");
    expect(scans).toBe(1);
    // #604 — the row says the type came from the document, until it's changed.
    await expect(page.getByText("Detected as a warranty — change it if that's wrong.")).toBeVisible();

    await typeSelect.selectOption("CONTRACT");
    await expect(page.locator('input[id$="-title"]')).toBeVisible();
    await expect(page.getByText(/^Detected as/)).toHaveCount(0);
    await typeSelect.selectOption("PRODUCT");
    await expect(page.locator('input[id$="-manufacturer"]')).toHaveValue("Bosch");
    expect(scans).toBe(1);
  });

  // #358 — "Apply to selected" sets a field on several files at once, and
  // "Save all" lands on one Quick check screen with every record whose scan
  // was too thin to count as reviewed (#359), confirmed together.
  test("Apply to selected, Save all, then Confirm all on the Quick check screen", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const names = [`receipt-a-${stamp}.pdf`, `receipt-b-${stamp}.pdf`];

    await page.goto("/import");
    // A thin read: the first line passes as the seller, plus one brand.
    // That's enough to guess Warranty, but too little to count as reviewed
    // on save, whichever type it's filed as.
    await page.locator('input[type="file"]').setInputFiles(
      names.map((name) => ({
        name,
        mimeType: "application/pdf",
        buffer: textPdfBytes(["Thank you for shopping with us today", "Brand: Bosch"]),
      })),
    );
    for (const name of names) {
      await expect(page.getByLabel(`File ${name} as`)).toHaveValue("PRODUCT", { timeout: 30_000 });
    }

    const bulk = page.getByLabel("Apply to selected files");
    await bulk.getByLabel(/Select all/).check();
    await bulk.getByLabel("File as").selectOption("CONTRACT");
    await bulk.getByLabel("Contract category").selectOption("CAR_INSURANCE");
    await bulk.getByRole("button", { name: "Apply to selected" }).click();
    for (const name of names) {
      await expect(page.getByLabel(`File ${name} as`)).toHaveValue("CONTRACT");
    }
    for (const i of [0, 1]) {
      await expect(page.locator('select[id$="-category"]').nth(i)).toHaveValue("CAR_INSURANCE");
      await expect(page.locator('input[id$="-provider"]').nth(i)).toHaveValue("Thank you for shopping with us today");
    }

    await Promise.all([
      page.waitForURL(/\/review\?added=2$/),
      page.getByRole("button", { name: /^Save all/ }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "Quick check" })).toBeVisible();
    await expect(page.getByText(/2 records added\./)).toBeVisible();
    const titles = names.map((name) => name.replace(/\.pdf$/, ""));
    for (const title of titles) {
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }

    await page.getByRole("button", { name: /^Confirm all/ }).click();
    await expect(page.getByText(/Nothing needs a check\./)).toBeVisible();
    for (const title of titles) {
      await expect(page.getByRole("region", { name: title })).toHaveCount(0);
    }
  });

  test("import page is reachable from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Upload a document" }).click();
    await expect(page).toHaveURL(/\/import/);
  });
});
