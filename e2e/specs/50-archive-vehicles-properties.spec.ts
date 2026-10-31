import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #355 — Archive for Vehicles and Properties (the household no longer has
// them): not Trash, so the record stays in an Archived section with its
// history, searchable and marked, but stops being Due.

test.use({ storageState: ADMIN_AUTH_FILE });

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function openMenuAndArchive(page: Page) {
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
}

test.describe.serial("Archive a Vehicle", () => {
  const label = "Archive Test Car";
  let vehicleId: string;

  test("a Vehicle with rego due soon is in Needs attention", async ({ page }) => {
    await page.goto("/vehicles/new");
    await page.locator("#label").fill(label);
    await page.locator("#regoExpiry").fill(daysFromNow(5));
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/);
    vehicleId = new URL(page.url()).pathname.split("/").pop()!;

    await page.goto("/dashboard");
    await expect(page.locator("main")).toContainText(label);
  });

  test("Archive from the menu leaves it out of Needs attention, with an Undo toast", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await expect(page.getByTestId("archived-notice")).toHaveCount(0);
    await openMenuAndArchive(page);

    await expect(page.getByTestId("archived-notice")).toContainText("Archived on");
    await expect(page.getByText("Archived.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    // No Due banner and no Reminder card for an Archived Vehicle.
    await expect(page.getByText("Registration reminder")).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.locator("main")).not.toContainText(label);
  });

  test("it is listed under Archived, not in the main list, and Search finds it marked Archived", async ({ page }) => {
    await page.goto("/vehicles");
    const archived = page.getByTestId("archived-section");
    await expect(archived).toContainText("Archived (");
    await expect(page.locator("main a", { hasText: label })).toBeHidden();
    await archived.locator("summary").click();
    await expect(archived.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    await expect(archived.getByRole("link", { name: new RegExp(label) })).toContainText("Archived");

    const res = await page.request.get("/api/search?q=Archive%20Test%20Car");
    const body = (await res.json()) as { groups: Record<string, { title: string; subtitle?: string }[]> };
    const hit = body.groups.Vehicles?.find((r) => r.title === label);
    expect(hit?.subtitle).toContain("Archived");
  });

  test("Restore puts it back and its Due entries return", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await page.getByTestId("archived-notice").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByTestId("archived-notice")).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.locator("main")).toContainText(label);
    await page.goto("/vehicles");
    await expect(page.locator("main a", { hasText: label })).toBeVisible();
  });

  test("Undo on the toast restores it too", async ({ page }) => {
    await page.goto(`/vehicles/${vehicleId}`);
    await openMenuAndArchive(page);
    await expect(page.getByTestId("archived-notice")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("archived-notice")).toHaveCount(0);
  });
});

test.describe.serial("Archive a Property", () => {
  const label = "Archive Test House";
  let propertyId: string;

  test("create a Property", async ({ page }) => {
    await page.goto("/home/new");
    await page.locator("#label").fill(label);
    await page.getByRole("button", { name: "Add property" }).click();
    await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
    propertyId = new URL(page.url()).pathname.split("/").pop()!;
  });

  test("Archive, find it under Archived and in Search, then Restore", async ({ page }) => {
    await page.goto(`/home/${propertyId}`);
    await openMenuAndArchive(page);
    await expect(page.getByTestId("archived-notice")).toContainText("Archived on");

    await page.goto("/home");
    const archived = page.getByTestId("archived-section");
    await archived.locator("summary").click();
    await expect(archived.getByRole("link", { name: new RegExp(label) })).toContainText("Archived");

    const res = await page.request.get("/api/search?q=Archive%20Test%20House");
    const body = (await res.json()) as { groups: Record<string, { title: string; subtitle?: string }[]> };
    expect(body.groups.Property?.find((r) => r.title === label)?.subtitle).toContain("Archived");

    await page.goto(`/home/${propertyId}`);
    await page.getByTestId("archived-notice").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByTestId("archived-notice")).toHaveCount(0);
    await page.goto("/home");
    await expect(page.getByTestId("archived-section")).toHaveCount(0);
  });
});
