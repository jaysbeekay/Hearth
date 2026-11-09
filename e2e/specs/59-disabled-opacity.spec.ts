import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #620: disabled controls dim to 50%, and an action that needs a connection
// dims further, to 40%, while offline. The offline "Add contract" link is
// aria-disabled as well, and [aria-disabled="true"] outranks a bare
// opacity-40, so check what the browser actually renders.
test("an offline action renders at 40%, not the disabled 50%", async ({ page, context }) => {
  await page.goto("/contracts");
  const add = page.locator("main").getByRole("link", { name: "Add contract", exact: true }).first();
  await expect(add).toHaveCSS("opacity", "1");

  await context.setOffline(true);
  try {
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveCSS("opacity", "0.4");
  } finally {
    await context.setOffline(false);
  }
  await expect(add).toHaveCSS("opacity", "1");
});
