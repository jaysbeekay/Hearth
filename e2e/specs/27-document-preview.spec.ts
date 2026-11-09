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
//
// Online, the PDF is now framed from its own URL with ?inline=1 rather than
// a blob: URL, which Safari wouldn't draw under the app's CSP; that response
// gets a narrow CSP of its own (src/lib/documents/inlineView.ts). Offline
// still frames the cached blob.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
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
  await page.locator("#category").selectOption("OTHER");
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

const INLINE_VIEW_CSP = "default-src 'none'; object-src 'self'; frame-ancestors 'self'";

test("?inline=1 serves a PDF inline with its own CSP, and only a PDF", async ({ page }) => {
  const pdfName = `inline-headers-${Date.now()}.pdf`;
  await contractWithPdf(page, pdfName);
  const pdfHref = await page.locator(`a[href^="/api/documents/"]`, { hasText: pdfName }).first().getAttribute("href");
  expect(pdfHref).toBeTruthy();

  const inline = await page.request.get(`${pdfHref}?inline=1`);
  expect(inline.status()).toBe(200);
  expect(inline.headers()["content-disposition"]).toMatch(/^inline;/);
  expect(inline.headers()["content-security-policy"]).toBe(INLINE_VIEW_CSP);
  expect(inline.headers()["x-frame-options"]).toBe("SAMEORIGIN");

  const plain = await page.request.get(pdfHref!);
  expect(plain.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(plain.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(plain.headers()["x-frame-options"]).toBe("DENY");

  // Any other type stays an attachment, ?inline=1 or not.
  const pngName = `inline-headers-${Date.now()}.png`;
  await page.locator('input[type="file"]').first().setInputFiles({ name: pngName, mimeType: "image/png", buffer: PNG });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${pngName}`);
  const pngHref = await page.locator(`a[href^="/api/documents/"]`, { hasText: pngName }).first().getAttribute("href");
  const png = await page.request.get(`${pngHref}?inline=1`);
  expect(png.headers()["content-disposition"]).toMatch(/^attachment;/);
});

test("a PDF preview that can't load says so instead of framing an error page", async ({ page }) => {
  const filename = `preview-missing-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  // As if the Document went to Trash after the page rendered.
  await page.route(/\/api\/documents\/[^/?]+\?inline=1$/, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Not found"}' }),
  );
  await page.getByRole("button", { name: `Preview ${filename}` }).click();
  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog.getByText("Couldn't load a preview for this file.")).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
});

test("a PDF preview comes back after the connection drops and returns", async ({ page, context }) => {
  const filename = `preview-reconnect-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  await page.getByRole("button", { name: `Preview ${filename}` }).click();
  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog.locator("iframe")).toBeVisible();

  // Not saved for offline use, so offline it can't show...
  await context.setOffline(true);
  await expect(dialog.getByText("Couldn't load a preview for this file.")).toBeVisible();
  // ...and back online it shows again, without reopening.
  await context.setOffline(false);
  await expect(dialog.locator("iframe")).toBeVisible();
  await expect(dialog.getByText("Couldn't load a preview for this file.")).toHaveCount(0);
});

test("a PDF preview falls back to a plain fetch when the server can't be reached", async ({ page }) => {
  const filename = `preview-unreachable-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  // The HEAD check fails as if the server were down; the GET after it is
  // what the service worker would answer from its cache.
  await page.route(/\/api\/documents\/[^/?]+\?inline=1$/, (route) =>
    route.request().method() === "HEAD" ? route.abort("connectionrefused") : route.continue(),
  );
  await page.getByRole("button", { name: `Preview ${filename}` }).click();
  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
  await expect(dialog.getByText("Couldn't load a preview for this file.")).toHaveCount(0);
});

test("a Document whose name isn't plain ASCII still downloads and previews", async ({ page }) => {
  const filename = `John’s lease – 日本 ${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  const href = await page.locator(`a[href^="/api/documents/"]`, { hasText: filename }).first().getAttribute("href");
  for (const url of [href!, `${href}?inline=1`]) {
    const res = await page.request.get(url);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("filename*=UTF-8''John%E2%80%99s");
  }
  // HEAD answers without the body, with the same headers.
  const head = await page.request.head(`${href}?inline=1`);
  expect(head.status()).toBe(200);
  expect(head.headers()["content-disposition"]).toMatch(/^inline;/);
});

test("previewing an image document from the Documents page renders it", async ({ page }) => {
  const filename = `preview-image-test-${Date.now()}.png`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill("Preview Image Regression Contract");
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);

  await page.goto("/documents");
  await page.waitForSelector(`text=${filename}`);
  await page.getByRole("button", { name: `Preview ${filename}` }).click();

  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toBeVisible();
  // #617 — the alt names the Document and its record, never the filename.
  await expect(dialog.locator("img")).toHaveAttribute("alt", "Preview of document for Preview Image Regression Contract");
});

// #617 — on a record's own Document list the alt names the Document type
// and the record too.
test("a typed image previewed from its record's Documents is described by type and record", async ({ page }) => {
  const filename = `typed-preview-${Date.now()}.png`;
  const title = `Typed Preview Contract ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "image/png", buffer: PNG });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);

  const typeSelect = page.getByLabel(`Document type for ${filename}`);
  await typeSelect.selectOption({ label: "Receipt" });
  await expect
    .poll(async () => {
      await page.reload();
      return typeSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text ?? "");
    }, { timeout: 15_000 })
    .toBe("Receipt");

  await page.getByRole("button", { name: `Preview ${filename}` }).click();
  const img = page.getByRole("dialog", { name: `Preview of ${filename}` }).locator("img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("alt", `Preview of receipt for ${title}`);
});

