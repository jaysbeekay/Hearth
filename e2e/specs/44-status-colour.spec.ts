import { test, expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import { ADMIN_AUTH_FILE, DATABASE_URL } from "../env";

// #412 — status colour follows the Due states: danger once Overdue, warning
// while Due soon, a neutral grey pill for Needs review and other
// Housekeeping, and a date outside its due-soon window is plain muted text
// with no pill (never green). Checked in both light and dark.

test.use({ storageState: ADMIN_AUTH_FILE });

// The household's today is within a day of UTC's, and every date below is
// far enough from a boundary (the 30-day due-soon window, today) that the
// state is the same either way. Labels are matched loosely for the same
// reason, so nothing depends on the household's timezone.
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createContract(page: Page, title: string, endDate: string) {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Status Colour Provider");
  await page.locator("#endDate").fill(endDate);
  await page.selectOption("#renewalType", "MANUAL_RENEWAL");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
}

/** The computed colour and background a set of utility classes gives, in the current theme. */
async function classStyle(page: Page, className: string) {
  return page.evaluate((cls) => {
    const probe = document.createElement("span");
    probe.className = cls;
    document.body.append(probe);
    const s = getComputedStyle(probe);
    const result = { color: s.color, background: s.backgroundColor };
    probe.remove();
    return result;
  }, className);
}

async function style(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("only Overdue and Due soon are coloured, in light and dark", async ({ page }) => {
  const stamp = Date.now();
  const today = utcToday();
  const later = `Later Contract ${stamp}`;
  const soon = `Due Soon Contract ${stamp}`;
  const overdue = `Overdue Contract ${stamp}`;
  const review = `Review Contract ${stamp}`;
  const vehicle = `Status Colour Car ${stamp}`;

  await createContract(page, later, addDays(today, 400));
  await createContract(page, soon, addDays(today, 10));
  await createContract(page, overdue, addDays(today, -5));
  await createContract(page, review, addDays(today, 400));

  await page.goto("/vehicles/new");
  await page.locator("#label").fill(vehicle);
  await page.locator("#regoExpiry").fill(addDays(today, 10));
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

  // Needs review can't be reached without a real OCR pass, so set the flag
  // the way an unattended import would.
  const db = createClient({ url: DATABASE_URL });
  try {
    await db.execute("PRAGMA busy_timeout = 5000");
    await db.execute({ sql: "UPDATE contracts SET extractionPending = 1 WHERE title = ?", args: [review] });
  } finally {
    db.close();
  }

  for (const colorScheme of ["light", "dark"] as const) {
    await test.step(colorScheme, async () => {
      await page.emulateMedia({ colorScheme });

      await page.goto("/contracts");
      const danger = await classStyle(page, "bg-danger/10 text-danger");
      const warning = await classStyle(page, "bg-warning/10 text-warning");
      const neutral = await classStyle(page, "bg-muted/10 text-muted");
      const success = await classStyle(page, "text-success");
      expect(danger.color).not.toBe(neutral.color);

      // Later: plain muted text, no pill, never green.
      const laterStyle = await style(page.locator("a", { hasText: later }).getByText(/^Expires /));
      expect(laterStyle).toEqual({ color: neutral.color, background: TRANSPARENT });
      expect(laterStyle.color).not.toBe(success.color);

      // Due soon: a warning pill. Overdue: a danger pill.
      expect(await style(page.locator("a", { hasText: soon }).getByText(/^Expires /))).toEqual(warning);
      expect(await style(page.locator("a", { hasText: overdue }).getByText(/^Expired \d+ days? ago$|^Expired yesterday$/))).toEqual(
        danger,
      );

      // A Vehicle's due pill takes the same tone.
      await page.goto("/vehicles");
      expect(await style(page.locator("a", { hasText: vehicle }).getByText(/^Rego due /))).toEqual(warning);

      // Needs attention: the Overdue entry reads the same, and Housekeeping
      // (Needs review, Not configured) is a neutral pill.
      await page.goto("/dashboard");
      const overdueRow = page.locator("li", { hasText: overdue });
      expect(await style(overdueRow.getByText(/^Expired /))).toEqual(danger);
      const reviewRow = page.locator("li", { hasText: review });
      expect(await style(reviewRow.getByText("Needs review", { exact: true }))).toEqual(neutral);
      const remindersRow = page.locator("li", { hasText: "Not configured" });
      expect(await style(remindersRow.getByText("Not configured", { exact: true }))).toEqual(neutral);
    });
  }
});
