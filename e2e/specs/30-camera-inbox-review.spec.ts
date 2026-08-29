import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 375, height: 812 } });

// A minimal, real (byte-accurate xref) single-page PDF with an actual text
// content stream, so the server's pdftotext-based extraction pipeline finds
// real fields — not just a garbage buffer that always yields an empty scan.
function textPdfBytes(lines: string[]): Buffer {
  const content =
    "BT /F1 12 Tf " +
    lines
      .map((line, i) => `${i === 0 ? "20 260" : "0 -20"} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj`)
      .join(" ") +
    " ET";

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 400]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    // Trailing \n matters: without it this object's text ends in
    // "endstream", and the object loop below appends "endobj" right after
    // with no separator, gluing them into the single invalid token
    // "endstreamendobj". A build of poppler that recovers leniently from
    // that (as a local dev machine's often does) still extracts the text
    // fine, masking the bug — but CI's poppler-utils build doesn't recover,
    // so `extractedText` comes back empty and every field assertion below
    // sees "" instead of a real value. A conformant PDF doesn't need any
    // parser's leniency to begin with.
    `<</Length ${Buffer.byteLength(content, "latin1")}>>stream\n${content}\nendstream\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj${obj}endobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

// #327 — camera capture saves straight to the Inbox (not routed through a
// generic untyped queue), and Inbox classification supports the same
// policy/warranty date fields as Import with the same field-level
// provenance capture. This exercises that whole path end to end: capture ->
// Inbox -> classify as a contract with real extracted dates -> the filed
// record lands in "needs review" (#331) showing exactly those fields.
test("capturing a document saves it to the Inbox, and classifying it with extracted dates leaves it pending field-level review", async ({
  page,
}) => {
  // Playwright's default per-test budget (30s, since this repo sets no
  // top-level `timeout`) is tight for a flow with two full extraction
  // passes plus several navigations under a loaded CI runner — this test
  // otherwise reliably timed out mid-assertion, not because any single
  // step was actually broken.
  test.setTimeout(90_000);

  // Unique per run — CI retries a failed test once, and a fixed filename/
  // title would collide with whatever the aborted first attempt already
  // created, breaking every locator below with a strict-mode "resolved to
  // 2 elements" violation instead of the real assertion.
  const stamp = Date.now();
  const filename = `camera-capture-test-${stamp}.pdf`;
  const policyTitle = `Camera Capture Test Policy ${stamp}`;

  await page.goto("/dashboard");

  const cameraInput = page.locator('input[type="file"][accept="image/*"]');
  await cameraInput.setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: textPdfBytes([
      "ACME Insurance Pty Ltd",
      "Start Date: 2026-06-01",
      "End Date: 2027-06-01",
    ]),
  });
  await expect(page.getByText("Saved to your Inbox for review.")).toBeVisible();

  await page.goto("/documents/inbox");
  const row = page.locator("div.rounded-xl.border.border-border.bg-surface", {
    hasText: filename,
  });
  await expect(row).toBeVisible();

  await expect(row.getByText("Scanning…")).toHaveCount(0, { timeout: 30_000 });

  // Force Contract regardless of computeInboxIntake's guess, so the field
  // locators below are unambiguous. Only re-select (which re-triggers a
  // scan) if it isn't already Contract — a <select>'s onChange doesn't
  // fire for choosing its already-selected option, so forcing it
  // unconditionally would be a no-op there anyway. Deliberately doesn't
  // assert on the "Scanning…" indicator at all: on a document this small,
  // the whole extraction can complete well under one polling interval,
  // so that text can appear and vanish between two checks — asserting on
  // it is asserting on a coin flip, not the outcome that actually matters.
  // Waiting directly on the field values with a generous timeout is
  // correct regardless of how fast or slow the scan is.
  const typeSelect = row.getByLabel(/File .* as/);
  if ((await typeSelect.inputValue()) !== "CONTRACT") {
    await typeSelect.selectOption("CONTRACT");
  }

  const startDateInput = row.locator('input[id$="-startDate"]');
  const endDateInput = row.locator('input[id$="-endDate"]');
  await expect(startDateInput).toHaveValue("2026-06-01", { timeout: 30_000 });
  await expect(endDateInput).toHaveValue("2027-06-01", { timeout: 30_000 });

  await row.locator('input[id$="-title"]').fill(policyTitle);
  const providerInput = row.locator('input[id$="-provider"]');
  if (!(await providerInput.inputValue())) {
    await providerInput.fill("ACME Insurance Pty Ltd");
  }

  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Filed ${filename}`)).toBeVisible();

  // Filing from the Inbox doesn't navigate away — find the new contract
  // from the list instead.
  await page.goto("/contracts");
  await page.getByRole("link", { name: policyTitle }).click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  await expect(page.locator("body")).toContainText(policyTitle);
  await expect(page.getByText(/Needs review/)).toBeVisible();
  await expect(page.getByText("Confirm reviewed details")).toBeVisible();
  await expect(page.locator('input[id="reviewField:startDate"]')).toHaveValue("2026-06-01");
  await expect(page.locator('input[id="reviewField:endDate"]')).toHaveValue("2027-06-01");

  // Corrections made right here in the review panel must actually stick —
  // not just re-confirm the original extracted value.
  await page.locator('input[id="reviewField:endDate"]').fill("2027-08-15");

  await page.getByRole("button", { name: "Confirm reviewed details" }).click();
  // The confirmation flash lives inside the review panel itself, which
  // unmounts on the same revalidation that would show it — assert the
  // resulting state instead: the panel is gone and RecordMeta shows the
  // confirmation timestamp.
  await expect(page.getByText(/Needs review/)).not.toBeVisible();
  await expect(page.getByText("Confirm reviewed details")).not.toBeVisible();
  await expect(page.getByText(/Auto-filled details confirmed/)).toBeVisible();

  const endDateRow = page.locator("dt", { hasText: "End date" }).locator("xpath=following-sibling::dd[1]");
  await expect(endDateRow).toHaveText(/15 Aug(ust)? 2027/);
});
