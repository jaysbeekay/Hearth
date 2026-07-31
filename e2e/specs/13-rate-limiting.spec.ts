import { test, expect } from "@playwright/test";

// #155: there was no throttling anywhere, so password and TOTP guessing were
// bounded only by how fast requests could be sent.
//
// Uses an address that belongs to no account, so exhausting its bucket can't
// affect the seeded admin/member logins other specs depend on — the limit is
// keyed by email plus client address.
const THROTTLE_EMAIL = "throttle-probe@e2e.local";
const WRONG_PASSWORD = "definitely-not-the-password";

test("repeated failed sign-ins are throttled, and the message says so", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  let throttledAt: number | null = null;

  // The limit is 10 failures per 15 minutes; a couple of extra attempts prove
  // it latches rather than letting every 11th through.
  for (let attempt = 1; attempt <= 13 && throttledAt === null; attempt++) {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(THROTTLE_EMAIL);
    await page.locator('input[name="password"]').fill(WRONG_PASSWORD);
    await page.locator("form button[type=submit]").click();

    const body = page.locator("body");
    await expect(body).toContainText(/Invalid email or password|Too many attempts/);

    if (await body.getByText(/Too many attempts/).count()) {
      throttledAt = attempt;
    }
  }

  expect(throttledAt).not.toBeNull();
  // Should engage once the allowance is spent, not on the first few tries.
  expect(throttledAt!).toBeGreaterThan(5);
  await expect(page.locator("body")).toContainText(/Try again in \d+ minute/);

  await context.close();
});

test("throttling is per-account, so one attacker can't lock everyone out", async ({ browser }) => {
  // The previous test exhausted THROTTLE_EMAIL's bucket from this same
  // address. A different account must still be able to attempt a sign-in —
  // otherwise guessing at one account would deny service to the household.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");
  await page.locator('input[name="email"]').fill("someone-else@e2e.local");
  await page.locator('input[name="password"]').fill(WRONG_PASSWORD);
  await page.locator("form button[type=submit]").click();

  await expect(page.locator("body")).toContainText("Invalid email or password");
  await expect(page.locator("body")).not.toContainText("Too many attempts");

  await context.close();
});
