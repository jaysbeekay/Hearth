import fs from "fs";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

let tripUrl: string;

test.beforeAll(() => {
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  tripUrl = `/travel/${tripAId}`;
});

async function upload(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto(tripUrl);
  await page.locator('input[type="file"][name="file"]').first().setInputFiles(file);
  const submit = page.locator('form:has(input[name="file"]) button[type="submit"]').first();
  await submit.click();
  // networkidle can settle before a large upload's round trip finishes;
  // the submit button's disabled/"Saving…" state directly tracks the
  // action's pending status, so wait on that instead.
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  return page.locator("body").innerText();
}


// Real leading bytes. Uploads are validated by content now, not by the
// Content-Type the client claims (#165), so fixtures have to actually be the
// format they say they are.
function pdfBytes(padTo = 0): Buffer {
  const header = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  if (padTo <= header.length) return header;
  return Buffer.concat([header, Buffer.alloc(padTo - header.length, 0x20)]);
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

test("0-byte file is rejected", async ({ page }) => {
  const body = await upload(page, {
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  expect(body).not.toContain("Document uploaded");
});

test("disallowed mimetype (.exe) is rejected", async ({ page }) => {
  const body = await upload(page, {
    name: "malware.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ fake exe"),
  });
  expect(body).toContain("Unsupported file type");
});

test("disallowed mimetype (.sh) is rejected", async ({ page }) => {
  const body = await upload(page, {
    name: "script.sh",
    mimeType: "text/x-shellscript",
    buffer: Buffer.from("#!/bin/sh\necho hi\n"),
  });
  expect(body).toContain("Unsupported file type");
});

test("a file under the 15MB limit uploads successfully", async ({ page }) => {
  const body = await upload(page, {
    name: "two-mb.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(2 * 1024 * 1024),
  });
  expect(body).toContain("Document uploaded");
});

test("a file over the 15MB limit is cleanly rejected, not crashed", async ({ page }) => {
  const body = await upload(page, {
    name: "oversized.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(16 * 1024 * 1024),
  });
  expect(body).toContain("too large");
  expect(body).not.toContain("Application error");
});

test("path-traversal-shaped filename is stored safely", async ({ page }) => {
  // Browsers strip path separators from File.name, and the server stores
  // documents under a generated UUID regardless of the original filename
  // anyway, so this should behave like any normal upload.
  const body = await upload(page, {
    name: "../../../etc/passwd.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  expect(body).toContain("Document uploaded");
});

test("served documents use Content-Disposition: attachment (no stored-XSS execution)", async ({
  page,
  context,
}) => {
  let dialogFired = false;
  page.on("dialog", async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await page.goto(tripUrl);
  await page.locator('input[type="file"][name="file"]').first().setInputFiles({
    name: "evil.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG_BYTES, Buffer.from("<script>alert(1)</script>")]),
  });
  await page.locator('form:has(input[name="file"]) button[type="submit"]').first().click();
  await page.waitForLoadState("networkidle");

  const href = await page
    .locator('a[href^="/api/travel/documents/"]', { hasText: "evil.png" })
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();

  const response = await context.request.get(href!);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(dialogFired).toBe(false);
});

test("a file whose contents don't match its claimed type is rejected", async ({ page }) => {
  // The exact bypass #165 describes: any HTTP client can set Content-Type
  // freely, and the old checks believed it. This would previously have been
  // stored as a PDF and handed to pdftotext.
  const body = await upload(page, {
    name: "not-really.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("#!/bin/sh\necho definitely not a pdf\n"),
  });
  expect(body).not.toContain("Document uploaded");
  expect(body).toContain("don't match any supported format");
});

test("an executable renamed and relabelled as a PNG is rejected", async ({ page }) => {
  const body = await upload(page, {
    name: "payload.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), // MZ header
  });
  expect(body).not.toContain("Document uploaded");
  expect(body).toContain("don't match any supported format");
});
