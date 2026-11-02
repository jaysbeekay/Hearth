import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, BASE_URL } from "../env";
import { openFormSections } from "../formSections";

test.use({ storageState: ADMIN_AUTH_FILE });

// #446: an Inventory item moved to Trash while its edit form is open can't
// be saved. #447: a Contract can't be linked to a Property that went to
// Trash after the form (or an offline edit) picked it. #489: the edit forms
// don't offer a Property in Trash, but keep the one the record is already
// linked to, so saving other changes doesn't unlink it.

async function postSync(request: APIRequestContext, operations: unknown[]) {
  const res = await request.post(`${BASE_URL}/api/sync`, {
    multipart: { operations: JSON.stringify(operations) },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { results: { id: string; success: boolean; error?: string }[] }).results;
}

async function moveToTrash(request: APIRequestContext, entity: string, entityId: string) {
  const opId = `e2e-trash-${entity}-${Date.now()}`;
  expect(await postSync(request, [{ id: opId, entity, operation: "delete", entityId }])).toEqual([
    { id: opId, success: true },
  ]);
}

async function enableModule(page: Page, label: string) {
  await page.goto("/settings/modules");
  const row = page.locator("li", { hasText: label });
  await expect(row).toBeVisible();
  if (await row.getByRole("button", { name: "Enable" }).count()) {
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(page.locator("body")).toContainText("Module enabled.");
  }
}

function idFromUrl(page: Page) {
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe.serial("writes to and links to records in Trash", () => {
  let stamp: number;
  test.beforeAll(() => {
    stamp = Date.now();
  });

  test("enable the Inventory and Properties modules", async ({ page }) => {
    await enableModule(page, "Inventory");
    await enableModule(page, "Properties");
  });

  test("an Inventory item moved to Trash while its edit form is open isn't saved", async ({ page, request }) => {
    await page.goto("/inventory/new");
    await page.locator("#label").fill(`Trash Gap Item ${stamp}`);
    await page.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);
    const itemId = idFromUrl(page);

    await page.goto(`/inventory/${itemId}/edit`);
    await page.locator("#label").fill(`Trash Gap Item ${stamp} edited`);
    await moveToTrash(request, "inventoryItem", itemId);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("body")).toContainText("Item not found.");

    // The edit didn't land: the item is still in Trash under its old name.
    await page.goto("/settings/trash");
    await expect(page.getByText(`Trash Gap Item ${stamp}`, { exact: true })).toBeVisible();
  });

  test("a Contract can't be linked to a Property moved to Trash, online or offline", async ({ page, request }) => {
    const propertyLabel = `Trash Gap Property ${stamp}`;
    await page.goto("/home/new");
    await page.locator("#label").fill(propertyLabel);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
    const propertyId = idFromUrl(page);

    const title = `Trash Gap Contract ${stamp}`;
    await page.goto("/contracts/new");
    await page.locator("#title").fill(title);
    await page.locator("#category").selectOption("OTHER");
    await openFormSections(page);
    await page.locator("#provider").fill("Trash Gap Insurer");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    const contractId = idFromUrl(page);

    // Online: the property is picked, then trashed before the form is saved.
    await page.goto(`/contracts/${contractId}/edit`);
    await openFormSections(page);
    await page.getByLabel("Linked to").selectOption({ label: propertyLabel });
    await moveToTrash(request, "property", propertyId);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("body")).toContainText("That property doesn't exist or has been deleted.");

    // Offline: the same edit queued and replayed after the property went to Trash.
    const opId = `e2e-trash-link-${stamp}`;
    const results = await postSync(request, [
      {
        id: opId,
        entity: "contract",
        operation: "update",
        entityId: contractId,
        formValues: { title, category: "OTHER", provider: "Trash Gap Insurer", renewalType: "MANUAL_RENEWAL", propertyId },
      },
    ]);
    expect(results).toEqual([{ id: opId, success: false, error: "That property doesn't exist or has been deleted." }]);

    await page.goto(`/contracts/${contractId}`);
    await expect(page.getByText(propertyLabel)).toHaveCount(0);
  });

  test("the edit forms offer no Property in Trash but keep the current one through a save", async ({ page, request }) => {
    async function createProperty(label: string) {
      await page.goto("/home/new");
      await page.locator("#label").fill(label);
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
      return idFromUrl(page);
    }
    const linkedLabel = `Picker Linked Property ${stamp}`;
    const otherLabel = `Picker Other Property ${stamp}`;
    const linkedId = await createProperty(linkedLabel);
    const otherId = await createProperty(otherLabel);

    const title = `Picker Contract ${stamp}`;
    await page.goto("/contracts/new");
    await page.locator("#title").fill(title);
    await page.locator("#category").selectOption("OTHER");
    await openFormSections(page);
    await page.locator("#provider").fill("Picker Insurer");
    await page.getByLabel("Linked to").selectOption({ label: linkedLabel });
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    const contractId = idFromUrl(page);

    await page.goto("/products/new");
    await page.locator("#description").fill(`Picker Warranty ${stamp}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/products\/(?!new$)[^/]+$/);
    const productId = idFromUrl(page);

    await moveToTrash(request, "property", linkedId);
    await moveToTrash(request, "property", otherId);

    // Contract edit: the current link stays, marked; the other trashed one is gone.
    await page.goto(`/contracts/${contractId}/edit`);
    const picker = page.getByLabel("Linked to");
    await expect(picker).toHaveValue(`property:${linkedId}`);
    await expect(picker.locator("option", { hasText: `${linkedLabel} (deleted)` })).toHaveCount(1);
    await expect(picker.locator("option", { hasText: otherLabel })).toHaveCount(0);

    // Saving another change keeps the link.
    await page.locator("#provider").fill("Picker Insurer edited");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/contracts/${contractId}$`));
    await page.goto(`/contracts/${contractId}/edit`);
    await expect(page.getByLabel("Linked to")).toHaveValue(`property:${linkedId}`);

    // Warranty edit with no link: neither trashed Property is offered.
    await page.goto(`/products/${productId}/edit`);
    const warrantyPicker = page.getByLabel("Linked to");
    await expect(warrantyPicker.locator("option", { hasText: linkedLabel })).toHaveCount(0);
    await expect(warrantyPicker.locator("option", { hasText: otherLabel })).toHaveCount(0);
  });
});
