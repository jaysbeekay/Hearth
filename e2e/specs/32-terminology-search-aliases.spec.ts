import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #332 supersedes #174: nav/headings now read "Policies & contracts" /
// "Purchases & warranties" instead of the bare "Contracts"/"Warranties".
// Global Search still recognizes the old generic words (and the new ones)
// as meaning "show me that whole section" — not just literal field matches.
test("Global Search's old-term aliases surface every contract/product of that type, not just literal field matches", async ({
  page,
}) => {
  const stamp = Date.now();
  const contractTitle = `Alias Test Contract ${stamp}`;
  const productDescription = `Alias Test Product ${stamp}`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill(contractTitle);
  await page.locator("#provider").fill("Some Unrelated Provider Name");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await page.goto("/products/new");
  await page.locator("#description").fill(productDescription);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/products\/(?!new$)[^/]+$/);

  await page.goto("/dashboard");
  // The Search button opens GlobalSearch's dialog via a client-only event
  // listener that isn't wired up until React hydrates, so a click right
  // after goto() can land before it exists and silently no-op — retry
  // until the dialog is actually open (see 26-document-search.spec.ts).
  await expect(async () => {
    await page.locator("aside").getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("combobox")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  // Old term "contract" finds the contract even though that literal word
  // appears nowhere in its title/provider.
  await page.getByRole("combobox").fill("contract");
  await expect(page.getByText(contractTitle)).toBeVisible();
  await expect(page.getByText(productDescription)).not.toBeVisible();

  // New term "policy" (the nav's new wording) does the same.
  await page.getByRole("combobox").fill("policy");
  await expect(page.getByText(contractTitle)).toBeVisible();

  // Old term "warranty" finds the product.
  await page.getByRole("combobox").fill("warranty");
  await expect(page.getByText(productDescription)).toBeVisible();
  await expect(page.getByText(contractTitle)).not.toBeVisible();

  // New term "purchase" does the same.
  await page.getByRole("combobox").fill("purchase");
  await expect(page.getByText(productDescription)).toBeVisible();
});
