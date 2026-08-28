import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #328 — cross-domain completeness/attention filters. The missingDate/
// missingReminder/missingRelationship/missingIdentifier filters originally
// only covered Contract/Product; this checks they also reach Vehicle
// (via Global Search) and that the Dashboard's "missing info" stat cards
// deep-link to the right, correctly-filtered set.
test.describe.serial("Completeness filters", () => {
  test("dashboard 'Contracts missing info' stat links to a correctly filtered list", async ({
    page,
  }) => {
    // Computed inside the test body (not module scope) so it's fresh even
    // on a CI retry that reuses the worker process — CI retries a failed
    // test once, and a stale module-level stamp would collide with records
    // the aborted first attempt already created, breaking locators below
    // with a strict-mode "resolved to 2+ elements" violation instead of
    // the real assertion.
    const stamp = Date.now();
    const completeTitle = `Completeness Filter Complete Contract ${stamp}`;
    const incompleteTitle = `Completeness Filter Incomplete Contract ${stamp}`;

    // Complete: has everything.
    await page.goto("/contracts/new");
    await page.locator("#title").fill(completeTitle);
    await page.locator("#provider").fill("Complete Provider");
    await page.locator("#contractNumber").fill(`POL-COMPLETE-${stamp}`);
    await page.locator("#endDate").fill("2030-01-01");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    // Incomplete: missing end date, contract number, and any link.
    await page.goto("/contracts/new");
    await page.locator("#title").fill(incompleteTitle);
    await page.locator("#provider").fill("Incomplete Provider");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    await page.goto("/dashboard");
    const statCard = page.getByRole("link", { name: /Contracts missing info/ });
    await expect(statCard).toBeVisible();
    const href = await statCard.getAttribute("href");
    expect(href).toBe("/contracts?missingInfo=true");

    await statCard.click();
    await page.waitForURL(/\/contracts\?missingInfo=true/);
    await expect(page.locator("body")).toContainText(incompleteTitle);
    await expect(page.locator("body")).not.toContainText(completeTitle);
  });

  test("Global Search 'Missing date' and 'Missing identifier' filters reach vehicles, not just contracts/products", async ({
    page,
  }) => {
    const stamp = Date.now();
    const completeLabel = `Completeness Filter Complete Vehicle ${stamp}`;
    const incompleteLabel = `Completeness Filter Incomplete Vehicle ${stamp}`;

    await page.goto("/settings/modules");
    const vehiclesRow = page.locator("li", { hasText: "Vehicles" });
    if (await vehiclesRow.getByRole("button", { name: "Enable" }).count()) {
      await vehiclesRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    // Complete: has every date and identifier the filters check.
    await page.goto("/vehicles/new");
    await page.locator("#label").fill(completeLabel);
    await page.locator("#vin").fill("1HGCM82633A123456");
    await page.locator("#regoExpiry").fill("2030-01-01");
    await page.locator("#insuranceExpiry").fill("2030-01-01");
    await page.locator("#nextServiceDue").fill("2030-01-01");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    // Incomplete: no rego/insurance/service dates, no VIN/plate.
    await page.goto("/vehicles/new");
    await page.locator("#label").fill(incompleteLabel);
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);

    await page.goto("/dashboard");
    await page.locator("aside").getByRole("button", { name: "Search" }).click();

    await page.getByRole("button", { name: "Missing date" }).click();
    await expect(page.getByText(incompleteLabel)).toBeVisible();
    await expect(page.getByText(completeLabel)).not.toBeVisible();
    // The result explains why it needs attention, not just that it does.
    await expect(page.getByText("Missing rego, insurance, or service date")).toBeVisible();

    await page.getByRole("button", { name: "Missing date" }).click(); // deselect
    await page.getByRole("button", { name: "Missing identifier" }).click();
    await expect(page.getByText(incompleteLabel)).toBeVisible();
    await expect(page.getByText(completeLabel)).not.toBeVisible();
    await expect(page.getByText("Missing VIN/license plate")).toBeVisible();
  });
});
