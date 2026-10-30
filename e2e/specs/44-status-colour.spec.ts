import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #412 — status colour follows the Due states: danger once Overdue, warning
// while Due soon, and a date outside its due-soon window is plain muted
// text with no pill (and never green).

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
  await page.locator("#provider").fill("Status Colour Provider");
  await page.locator("#endDate").fill(endDate);
  await page.selectOption("#renewalType", "MANUAL_RENEWAL");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
}

/** A theme token's computed colour, as the browser resolves it. */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function style(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("only Overdue and Due soon dates are coloured", async ({ page }) => {
  const stamp = Date.now();
  const today = await householdToday(page);
  const later = `Later Contract ${stamp}`;
  const soon = `Due Soon Contract ${stamp}`;
  const overdue = `Overdue Contract ${stamp}`;

  await createContract(page, later, addDays(today, 400));
  await createContract(page, soon, addDays(today, 10));
  await createContract(page, overdue, addDays(today, -5));

  await page.goto("/contracts");
  const [danger, warning, muted, success] = await Promise.all(
    ["danger", "warning", "muted", "success"].map((t) => tokenColour(page, t)),
  );

  const laterBadge = page.locator("a", { hasText: later }).getByText(/^Expires /);
  const soonBadge = page.locator("a", { hasText: soon }).getByText(/^Expires /);
  const overdueBadge = page.locator("a", { hasText: overdue }).getByText("Expired 5 days ago", { exact: true });

  // Later: plain muted text, no pill.
  const laterStyle = await style(laterBadge);
  expect(laterStyle.background).toBe(TRANSPARENT);
  expect(laterStyle.color).toBe(muted);
  expect(laterStyle.color).not.toBe(success);

  // Due soon: a warning pill.
  const soonStyle = await style(soonBadge);
  expect(soonStyle.color).toBe(warning);
  expect(soonStyle.background).not.toBe(TRANSPARENT);

  // Overdue: a danger pill.
  const overdueStyle = await style(overdueBadge);
  expect(overdueStyle.color).toBe(danger);
  expect(overdueStyle.background).not.toBe(TRANSPARENT);

  // The same Overdue entry reads the same in Needs attention.
  await page.goto("/dashboard");
  const row = page.locator("li", { hasText: overdue });
  expect((await style(row.getByText("Expired 5 days ago", { exact: true }))).color).toBe(danger);
});
