import fs from "fs";
import { test as setup, expect } from "@playwright/test";
import {
  AUTH_DIR,
  ADMIN_AUTH_FILE,
  MEMBER_AUTH_FILE,
  FIXTURES_FILE,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  MEMBER_EMAIL,
  MEMBER_PASSWORD,
  type Fixtures,
} from "../env";

setup("seed admin + member users and a sample trip", async ({ page, browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // Fresh DB has no users yet, so this lands on /setup. Enable every optional
  // module so the route smoke tests exercise the real pages instead of their
  // module-gating redirects.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/setup/);
  await page.locator('input[name="name"]').fill("E2E Admin");
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  for (const module of ["HOME", "VEHICLES", "INVENTORY", "WEALTH", "TRAVEL"]) {
    await page.locator(`input[type="checkbox"][value="${module}"]`).check();
  }
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: ADMIN_AUTH_FILE });

  // A second, non-admin household member — used to verify Travel's
  // "shared household-wide, no role gate" design and the admin-only
  // restriction on the Modules settings page.
  await page.goto("/settings/users");
  await page.locator("#name").fill("E2E Member");
  await page.locator("#email").fill(MEMBER_EMAIL);
  await page.locator("#password").fill(MEMBER_PASSWORD);
  await page.locator("main button[type=submit]").click();
  await expect(page.locator("body")).toContainText(MEMBER_EMAIL);

  // Seed a trip with one segment so later specs have a stable target
  // instead of each having to create their own trip.
  await page.goto("/travel/new");
  await page.locator("#title").fill("E2E Trip A");
  await page.locator("#destination").fill("Tokyo");
  await page.locator("#startDate").fill("2026-09-01");
  await page.locator("#endDate").fill("2026-09-10");
  await page.locator("main button[type=submit]").click();
  // Exclude "new" itself: the create form's own URL (/travel/new) already
  // satisfies a bare /\/travel\/[^/]+$/ pattern, so without this the wait
  // resolves instantly instead of waiting for the post-submit redirect.
  await page.waitForURL(/\/travel\/(?!new$)[^/]+$/);
  const tripAId = new URL(page.url()).pathname.split("/").pop()!;

  await page.goto(`/travel/${tripAId}/segments/new`);
  await page.locator('select[name="type"]').selectOption("FLIGHT");
  await page.locator('input[name="title"]').fill("E2E Flight Segment");
  await page.locator('input[name="startDate"]').fill("2026-09-01");
  await page.locator('input[name="endDate"]').fill("2026-09-01");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(`**/travel/${tripAId}`);
  await expect(page.locator("body")).toContainText("E2E Flight Segment");

  // Capture the member's own session in a separate context, leaving the
  // admin's page/context untouched.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/login");
  await memberPage.locator('input[name="email"]').fill(MEMBER_EMAIL);
  await memberPage.locator('input[name="password"]').fill(MEMBER_PASSWORD);
  await memberPage.locator("form button[type=submit]").click();
  await memberPage.waitForURL(/\/dashboard/);
  await memberContext.storageState({ path: MEMBER_AUTH_FILE });
  await memberContext.close();

  const fixtures: Fixtures = { tripAId };
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
});
