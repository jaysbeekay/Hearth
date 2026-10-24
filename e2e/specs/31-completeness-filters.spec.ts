import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #328/#395 — Missing key details, defined once in src/lib/recordFilters.ts:
// the dashboard's Housekeeping row counts with the same rule as the list it
// opens, the list shows the filter as an active chip with Clear all, each
// row says which part is missing, old URLs still land on the right filter,
// and Global Search offers one "Missing key details" chip (no "Missing
// reminder" / "Missing link").

async function createContract(
  page: Page,
  fields: { title: string; endDate?: string; cost?: string; billingFrequency?: string; renewalType?: string },
) {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(fields.title);
  await page.locator("#provider").fill("Completeness Provider");
  if (fields.endDate) await page.locator("#endDate").fill(fields.endDate);
  if (fields.renewalType) await page.selectOption("#renewalType", fields.renewalType);
  if (fields.cost) await page.locator("#cost").fill(fields.cost);
  if (fields.billingFrequency) await page.selectOption("#billingFrequency", fields.billingFrequency);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  return page.url().split("/").pop()!;
}

test.describe.serial("Completeness filters", () => {
  test("dashboard 'contracts missing key details' count equals the list it opens", async ({ page }) => {
    // Computed inside the test body (not module scope) so it's fresh even
    // on a CI retry that reuses the worker process (see #315).
    const stamp = Date.now();
    const complete = `Completeness Complete ${stamp}`;
    const noEndDate = `Completeness No End Date ${stamp}`;
    const noFrequency = `Completeness No Frequency ${stamp}`;
    const autoRenews = `Completeness Auto Renews ${stamp}`;
    const cancelled = `Completeness Cancelled ${stamp}`;

    // No contract number anywhere: it is no longer a key detail.
    await createContract(page, { title: complete, endDate: "2030-01-01", cost: "20", billingFrequency: "MONTHLY" });
    await createContract(page, { title: noEndDate });
    await createContract(page, { title: noFrequency, endDate: "2030-01-01", cost: "15" });
    await createContract(page, { title: autoRenews, renewalType: "AUTO_RENEW" });
    const cancelledId = await createContract(page, { title: cancelled });
    await page.goto(`/contracts/${cancelledId}/edit`);
    await page.selectOption("#status", "CANCELLED");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(new RegExp(`/contracts/${cancelledId}$`));

    await page.goto("/dashboard");
    const row = page.getByRole("link", { name: /\d+ contracts? (is|are) missing key details/ });
    await expect(row).toBeVisible();
    // The billing-frequency row folded into this one.
    await expect(page.getByText(/a cost but no billing frequency/)).toHaveCount(0);
    await expect(page.getByText(/policy number/)).toHaveCount(0);
    const dashboardCount = Number((await row.innerText()).match(/(\d+) contracts? (is|are) missing key details/)![1]);
    expect(await row.getAttribute("href")).toBe("/contracts?missing=details");

    await row.click();
    await page.waitForURL(/\/contracts\?missing=details$/);
    // The deep-linked filter is visible and removable.
    await expect(page.getByRole("button", { name: "Missing key details" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${dashboardCount} contracts?$`))).toBeVisible();
    await expect(page.locator('main a[href^="/contracts/c"]')).toHaveCount(dashboardCount);

    const body = page.locator("main");
    await expect(body).toContainText(noEndDate);
    await expect(body).toContainText(noFrequency);
    await expect(body).not.toContainText(complete);
    await expect(body).not.toContainText(autoRenews);
    await expect(body).not.toContainText(cancelled);
    // Each row says which part is missing.
    await expect(page.locator("a", { hasText: noEndDate }).getByText("No end date", { exact: true }).last()).toBeVisible();
    await expect(page.locator("a", { hasText: noFrequency }).getByText("No billing frequency")).toBeVisible();

    await page.getByRole("button", { name: "Clear all" }).click();
    await page.waitForURL(/\/contracts$/);
    await expect(page.getByRole("button", { name: "Missing key details" })).toHaveAttribute("aria-pressed", "false");
  });

  test("old list URLs redirect to the new filter parameters", async ({ page }) => {
    for (const [from, to, chip] of [
      ["/contracts?missingInfo=true", "/contracts?missing=details", "Missing key details"],
      ["/contracts?expiring=30", "/contracts?due=soon", "Expiring soon"],
      ["/contracts?expired=true", "/contracts?due=overdue", "Expired"],
      ["/contracts?needsReview=true", "/contracts?review=1", "Needs review"],
      ["/contracts?q=x&missingDocument=true", "/contracts?q=x&noDocument=1", "No document"],
      ["/products?missingInfo=true", "/products?missing=details", "Missing key details"],
    ] as const) {
      await page.goto(from);
      await page.waitForURL((url) => `${url.pathname}${url.search}` === to);
      await expect(page.getByRole("button", { name: chip, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("Vehicles: Missing key details means no VIN and no plate, in Search and the list", async ({ page }) => {
    const stamp = Date.now();
    const completeLabel = `Completeness Filter Complete Vehicle ${stamp}`;
    const incompleteLabel = `Completeness Filter Incomplete Vehicle ${stamp}`;

    await page.goto("/settings/modules");
    const vehiclesRow = page.locator("li", { hasText: "Vehicles" });
    if (await vehiclesRow.getByRole("button", { name: "Enable" }).count()) {
      await vehiclesRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    // A VIN alone is enough; no rego/insurance/service dates is not a gap.
    await page.goto("/vehicles/new");
    await page.locator("#label").fill(completeLabel);
    await page.locator("#vin").fill("1HGCM82633A123456");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    await page.goto("/vehicles/new");
    await page.locator("#label").fill(incompleteLabel);
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    await page.goto("/dashboard");
    const row = page.getByRole("link", { name: /\d+ vehicles? (is|are) missing key details/ });
    const dashboardCount = Number((await row.innerText()).match(/(\d+) vehicles?/)![1]);
    await row.click();
    await page.waitForURL(/\/vehicles\?missing=details$/);
    await expect(page.getByRole("button", { name: "Missing key details" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(new RegExp(`^${dashboardCount} vehicles?$`))).toBeVisible();
    await expect(page.locator("main")).toContainText(incompleteLabel);
    await expect(page.locator("main")).not.toContainText(completeLabel);
    await expect(page.locator("a", { hasText: incompleteLabel }).getByText("No VIN or plate")).toBeVisible();

    // The Search button opens GlobalSearch's dialog via a client-only event
    // listener that isn't wired up until React hydrates, so a click right
    // after goto() can land before it exists and silently no-op — retry
    // until the dialog is actually open (see 26-document-search.spec.ts).
    await page.goto("/dashboard");
    await expect(async () => {
      await page.locator("aside").getByRole("button", { name: "Search" }).click();
      await expect(page.getByRole("combobox")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    const dialog = page.getByRole("dialog", { name: "Search" });
    for (const removed of ["Missing reminder", "Missing link", "Missing date", "Missing identifier"]) {
      await expect(dialog.getByRole("button", { name: removed })).toHaveCount(0);
    }
    await dialog.getByRole("button", { name: "Missing key details" }).click();
    await expect(dialog.getByText(incompleteLabel)).toBeVisible();
    await expect(dialog.getByText(completeLabel)).not.toBeVisible();
    // The result explains what is missing, not just that something is.
    await expect(dialog.getByRole("option", { name: new RegExp(incompleteLabel) })).toContainText("No VIN or plate");
  });
});
