import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #422 — Due labels follow the viewer's Date format from Settings →
// Preferences, on the Contract's badge, the Contracts list and Upcoming.

test.use({ storageState: ADMIN_AUTH_FILE });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Due labels count days in the household's timezone, which Settings names.
// Read it from there rather than assuming this machine's zone is the
// household's, and work out today once so every date below agrees.
async function householdToday(page: Page): Promise<string> {
  await page.goto("/settings");
  const text = await page.locator("#main").getByText(/The household timezone is /).textContent();
  const timeZone = /The household timezone is ([^.\s]+)\./.exec(text ?? "")?.[1];
  if (!timeZone) throw new Error(`No household timezone in: ${text}`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The calendar day `days` after `day`, both YYYY-MM-DD. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const today = await householdToday(page);
  const deadline = addDays(today, 10);
  // Within 10 days of New Year the label gains a year; skip rather than branch.
  test.skip(deadline.slice(0, 4) !== today.slice(0, 4), "the notice deadline falls in next year");
  const [, m, d] = deadline.split("-").map(Number);
  const dayMonth = `Cancel by ${d} ${MONTHS[m - 1]}`;
  const monthDay = `Cancel by ${MONTHS[m - 1]} ${d}`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Date Format Provider");
  await page.locator("#endDate").fill(addDays(today, 40));
  await page.selectOption("#renewalType", "AUTO_RENEW");
  await page.locator("#noticePeriodDays").fill("30");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const contractUrl = page.url();

  // The default DD/MM/YYYY reads day first. The detail page states it in
  // the banner; the header badge would only repeat it (#405).
  await expect(page.getByText(`${dayMonth} — 10 days left.`, { exact: true })).toBeVisible();

  try {
    await savePreferences(page, "MM/DD/YYYY", "en-US");

    await page.goto(contractUrl);
    await expect(page.getByText(`${monthDay} — 10 days left.`, { exact: true })).toBeVisible();
    await expect(page.getByText(dayMonth, { exact: true })).toHaveCount(0);

    await page.goto("/contracts?due=soon");
    const card = page.locator("a", { hasText: title });
    await expect(card.getByText(monthDay, { exact: true })).toBeVisible();

    await page.goto("/calendar");
    const event = page.locator("a", { hasText: "Last day to give notice · Date Format Provider" });
    await expect(event.getByText(monthDay, { exact: true })).toBeVisible();

    // ISO always keeps the year.
    await savePreferences(page, "YYYY-MM-DD", "en-US");
    await page.goto(contractUrl);
    await expect(page.getByText(`Cancel by ${deadline} — 10 days left.`, { exact: true })).toBeVisible();
  } finally {
    // Restore the defaults so this doesn't leak into later specs.
    await savePreferences(page, "DD/MM/YYYY", "en-AU");
  }

  await page.goto(contractUrl);
  await expect(page.getByText(`${dayMonth} — 10 days left.`, { exact: true })).toBeVisible();
});
