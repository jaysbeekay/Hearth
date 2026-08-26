import { test, expect } from "@playwright/test";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ADMIN_AUTH_FILE, DATABASE_URL, BASE_URL } from "../env";
import { decryptBuffer } from "../../src/lib/crypto";

test.use({ storageState: ADMIN_AUTH_FILE });

test("local backup is encrypted, restorable, and pruned to retention", async ({ page }) => {
  process.env.ENCRYPTION_KEY = "F0CiTt+ImWBEgZWCI0tjldALraXIJ5XDLAvTWQqrRmI=";
  const backupDir = path.join(path.dirname(DATABASE_URL.slice("file:".length)), "backups");
  await rm(backupDir, { recursive: true, force: true });
  await mkdir(backupDir, { recursive: true });

  await page.goto("/settings/backups");
  const backupForm = page.locator("form").filter({ has: page.locator("#destination") });
  await backupForm.locator("#destination").selectOption("LOCAL");
  await backupForm.locator("#localPath").fill(backupDir);
  await backupForm.locator("button[type=submit]").click();
  await expect(backupForm).toContainText(/saved|success/i);

  await page.goto("/settings/app");
  const scheduleForm = page.locator("form").filter({ has: page.locator("#retentionCount") });
  await scheduleForm.locator("#retentionCount").fill("2");
  await scheduleForm.locator("button[type=submit]").click();
  await expect(scheduleForm).toContainText(/saved|success/i);

  for (let i = 0; i < 3; i++) {
    const response = await page.request.post(`${BASE_URL}/api/backup`, {
      headers: { "x-cron-secret": "e2e-cron-secret" },
    });
    expect(response.ok()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const files = (await readdir(backupDir)).filter((name) => name.endsWith(".db.enc"));
  expect(files).toHaveLength(2);
  const encrypted = await readFile(path.join(backupDir, files[0]));
  expect(encrypted.subarray(0, 16).toString()).not.toBe("SQLite format 3\0");
  const restored = decryptBuffer(encrypted);
  expect(restored.subarray(0, 16).toString()).toBe("SQLite format 3\0");
  expect(restored.length).toBeGreaterThan(100);
  expect(await stat(path.join(backupDir, files[0]))).toBeTruthy();
});
