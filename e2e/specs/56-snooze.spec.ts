import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { openFormSections } from "../formSections";

// #354 — Snooze: "I know, remind me later" takes a Due record out of Needs
// attention until a chosen day, pauses its Reminders, and ends by itself
// when the record's dates change.

test.use({ storageState: ADMIN_AUTH_FILE });

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

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createContract(page: Page, title: string, endDate: string) {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("OTHER");
  await openFormSections(page);
  await page.locator("#provider").fill("Snooze Provider");
  await page.locator("#endDate").fill(endDate);
  await page.selectOption("#renewalType", "MANUAL_RENEWAL");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  return page.url();
}

test("snoozing from Needs attention hides the row until the chosen day", async ({ page }) => {
  const title = `Snooze Contract ${Date.now()}`;
  const today = await householdToday(page);
  const contractUrl = await createContract(page, title, addDays(today, 5));

  await page.goto("/dashboard");
  const row = page.locator("li", { hasText: title });
  await row.getByRole("button", { name: `Snooze ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: `Snooze ${title}` });
  await dialog.getByRole("button", { name: "1 week" }).click();
  await expect(page.getByRole("status").getByText(/^Snoozed until /)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);

  // The detail page says who and until when, and its reminders are paused.
  await page.goto(contractUrl);
  await expect(page.getByText(/^Snoozed by .+ until .+\. Its reminders resume then\.$/)).toBeVisible();
  await expect(page.locator("dt", { hasText: "Enabled" }).locator("xpath=following-sibling::dd")).toHaveText(
    /^Snoozed until /,
  );

  // Upcoming still lists it, marked Snoozed.
  await page.goto("/calendar");
  await expect(page.locator("a", { hasText: title }).getByText(/^Snoozed until /)).toBeVisible();

  // Unsnooze brings it straight back.
  await page.goto(contractUrl);
  await page.getByRole("button", { name: "Unsnooze" }).click();
  await expect(page.getByRole("button", { name: `Snooze ${title}` })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.locator("li", { hasText: title })).toHaveCount(1);
});

test("changing the end date ends a Snooze", async ({ page }) => {
  const title = `Snooze Edit ${Date.now()}`;
  const today = await householdToday(page);
  const contractUrl = await createContract(page, title, addDays(today, 5));

  // Snooze until a chosen date, from the detail banner.
  await page.getByRole("button", { name: `Snooze ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: `Snooze ${title}` });
  await dialog.getByLabel("Or until a date").fill(addDays(today, 20));
  await dialog.getByRole("button", { name: "Snooze until date" }).click();
  await expect(page.getByRole("button", { name: "Unsnooze" })).toBeVisible();

  // Moving the end date ends it, with nothing else to clear.
  await page.goto(`${contractUrl}/edit`);
  await openFormSections(page);
  await page.locator("#endDate").fill(addDays(today, 6));
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(contractUrl);
  await expect(page.getByRole("button", { name: "Unsnooze" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.locator("li", { hasText: title })).toHaveCount(1);
});

test("a day that isn't after today is refused", async ({ page }) => {
  const title = `Snooze Today ${Date.now()}`;
  const today = await householdToday(page);
  await createContract(page, title, addDays(today, 5));
  await page.getByRole("button", { name: `Snooze ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: `Snooze ${title}` });
  await dialog.getByLabel("Or until a date").fill(today);
  await dialog.getByRole("button", { name: "Snooze until date" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose a day after today.");
});
