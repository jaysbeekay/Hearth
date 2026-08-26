import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { ADMIN_AUTH_FILE, ADMIN_EMAIL, ADMIN_PASSWORD } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test("TOTP setup returns a valid provisioning secret and rejects a wrong code", async ({ page }) => {
  const setup = await page.request.post("/api/totp/setup");
  expect(setup.ok()).toBe(true);
  const payload = await setup.json();
  expect(payload.secret).toMatch(/^[A-Z2-7]+=*$/);
  expect(payload.qrDataUri).toMatch(/^data:image\//);

  const wrong = await page.request.post("/api/totp/verify-setup", {
    data: { secret: payload.secret, code: "000000" },
  });
  expect(wrong.status()).toBe(400);

  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(payload.secret) }).generate();
  const verified = await page.request.post("/api/totp/verify-setup", {
    data: { secret: payload.secret, code },
  });
  expect(verified.ok()).toBe(true);
  expect((await verified.json()).recoveryCodes).toHaveLength(8);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page.locator('input[name="totpCode"]')).toBeVisible();
  await page.locator('input[name="totpCode"]').fill("000000");
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("body")).toContainText(/invalid code|authenticator/i);
});

test("passkey registration options require an authenticated user and expose WebAuthn data", async ({ page }) => {
  const response = await page.request.post("/api/auth/passkey/register/options");
  expect(response.ok()).toBe(true);
  const options = await response.json();
  expect(options.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(options.rp.name).toBe("Hearth");
  expect(options.user.name).toBe(ADMIN_EMAIL);
});
