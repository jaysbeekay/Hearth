import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

// #411 — at most one filled primary button per page: the dashboard, every
// list page and every detail page. Row actions are secondary and filled
// danger lives only inside confirm dialogs, so no page should render more
// than one control filled with the accent colour.

test.use({ storageState: ADMIN_AUTH_FILE });

/** Visible buttons and links filled with the accent colour (the primary variant). */
async function primaryButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "bg-accent";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>("main a, main button, main summary")]
      .filter((el) => {
        if (!el.checkVisibility()) return false;
        return getComputedStyle(el).backgroundColor === accent;
      })
      .map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName);
  });
}

async function createAndReturnUrl(page: Page, path: string, fill: () => Promise<void>, pattern: RegExp) {
  await page.goto(path);
  await fill();
  await page.locator("main button[type=submit]").first().click();
  await page.waitForURL(pattern);
  return new URL(page.url()).pathname;
}

test("no page renders more than one primary button", async ({ page }) => {
  test.setTimeout(600_000);
  const stamp = Date.now();
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;

  const contract = await createAndReturnUrl(
    page,
    "/contracts/new",
    async () => {
      await page.locator("#title").fill(`UI Rules Contract ${stamp}`);
      await page.locator("#provider").fill("UI Rules Provider");
    },
    /\/contracts\/(?!new$)[^/]+$/,
  );
  const product = await createAndReturnUrl(
    page,
    "/products/new",
    async () => {
      await page.locator("#description").fill(`UI Rules Product ${stamp}`);
    },
    /\/products\/(?!new$)[^/]+$/,
  );
  const vehicle = await createAndReturnUrl(
    page,
    "/vehicles/new",
    async () => {
      await page.locator("#label").fill(`UI Rules Car ${stamp}`);
    },
    /\/vehicles\/(?!new$)[^/]+$/,
  );
  const property = await createAndReturnUrl(
    page,
    "/home/new",
    async () => {
      await page.locator("#label").fill(`UI Rules Home ${stamp}`);
    },
    /\/home\/(?!new$)[^/]+$/,
  );

  const pages = [
    "/dashboard",
    "/contracts",
    "/products",
    "/vehicles",
    "/home",
    "/travel",
    "/inventory",
    "/wealth",
    "/documents",
    "/calendar",
    "/spend",
    contract,
    product,
    vehicle,
    property,
    `/travel/${tripAId}`,
  ];

  for (const path of pages) {
    await page.goto(path);
    await page.locator("main").waitFor();
    const primaries = await primaryButtons(page);
    expect
      .soft(primaries.length, `${path} renders ${primaries.length} primary buttons: ${primaries.join(", ")}`)
      .toBeLessThanOrEqual(1);
  }
});
