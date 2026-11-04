import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";

const shellUrl = pathToFileURL(`${process.cwd()}/ios-shell/www/index.html`).toString();

// Siri and Shortcuts "open to" routes (#533). The native IntentsPlugin is
// stubbed: it holds one pending route in memory, hands it out once from
// consumePendingRoute(), and can fire the `pendingRoute` event or the App
// plugin's `resume` event the way iOS would.
type Route = "addContract" | "addProduct" | "whatsDue";

type IntentTest = {
  consumeCalls: number;
  navigations: string[];
  pending: () => Route | null;
  setPending: (route: Route | null) => void;
  firePendingRoute: (route: Route) => void;
  resumeWith: (route: Route) => void;
};

const SERVER_PATHS: Record<Route, string> = {
  addContract: "/contracts/new",
  addProduct: "/products/new",
  whatsDue: "/dashboard",
};

async function bootShell(
  page: Page,
  options: {
    mode?: "standalone" | "connected";
    entitled?: boolean;
    launchRoute?: Route;
    serverUrl?: string;
    failedAttemptUrl?: string;
  } = {},
) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.addInitScript(
    ({ mode, entitled, launchRoute, serverUrl, failedAttemptUrl, serverPaths }) => {
      const preferences = new Map<string, string>();
      if (mode) preferences.set("hearth.mobile.runtimeMode", mode);
      if (failedAttemptUrl) localStorage.setItem("lastConnectAttempt", JSON.stringify({ url: failedAttemptUrl, ts: Date.now() }));

      let pending: string | null = launchRoute ?? null;
      const listeners: Record<string, (() => void)[]> = {};
      const appListeners: Record<string, (() => void)[]> = {};
      const navigations: string[] = [];
      const test = {
        consumeCalls: 0,
        navigations,
        pending: () => pending,
        setPending: (route: string | null) => {
          pending = route;
        },
        firePendingRoute: (route: string) => {
          pending = route;
          (listeners.pendingRoute ?? []).forEach((listener) => listener());
        },
        resumeWith: (route: string) => {
          pending = route;
          (appListeners.resume ?? []).forEach((listener) => listener());
        },
      };
      const active = entitled === false ? {} : { standalone_mode: { identifier: "standalone_mode", isActive: true } };

      (window as Window & { __intentTest?: unknown; __hearthStandaloneTest?: unknown }).__intentTest = test;
      (window as Window & { __hearthStandaloneTest?: unknown }).__hearthStandaloneTest = {
        onConnectedNavigate: (url: string) => navigations.push(url),
      };
      (window as Window & { Capacitor?: unknown }).Capacitor = {
        getPlatform: () => "ios",
        Plugins: {
          Intents: {
            consumePendingRoute: async () => {
              test.consumeCalls += 1;
              const route = pending;
              pending = null;
              return route ? { route, path: (serverPaths as Record<string, string>)[route] } : {};
            },
            addListener: (event: string, listener: () => void) => {
              (listeners[event] ??= []).push(listener);
              return Promise.resolve({ remove: async () => undefined });
            },
          },
          App: {
            addListener: (event: string, listener: () => void) => {
              (appListeners[event] ??= []).push(listener);
              return Promise.resolve({ remove: async () => undefined });
            },
          },
          Preferences: {
            get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
            set: async ({ key, value }: { key: string; value: string }) => {
              preferences.set(key, value);
            },
            remove: async ({ key }: { key: string }) => {
              preferences.delete(key);
            },
          },
          ServerConfig: {
            getServerUrl: async () => ({ url: serverUrl ?? "" }),
            setServerUrl: async () => ({}),
          },
          Purchases: {
            configure: async () => ({}),
            getCustomerInfo: async () => ({ customerInfo: { entitlements: { active } } }),
            getOfferings: async () => ({ current: null, all: {} }),
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
    },
    { ...options, serverPaths: SERVER_PATHS },
  );

  await page.goto(shellUrl);
  return { pageErrors };
}

function intentState(page: Page) {
  return page.evaluate(() => {
    const test = (window as unknown as { __intentTest: IntentTest }).__intentTest;
    return { consumeCalls: test.consumeCalls, pending: test.pending(), navigations: [...test.navigations] };
  });
}

function fire(page: Page, how: "event" | "resume", route: Route) {
  return page.evaluate(
    ([kind, value]) => {
      const test = (window as unknown as { __intentTest: IntentTest }).__intentTest;
      if (kind === "event") test.firePendingRoute(value as Route);
      else test.resumeWith(value as Route);
    },
    [how, route] as const,
  );
}

test.describe("standalone", () => {
  test("a launch route opens the add-contract form once", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone", launchRoute: "addContract" });

    await expect(page.locator('form[data-save-type="contracts"]')).toBeVisible();
    await expect(page.locator("#view-title")).toHaveText("Add record");
    const state = await intentState(page);
    expect(state.pending).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("a normal launch with no route opens the dashboard", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone" });

    await expect(page.locator("#view-title")).toHaveText("Dashboard");
    await expect(page.locator("form[data-save-type]")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("resume opens the add-product form", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone" });
    await expect(page.locator("#view-title")).toHaveText("Dashboard");

    await fire(page, "resume", "addProduct");

    await expect(page.locator('form[data-save-type="products"]')).toBeVisible();
    expect((await intentState(page)).pending).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("the pendingRoute event opens what's due", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone" });
    await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
    await expect(page.locator("#view-title")).toHaveText("Contracts");

    await fire(page, "event", "whatsDue");

    await expect(page.locator("#view-title")).toHaveText("Dashboard");
    expect(pageErrors).toEqual([]);
  });

  test("a route never replaces a form with unsaved input", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone", launchRoute: "addContract" });
    const form = page.locator('form[data-save-type="contracts"]');
    await expect(form).toBeVisible();
    await form.locator('input[name="title"]').fill("Half-typed contract");

    await fire(page, "resume", "addProduct");
    await expect.poll(async () => (await intentState(page)).pending).toBeNull();
    await fire(page, "event", "whatsDue");
    await expect.poll(async () => (await intentState(page)).pending).toBeNull();

    await expect(form).toBeVisible();
    await expect(form.locator('input[name="title"]')).toHaveValue("Half-typed contract");
    await expect(page.locator('form[data-save-type="products"]')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("a route does replace an untouched form", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone", launchRoute: "addContract" });
    await expect(page.locator('form[data-save-type="contracts"]')).toBeVisible();

    await fire(page, "event", "addProduct");

    await expect(page.locator('form[data-save-type="products"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("an unpurchased standalone install drops the route on the paywall", async ({ page }) => {
    const { pageErrors } = await bootShell(page, { mode: "standalone", entitled: false, launchRoute: "addContract" });

    await expect(page.locator("#paywall-screen")).toBeVisible();
    await expect.poll(async () => (await intentState(page)).pending).toBeNull();
    await expect(page.locator("#standalone-screen")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});

test("the mode picker drops the route with a one-line hint", async ({ page }) => {
  const { pageErrors } = await bootShell(page, { launchRoute: "whatsDue" });

  await expect(page.locator("#mode-screen")).toBeVisible();
  await expect(page.locator("#mode-status")).toHaveText("Open Hearth first to finish setup.");
  expect((await intentState(page)).pending).toBeNull();

  await page.getByRole("button", { name: "Connect to my server" }).click();
  await expect(page.locator("#mode-status")).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test.describe("connected", () => {
  test("a launch route opens that page on the saved server", async ({ page }) => {
    const { pageErrors } = await bootShell(page, {
      mode: "connected",
      serverUrl: "https://saved.hearth.example",
      launchRoute: "addContract",
    });

    await expect.poll(async () => (await intentState(page)).navigations).toEqual(["https://saved.hearth.example/contracts/new"]);
    expect((await intentState(page)).pending).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("an unreachable server keeps the usual fallback and leaves the route alone", async ({ page }) => {
    const { pageErrors } = await bootShell(page, {
      mode: "connected",
      serverUrl: "https://saved.hearth.example",
      failedAttemptUrl: "https://saved.hearth.example",
      launchRoute: "whatsDue",
    });

    await expect(page.locator("#connected-status")).toContainText("Could not reach https://saved.hearth.example");
    const state = await intentState(page);
    expect(state.navigations).toEqual([]);
    // Not opened by the shell; the native side lets it expire.
    expect(state.pending).toBe("whatsDue");
    expect(pageErrors).toEqual([]);
  });
});
