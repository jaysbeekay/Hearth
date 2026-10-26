import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #422 — Due labels follow the viewer's Date format and Region from Settings →
// Preferences, on the Contract's badge, the Contracts list and Upcoming.

test.use({ storageState: ADMIN_AUTH_FILE });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The server runs on this machine, so the household's day (the server's own
// zone, as no household timezone is set) is the local day here.
function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIso(d);
}

async function savePreferences(page: Page, dateFormat: string, region: string) {
  await page.goto("/settings");
  await page.locator("#dateFormat").selectOption(dateFormat);
  await page.locator("#region").selectOption(region);
  await page.locator('form:has(#region) button[type="submit"]').click();
  await expect(page.locator("#main").getByText("Preferences saved.")).toBeVisible();
}

test("Due labels switch to the viewer's date format", async ({ page }) => {
  const title = `Date Format Contract ${Date.now()}`;
  const deadline = isoInDays(10);
  const [y, m, d] = deadline.split("-").map(Number);
  const thisYear = y === new Date().getFullYear();
  const dayMonth = `Cancel by ${d} ${MONTHS[m - 1]}${thisYear ? "" : ` ${y}`}`;
  const monthDay = `Cancel by ${MONTHS[m - 1]} ${d}${thisYear ? "" : `, ${y}`}`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Date Format Provider");
  await page.locator("#endDate").fill(isoInDays(40));
  await page.selectOption("#renewalType", "AUTO_RENEW");
  await page.locator("#noticePeriodDays").fill("30");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const contractUrl = page.url();

  // The default DD/MM/YYYY reads day first.
  await expect(page.getByText(dayMonth, { exact: true })).toBeVisible();

  try {
    await savePreferences(page, "MM/DD/YYYY", "en-US");

    await page.goto(contractUrl);
    await expect(page.getByText(monthDay, { exact: true })).toBeVisible();
    await expect(page.getByText(`${monthDay} — 10 days left.`, { exact: true })).toBeVisible();
    await expect(page.getByText(dayMonth, { exact: true })).toHaveCount(0);

    await page.goto("/contracts?due=soon");
    const card = page.locator("a", { hasText: title });
    await expect(card.getByText(monthDay, { exact: true })).toBeVisible();

    await page.goto("/calendar");
    const event = page.locator("a", { hasText: "Last day to give notice · Date Format Provider" });
    await expect(event.getByText(monthDay, { exact: true })).toBeVisible();

    // ISO keeps the year, whatever the year.
    await savePreferences(page, "YYYY-MM-DD", "en-US");
    await page.goto(contractUrl);
    await expect(page.getByText(`Cancel by ${deadline}`, { exact: true })).toBeVisible();
  } finally {
    // Restore the defaults so this doesn't leak into later specs.
    await savePreferences(page, "DD/MM/YYYY", "en-AU");
  }

  await page.goto(contractUrl);
  await expect(page.getByText(dayMonth, { exact: true })).toBeVisible();
});
