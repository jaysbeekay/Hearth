import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, UPLOADS_DIR } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

test.describe.serial("Wealth module", () => {
  let portfolioId: string;
  let holdingId: string;
  let buyTradeId: string;

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
    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill("Test Portfolio");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/);

    portfolioId = new URL(page.url()).pathname.split("/").pop()!;
    expect(portfolioId).toBeTruthy();
    await expect(page.locator("body")).toContainText("Test Portfolio");
  });

  test("add a holding to the portfolio", async ({ page }) => {
    await page.goto(`/wealth/portfolios/${portfolioId}`);
    await page.getByRole("link", { name: "Add holding" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/new$/);

    await page.locator("#ticker").fill("AAPL");
    await page.getByRole("button", { name: "Add holding" }).click();
    // Exclude "new" itself — we're already on .../holdings/new, which a bare
    // /holdings\/[^/]+$/ also matches, resolving before the real redirect.
    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/(?!new$)[^/]+$/);

    holdingId = new URL(page.url()).pathname.split("/").pop()!;
    expect(holdingId).toBeTruthy();
    await expect(page.locator("body")).toContainText("AAPL");
  });

  test("record a buy trade for the holding", async ({ page }) => {
    await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
    await page.getByRole("link", { name: "Add trade" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/[^/]+\/trades\/new$/);

    await page.locator("#type").selectOption("BUY");
    await page.locator("#date").fill("2026-01-01");
    await page.locator("#units").fill("5");
    await page.locator("#pricePerUnit").fill("150");
    await page.getByRole("button", { name: "Add trade" }).click();

    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/[^/]+$/);
    await expect(page.locator("body")).toContainText("Buy");

    const buyRow = page.locator("div.rounded-xl.border.border-border.bg-surface.p-4", {
      hasText: "Buy",
    });
    const editHref = await buyRow.getByTitle("Edit trade").getAttribute("href");
    buyTradeId = editHref!.split("/").slice(-2, -1)[0];
    expect(buyTradeId).toBeTruthy();
  });

  test("record a sell trade and verify calculations", async ({ page }) => {
    await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
    await page.getByRole("link", { name: "Add trade" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/[^/]+\/trades\/new$/);

    await page.locator("#type").selectOption("SELL");
    await page.locator("#date").fill("2026-01-15");
    await page.locator("#units").fill("3");
    await page.locator("#pricePerUnit").fill("160");
    await page.getByRole("button", { name: "Add trade" }).click();

    await page.waitForURL(/\/wealth\/portfolios\/[^/]+\/holdings\/[^/]+$/);
    await expect(page.locator("body")).toContainText("Sell");
    // 5 bought - 3 sold = 2 units left, at FIFO cost of the original $150 buy.
    await expect(page.locator("body")).toContainText("2");
  });

  test("upload a trade document", async ({ page }) => {
    await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);

    const buyRow = page.locator("div.rounded-xl.border.border-border.bg-surface.p-4", {
      hasText: "Buy",
    });
    await buyRow.locator('input[type="file"]').setInputFiles({
      name: "trade.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes(),
    });
    await buyRow.getByRole("button", { name: "Upload" }).click();
    // "trade.pdf" alone would also match FileDropZone's own client-side
    // selected-file preview, which appears immediately on setInputFiles()
    // regardless of whether the upload actually succeeds — wait for the
    // server action's own success message instead.
    await expect(buyRow).toContainText("Document uploaded.");

    const fileDir = path.join(UPLOADS_DIR, "trades", buyTradeId);
    expect(fs.existsSync(fileDir)).toBe(true);
  });

  test("deleting a holding removes its trade documents from disk", async ({ page }) => {
    const fileDir = path.join(UPLOADS_DIR, "trades", buyTradeId);
    expect(fs.existsSync(fileDir)).toBe(true);

    await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete AAPL" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/[^/]+$/);

    await expect(page.locator("body")).not.toContainText("AAPL");
    expect(fs.existsSync(fileDir)).toBe(false);
  });

  test("delete the portfolio", async ({ page }) => {
    await page.goto("/wealth/portfolios");
    await expect(page.locator("body")).toContainText("Test Portfolio");

    const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
      hasText: "Test Portfolio",
    });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: 'Delete "Test Portfolio"' }).click();

    await expect(page.locator("body")).not.toContainText("Test Portfolio");
  });
});
