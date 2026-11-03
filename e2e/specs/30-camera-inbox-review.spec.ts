import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { textPdfBytes } from "../textPdf";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 375, height: 812 } });

// #327 — camera capture saves straight to the Inbox (not routed through a
// generic untyped queue), and Inbox classification supports the same
// policy/warranty date fields as Import with the same field-level
// provenance capture. This exercises that whole path end to end: capture ->
// Inbox -> classify as a contract with real extracted dates. #359: the
// person edited the row before pressing Save, which is the review, so the
// record files as confirmed rather than landing in Needs review.
test("capturing a document saves it to the Inbox, and classifying it after editing files it as reviewed", async ({
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
  const row = page.locator("div.rounded-lg.border.border-border.bg-surface", {
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
  await expect(page.getByText(/Needs review/)).toHaveCount(0);
  await expect(page.getByText("Confirm reviewed details")).toHaveCount(0);
  await expect(page.getByText(/Auto-filled details confirmed/)).toBeVisible();
});

// #359 — on the contract form, pressing Save after a scan is the review:
// the record saves confirmed. "Save for later review" keeps the old path,
// Needs review with the per-field review panel (#331).
async function scanIntoContractForm(page: import("@playwright/test").Page, title: string) {
  await page.goto("/contracts/new");
  await page.locator('input[type="file"][name="file"]').first().setInputFiles({
    name: `form-scan-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: textPdfBytes(["ACME Insurance Pty Ltd", "Start Date: 2026-06-01", "End Date: 2027-06-01"]),
  });
  await expect(page.locator("#endDate")).toHaveValue("2027-06-01", { timeout: 30_000 });
  const note = page.getByRole("list", { name: "Auto-filled fields" });
  await expect(note.getByText("End date", { exact: true })).toBeVisible();
  await expect(page.getByText(/I've checked the highlighted fields/)).toHaveCount(0);
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("OTHER");
  const provider = page.locator("#provider");
  if (!(await provider.inputValue())) await provider.fill("ACME Insurance Pty Ltd");
}

test("saving a scanned contract confirms it, with no checkbox to tick", async ({ page }) => {
  test.setTimeout(90_000);
  const title = `Scan Save Confirms ${Date.now()}`;
  await scanIntoContractForm(page, title);
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/?]+/),
    page.getByRole("button", { name: "Add contract" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/Needs review/)).toHaveCount(0);
  await expect(page.getByText(/Auto-filled details confirmed/)).toBeVisible();
});

test("Save for later review keeps a scanned contract in Needs review with its review panel", async ({ page }) => {
  test.setTimeout(90_000);
  const title = `Scan Save Later ${Date.now()}`;
  await scanIntoContractForm(page, title);
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/?]+/),
    page.getByRole("button", { name: "Save for later review" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/Needs review/).first()).toBeVisible();
  await expect(page.locator('input[id="reviewField:endDate"]')).toHaveValue("2027-06-01");

  // Corrections made right here in the review panel must actually stick —
  // not just re-confirm the original extracted value.
  await page.locator('input[id="reviewField:endDate"]').fill("2027-08-15");
  await page.getByRole("button", { name: "Confirm reviewed details" }).click();
  await expect(page.getByText("Confirm reviewed details")).not.toBeVisible();
  await expect(page.getByText(/Auto-filled details confirmed/)).toBeVisible();
  const endDateRow = page.locator("dt", { hasText: "End date" }).locator("xpath=following-sibling::dd[1]");
  await expect(endDateRow).toHaveText(/15 Aug(ust)? 2027/);
});
