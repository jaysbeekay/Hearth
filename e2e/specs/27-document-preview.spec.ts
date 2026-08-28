import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #229: previewing a document from the Documents page never showed anything
// — the CSP's `object-src 'none'` (a deliberate hardening, not something to
// relax) silently blocked the PreviewModal's <embed type="application/pdf">
// entirely, with no visible error to the user, just a blank dialog. Fixed by
// rendering PDFs into an <iframe> instead (governed by frame-src, which now
// explicitly allows blob:) — this is a real console/network-level check on
// the CSP interaction, not just a UI-layer assertion, since a passing click
// on the preview button alone wouldn't have caught the original bug.
const VALID_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>endobj\nxref\n0 4\n" +
    "0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF",
);

test("previewing a PDF document from the Documents page doesn't hit a CSP violation", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) {
      cspViolations.push(msg.text());
    }
  });

  // Timestamped filename (#315's lesson applied here too): a slow first
  // attempt that times out after the document was already created would
  // otherwise make Playwright's retry collide with a duplicate filename.
  const filename = `preview-csp-test-${Date.now()}.pdf`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill("Preview CSP Regression Contract");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: VALID_PDF,
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);

  await page.goto("/documents");
  await page.waitForSelector(`text=${filename}`);
  await page.getByRole("button", { name: `Preview ${filename}` }).click();

  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("iframe")).toBeVisible();
  // Chrome's built-in PDF viewer inside the iframe surfaces its own "Failed
  // to load PDF document" error dialog if the CSP silently blocked it (or if
  // the PDF itself were malformed) — absence of that, alongside the iframe
  // actually mounting, is the real regression signal here.
  await expect(dialog.getByText("Failed to load PDF document.")).toHaveCount(0);
  expect(cspViolations, `CSP violation(s) logged: ${cspViolations.join("; ")}`).toEqual([]);
});

test("previewing an image document from the Documents page renders it", async ({ page }) => {
  const filename = `preview-image-test-${Date.now()}.png`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill("Preview Image Regression Contract");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: png,
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);

  await page.goto("/documents");
  await page.waitForSelector(`text=${filename}`);
  await page.getByRole("button", { name: `Preview ${filename}` }).click();

  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toBeVisible();
});
