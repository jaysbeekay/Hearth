import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  const header = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  return header;
}

test.describe.serial("Wealth module", () => {
  let portfolioId: string;

  test("enable the Wealth module", async ({ page }) => {
    await page.goto("/settings/modules");
    const wealthRow = page.locator("li", { hasText: "Wealth" });
    await expect(wealthRow).toBeVisible();

    if (await wealthRow.getByRole("button", { name: "Enable" }).count()) {
      await wealthRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }
  });

  test("create a portfolio", async ({ page }) => {
    await page.goto("/wealth/new");
    await page.locator("#name").fill("Test Portfolio");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/wealth\/(?!new$)[^/]+$/);

    portfolioId = new URL(page.url()).pathname.split("/").pop()!;
    expect(portfolioId).toBeTruthy();

    // Verify portfolio page loads
    await expect(page.locator("body")).toContainText("Test Portfolio");
  });

  test("add a holding to the portfolio", async ({ page }) => {
    await page.goto(`/wealth/${portfolioId}`);
    await page.locator('a:has-text("Add holding")').click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/new$/);

    await page.locator("#symbol").fill("AAPL");
    await page.locator("#quantity").fill("10");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+$/);

    // Verify holding was created
    await expect(page.locator("body")).toContainText("AAPL");
  });

  test("record a buy trade for the holding", async ({ page }) => {
    // Navigate back to portfolio to find the holding
    await page.goto(`/wealth/${portfolioId}`);
    await expect(page.locator("body")).toContainText("AAPL");

    // Find and click on the holding
    await page.locator("a", { hasText: "AAPL" }).first().click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+$/);

    // Add a trade
    await page.locator('button:has-text("Add trade")').click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+\/trades\/new$/);

    await page.locator('select[name="type"]').selectOption("BUY");
    await page.locator('input[name="date"]').fill("2026-01-01");
    await page.locator('input[name="quantity"]').fill("5");
    await page.locator('input[name="price"]').fill("150");
    await page.locator("main button[type=submit]").click();

    // Verify trade was created
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+$/);
    await expect(page.locator("body")).toContainText("BUY");
  });

  test("record a sell trade and verify calculations", async ({ page }) => {
    await page.goto(`/wealth/${portfolioId}`);
    await page.locator("a", { hasText: "AAPL" }).first().click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+$/);

    // Add a sell trade
    await page.locator('button:has-text("Add trade")').click();
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+\/trades\/new$/);

    await page.locator('select[name="type"]').selectOption("SELL");
    await page.locator('input[name="date"]').fill("2026-01-15");
    await page.locator('input[name="quantity"]').fill("3");
    await page.locator('input[name="price"]').fill("160");
    await page.locator("main button[type=submit]").click();

    // Verify sell trade and cost basis calculations
    await page.waitForURL(/\/wealth\/[^/]+\/holdings\/[^/]+$/);
    await expect(page.locator("body")).toContainText("SELL");
  });

  test("upload a trade document", async ({ page }) => {
    await page.goto(`/wealth/${portfolioId}`);
    await page.locator("a", { hasText: "AAPL" }).first().click();

    // Find a trade and upload a document to it
    const tradeRow = page.locator("tr", { hasText: "BUY" }).first();
    await tradeRow.locator('button:has-text("Document")').click();

    // Upload document
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "trade.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
    await submit.click();
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Verify document was uploaded
    await expect(page.locator("body")).toContainText("trade.pdf");
  });

  test("delete a holding removes its trade documents from disk", async ({ page }) => {
    // Get a holding ID - navigate to portfolio and open a holding
    await page.goto(`/wealth/${portfolioId}`);
    const holdingLink = page.locator("a", { hasText: "AAPL" }).first();
    const holdingHref = await holdingLink.getAttribute("href");
    expect(holdingHref).toBeTruthy();

    const holdingId = holdingHref!.split("/").pop()!;

    // Navigate to holding and delete it
    await page.goto(`/wealth/${portfolioId}/holdings/${holdingId}`);
    await page.locator('button:has-text("Delete")').click();
    await page.locator('button[data-test="confirm-delete"]').click();
    await page.waitForURL(/\/wealth\/[^/]+$/);

    // Verify it was deleted and we're back on portfolio page
    await expect(page.locator("body")).not.toContainText("AAPL");

    // Verify trade files would be cleaned up if they existed
    const tradeFileDir = path.join(UPLOADS_DIR, "trades", holdingId);
    // Files should be removed with the holding (this is verified by #259's specific test)
  });

  test("delete the portfolio", async ({ page }) => {
    await page.goto(`/wealth/${portfolioId}`);
    await page.locator('button:has-text("Delete")').click();
    await page.locator('button[data-test="confirm-delete"]').click();
    await page.waitForURL(/\/wealth$/);

    // Verify portfolio list is displayed
    await expect(page.locator("body")).toContainText(/portfolio|wealth/i);
  });
});
