import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";
import fs from "fs";

// #411 — at most one filled primary button per page. Row actions are
// secondary, and filled danger only appears inside a confirm dialog, so a
// page reads as having one obvious next step.

test.use({ storageState: ADMIN_AUTH_FILE });

/** The visible filled-primary buttons and links on the page, by their text. */
async function primaries(page: Page): Promise<string[]> {
  return page
    .locator(":is(a, button, summary).bg-accent.text-accent-foreground")
    .filter({ visible: true })
    .allInnerTexts()
    .then((texts) => texts.map((t) => t.trim() || "(icon)"));
}

async function createContract(page: Page): Promise<string> {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`One primary ${Date.now()}`);
  await page.locator("#provider").fill("One Primary Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  return new URL(page.url()).pathname;
}

test("no page renders more than one filled primary button", async ({ page }) => {
  // Visits about thirty pages, each compiled on first visit under next dev.
  test.setTimeout(300_000);
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  const contractPath = await createContract(page);

  const paths = [
    "/dashboard",
    "/calendar",
    "/contracts",
    "/contracts/new",
    contractPath,
    `${contractPath}/edit`,
    "/products",
    "/products/new",
    "/documents",
    "/documents/inbox",
    "/import",
    "/spend",
    "/travel",
    `/travel/${tripAId}`,
    "/home",
    "/vehicles",
    "/inventory",
    "/wealth",
    "/wealth/portfolios",
    "/settings",
    "/settings/app",
    "/settings/household",
    "/settings/security",
    "/settings/users",
    "/settings/modules",
    "/settings/backups",
    "/settings/webhooks",
    "/settings/trash",
    "/help",
  ];

  const offenders: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await page.locator("main").waitFor();
    const found = await primaries(page);
    if (found.length > 1) offenders.push(`${path}: ${found.join(" | ")}`);
  }
  expect(offenders, offenders.join("\n")).toEqual([]);
});