// #374 — Preview, Share and Download from a record's own Documents section.
async function contractWithPdf(page: import("@playwright/test").Page, filename: string) {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Share Contract ${Date.now()}`);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Share Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "application/pdf", buffer: VALID_PDF });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);
  return page.url();
}

test("Share copies a link that opens the Document without signing in, until it's revoked", async ({ page, context, playwright }) => {
  // A browser that can't share files: Share makes a link and copies it.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const filename = `share-link-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);

  // Preview works on the record's own page, with Share and Download.
  await page.getByRole("button", { name: `Preview ${filename}` }).click();
  const dialog = page.getByRole("dialog", { name: `Preview of ${filename}` });
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  await dialog.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Link copied. It works for 24 hours.")).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/api\/share\/[A-Za-z0-9_-]{43}$/);

  // No session needed.
  const anonymous = await playwright.request.newContext();
  const opened = await anonymous.get(url);
  expect(opened.status()).toBe(200);
  expect(opened.headers()["content-type"]).toBe("application/pdf");

  // Listed on the Security page, where an admin can revoke it.
  await page.goto("/settings/security");
  await expect(page.getByText("Document shared by link").first()).toBeVisible();
  await page.getByRole("button", { name: `Revoke the link to ${filename}` }).click();
  await expect(page.getByRole("button", { name: `Revoke the link to ${filename}` })).toHaveCount(0);
  expect((await anonymous.get(url)).status()).toBe(404);
  await anonymous.dispose();
});

test("Share hands the file itself to the share sheet where the browser can", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { sharedFiles: string[] };
    w.sharedFiles = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files?: File[] }) => {
        w.sharedFiles.push(...(data.files ?? []).map((f) => `${f.name}|${f.type}|${f.size}`));
      },
      configurable: true,
    });
  });
  const filename = `share-file-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  await page.getByRole("button", { name: `Share ${filename}` }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { sharedFiles: string[] }).sharedFiles))
    .toEqual([`${filename}|application/pdf|${VALID_PDF.length}`]);
});

test("Cancelling the share sheet revokes the link it was about to share", async ({ page, playwright }) => {
  // Can share a link but not the file, and the person closes the sheet.
  await page.addInitScript(() => {
    const w = window as unknown as { sharedUrls: string[] };
    w.sharedUrls = [];
    Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: { url?: string }) => {
        if (data.url) w.sharedUrls.push(data.url);
        throw new DOMException("Share canceled", "AbortError");
      },
      configurable: true,
    });
  });
  const filename = `share-cancel-${Date.now()}.pdf`;
  await contractWithPdf(page, filename);
  await page.getByRole("button", { name: `Share ${filename}` }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { sharedUrls: string[] }).sharedUrls.length)).toBe(1);
  const url = await page.evaluate(() => (window as unknown as { sharedUrls: string[] }).sharedUrls[0]);

  const anonymous = await playwright.request.newContext();
  await expect.poll(async () => (await anonymous.get(url)).status()).toBe(404);
  await anonymous.dispose();
  await page.goto("/settings/security");
  await expect(page.getByRole("button", { name: `Revoke the link to ${filename}` })).toHaveCount(0);
});
