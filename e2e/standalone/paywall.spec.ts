import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";

const shellUrl = pathToFileURL(`${process.cwd()}/ios-shell/www/index.html`).toString();

// Standalone/local-hosting mode is gated behind a one-time RevenueCat
// purchase (STANDALONE_ENTITLEMENT_ID in app.js); connecting to a
// self-hosted server never touches Purchases at all. This mock is
// deliberately separate from mobile-shell.spec.ts's fixture — it only needs
// enough of a SQLite stub for a fresh-install initDb() to succeed once
// unlocked, not the full per-table fixture data that file's other tests use.
async function mockCapacitor(page: Page, { entitled }: { entitled: boolean }) {
  await page.addInitScript((initiallyEntitled) => {
    const calls: { method: string; args?: unknown }[] = [];
    let unlocked = initiallyEntitled;
    let purchaseOutcome: "success" | "cancel" | "error" = "success";

    const activeEntitlements = () => (unlocked ? { standalone_mode: { identifier: "standalone_mode", isActive: true } } : {});

    (window as Window & { __paywallTest?: unknown }).__paywallTest = {
      calls,
      setUnlocked: (value: boolean) => {
        unlocked = value;
      },
      setPurchaseOutcome: (value: "success" | "cancel" | "error") => {
        purchaseOutcome = value;
      },
    };

    (window as Window & { Capacitor?: unknown }).Capacitor = {
      getPlatform: () => "ios",
      Plugins: {
        Purchases: {
          configure: async (args: unknown) => {
            calls.push({ method: "configure", args });
          },
          getCustomerInfo: async () => {
            calls.push({ method: "getCustomerInfo" });
            return { customerInfo: { entitlements: { active: activeEntitlements() } } };
          },
          getOfferings: async () => {
            calls.push({ method: "getOfferings" });
            return {
              current: {
                identifier: "default",
                availablePackages: [
                  {
                    identifier: "standalone_unlock",
                    product: { identifier: "standalone_unlock", priceString: "$9.99" },
                  },
                ],
              },
              all: {},
            };
          },
          purchasePackage: async (args: unknown) => {
            calls.push({ method: "purchasePackage", args });
            if (purchaseOutcome === "cancel") {
              const error = new Error("Purchase cancelled by user") as Error & { userCancelled: boolean };
              error.userCancelled = true;
              throw error;
            }
            if (purchaseOutcome === "error") {
              throw new Error("Store unavailable");
            }
            unlocked = true;
            return { productIdentifier: "standalone_unlock", customerInfo: { entitlements: { active: activeEntitlements() } } };
          },
          restorePurchases: async () => {
            calls.push({ method: "restorePurchases" });
            return { customerInfo: { entitlements: { active: activeEntitlements() } } };
          },
        },
        Preferences: {
          get: async () => ({ value: null }),
          set: async () => ({}),
          remove: async () => ({}),
        },
        CapacitorSQLite: {
          createConnection: async () => ({}),
          open: async () => ({}),
          execute: async () => ({ changes: { changes: 0 } }),
          run: async () => ({ changes: { changes: 1 } }),
          query: async () => ({ values: [] }),
          isSecretStored: async () => ({ result: true }),
          setEncryptionSecret: async () => ({}),
          isDatabase: async () => ({ result: true }),
          isDatabaseEncrypted: async () => ({ result: true }),
        },
      },
    };
  }, entitled);
}

test("standalone mode shows a paywall instead of opening when not entitled", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();

  await expect(page.locator("#paywall-screen")).toBeVisible();
  await expect(page.locator("#standalone-screen")).toBeHidden();
  await expect(page.locator("#paywall-price")).toContainText("$9.99");
  expect(pageErrors).toEqual([]);
});

test("already-entitled users skip the paywall entirely", async ({ page }) => {
  await mockCapacitor(page, { entitled: true });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();

  await expect(page.locator("#standalone-screen")).toBeVisible();
  await expect(page.locator("#paywall-screen")).toBeHidden();
});

test("buying the standalone unlock proceeds into standalone mode", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#paywall-screen")).toBeVisible();

  await page.getByRole("button", { name: "Buy standalone unlock" }).click();
  await expect(page.locator("#standalone-screen")).toBeVisible();

  const calls = await page.evaluate(() => (window as Window & { __paywallTest?: { calls: { method: string }[] } }).__paywallTest?.calls ?? []);
  expect(calls.some((call) => call.method === "purchasePackage")).toBe(true);
});

test("restoring a previous purchase proceeds into standalone mode", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#paywall-screen")).toBeVisible();

  // Simulate the store already knowing about a purchase made on another
  // device / a previous install, surfaced only via restore, not getCustomerInfo.
  await page.evaluate(() => (window as Window & { __paywallTest?: { setUnlocked: (v: boolean) => void } }).__paywallTest?.setUnlocked(true));
  await page.getByRole("button", { name: "Restore purchases" }).click();

  await expect(page.locator("#standalone-screen")).toBeVisible();
});

test("restoring with no prior purchase stays on the paywall with a clear message", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#paywall-screen")).toBeVisible();

  await page.getByRole("button", { name: "Restore purchases" }).click();
  await expect(page.locator("#paywall-status")).toContainText("No previous purchase found");
  await expect(page.locator("#paywall-screen")).toBeVisible();
});

test("a cancelled purchase shows a neutral message and stays on the paywall", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#paywall-screen")).toBeVisible();

  await page.evaluate(() => (window as Window & { __paywallTest?: { setPurchaseOutcome: (v: string) => void } }).__paywallTest?.setPurchaseOutcome("cancel"));
  await page.getByRole("button", { name: "Buy standalone unlock" }).click();

  await expect(page.locator("#paywall-status")).toContainText("Purchase cancelled");
  await expect(page.locator("#paywall-screen")).toBeVisible();
  await expect(page.locator("#standalone-screen")).toBeHidden();
});

test("the Back button on the paywall returns to mode selection", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#paywall-screen")).toBeVisible();

  await page.locator("#paywall-screen").getByRole("button", { name: "Back" }).click();
  await expect(page.locator("#mode-screen")).toBeVisible();
});

test("connected mode never configures or calls Purchases", async ({ page }) => {
  await mockCapacitor(page, { entitled: false });
  await page.goto(shellUrl);
  await page.getByRole("button", { name: "Connect to my server" }).click();
  await expect(page.locator("#connected-screen")).toBeVisible();

  const calls = await page.evaluate(() => (window as Window & { __paywallTest?: { calls: unknown[] } }).__paywallTest?.calls ?? []);
  expect(calls).toEqual([]);
});
