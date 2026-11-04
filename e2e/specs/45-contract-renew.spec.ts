import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { openFormSections } from "../formSections";

// #353 — Renew adds a Contract's next Term and keeps the current one as
// history, instead of overwriting it in the edit form.

test.use({ storageState: ADMIN_AUTH_FILE });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Due dates count in the household's timezone, which Settings names.
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

/** A date as the page may show it, in any of the three Date formats. */
function shownDate(day: string): RegExp {
  const [y, m, d] = day.split("-").map(Number);
  const month = MONTHS[m - 1];
  return new RegExp(`(${d} ${month} ${y}|${month} ${d}, ${y}|${day})`);
}

async function createContract(
  page: Page,
  values: { title: string; startDate?: string; endDate: string; renewalType: string; cost?: string },
) {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(values.title);
  await page.locator("#category").selectOption("OTHER");
  await openFormSections(page);
  await page.locator("#provider").fill("Renew Provider");
  if (values.startDate) await page.locator("#startDate").fill(values.startDate);
  await page.locator("#endDate").fill(values.endDate);
  await page.selectOption("#renewalType", values.renewalType);
  if (values.cost) {
    await page.locator("#cost").fill(values.cost);
    await page.selectOption("#billingFrequency", "ANNUALLY");
  }
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  return page.url();
}

test("renewing from Needs attention keeps the old Term and restarts Reminders", async ({ page }) => {
  const title = `Renew Contract ${Date.now()}`;
  const today = await householdToday(page);
  // A 105-day Term, which can't be a whole number of months, so it's kept in days.
  const oldStart = addDays(today, -100);
  const oldEnd = addDays(today, 5);
  const contractUrl = await createContract(page, {
    title,
    startDate: oldStart,
    endDate: oldEnd,
    renewalType: "MANUAL_RENEWAL",
    cost: "1000",
  });

  // Due soon, so it's in Needs attention with a Renew button that opens the
  // Renew form rather than the edit form.
  await page.goto("/dashboard");
  const row = page.locator("li", { hasText: title });
  await row.getByRole("link", { name: "Renew", exact: true }).click();
  await page.waitForURL(/\/contracts\/[^/]+\/renew$/);
  await expect(page.getByRole("heading", { name: "Renew contract" })).toBeVisible();

  // Pre-filled: starts the day after the old end date, same length, same cost.
  const newStart = addDays(oldEnd, 1);
  const newEnd = addDays(newStart, 105);
  await expect(page.locator("#startDate")).toHaveValue(newStart);
  await expect(page.locator("#endDate")).toHaveValue(newEnd);
  await expect(page.locator("#cost")).toHaveValue("1000");
  await page.locator("#cost").fill("1120");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(contractUrl);

  // The old Term is kept, and the cost change is shown.
  const history = page.locator("div", { has: page.getByRole("heading", { name: "Previous terms" }) }).last();
  await expect(history).toBeVisible();
  await expect(history.getByText(shownDate(oldStart))).toBeVisible();
  await expect(history.getByText(shownDate(oldEnd))).toBeVisible();
  await expect(history.getByText(/1,000\.00 \/ annually/)).toBeVisible();
  await expect(page.getByText(/1,120\.00 \/ annually$/)).toBeVisible();
  await expect(page.getByText("+12% vs prior term", { exact: true })).toBeVisible();

  // Reminders restart for the new Term: the next one is 30 days before its end.
  const nextReminder = page.locator("dt", { hasText: "Next reminder" }).locator("xpath=following-sibling::dd");
  await expect(nextReminder).toHaveText(shownDate(addDays(newEnd, -30)));

  // And it has left Needs attention.
  await page.goto("/dashboard");
  await expect(page.locator("li", { hasText: title })).toHaveCount(0);
});

test("an auto-renewing Contract past its end date sets its new end date through Renew", async ({ page }) => {
  const title = `Auto Renew Contract ${Date.now()}`;
  const today = await householdToday(page);
  const contractUrl = await createContract(page, {
    title,
    endDate: addDays(today, -3),
    renewalType: "AUTO_RENEW",
  });

  await page.getByRole("link", { name: "Set the new end date" }).click();
  await page.waitForURL(/\/contracts\/[^/]+\/renew$/);
  // No start date to measure from, so a year from the day after the end date.
  await expect(page.locator("#startDate")).toHaveValue(addDays(today, -2));

  // A new end date that isn't after the current one is refused.
  await page.locator("#startDate").fill("");
  await page.locator("#endDate").fill(addDays(today, -3));
  // An end date that has already passed is warned about before saving.
  await expect(page.getByText(/This date has already passed/)).toBeVisible();
  await page.locator("main button[type=submit]").click();
  await expect(page.locator("#main").getByText("The new end date must be after the current one.")).toBeVisible();

  await page.locator("#endDate").fill(addDays(today, 360));
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(contractUrl);
  await expect(page.getByRole("heading", { name: "Previous terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Set the new end date" })).toHaveCount(0);
});

test("a fixed-term Contract offers no Renew, and its Renew page sends you back", async ({ page }) => {
  const today = await householdToday(page);
  const contractUrl = await createContract(page, {
    title: `Fixed Term Renew ${Date.now()}`,
    endDate: addDays(today, 5),
    renewalType: "FIXED_TERM",
  });
  await expect(page.getByRole("link", { name: "Renew", exact: true })).toHaveCount(0);
  await page.goto(`${contractUrl}/renew`);
  await page.waitForURL(contractUrl);
});

test("a Contract with no end date offers no Renew", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`No End Date Renew ${Date.now()}`);
  await page.locator("#category").selectOption("OTHER");
  await openFormSections(page);
  await page.locator("#provider").fill("Renew Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const contractUrl = page.url();
  await expect(page.getByRole("link", { name: "Renew", exact: true })).toHaveCount(0);
  await page.goto(`${contractUrl}/renew`);
  await page.waitForURL(contractUrl);
});
