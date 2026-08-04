import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";

const shellUrl = pathToFileURL(`${process.cwd()}/ios-shell/www/index.html`).toString();

async function bootConnectedShell(
  page: Page,
  options: { mode?: "connected"; serverUrl?: string } = {},
) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.addInitScript(({ mode, serverUrl }) => {
    const preferences = new Map<string, string>();
    const serverConfig = { url: serverUrl ?? "" };
    const savedUrls: string[] = [];
    const navigations: string[] = [];
    const importedCertificates: string[] = [];
    if (mode) preferences.set("hearth.mobile.runtimeMode", mode);

    (window as Window & { Capacitor?: unknown; __hearthStandaloneTest?: unknown }).__hearthStandaloneTest = {
      savedUrls,
      navigations,
      importedCertificates,
      onConnectedNavigate: (url: string) => {
        navigations.push(url);
      },
    };
    (window as Window & { Capacitor?: unknown }).Capacitor = {
      Plugins: {
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
          getServerUrl: async () => ({ url: serverConfig.url }),
          setServerUrl: async ({ url }: { url: string }) => {
            serverConfig.url = url;
            savedUrls.push(url);
            return {};
          },
          importClientCertificate: async () => {
            importedCertificates.push("Test certificate");
            return { label: "Test certificate" };
          },
        },
      },
    };
  }, options);

  await page.goto(shellUrl);
  return { pageErrors };
}

test("connected shell rejects unsafe public HTTP server URLs", async ({ page }) => {
  const { pageErrors } = await bootConnectedShell(page);
  await page.getByRole("button", { name: "Connect to my server" }).click();
  await page.locator("#server-url").fill("http://example.com");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.locator("#connected-status")).toContainText("Plain HTTP is not allowed");
  const state = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { savedUrls: string[]; navigations: string[] } }).__hearthStandaloneTest;
  });
  expect(state?.savedUrls).toEqual([]);
  expect(state?.navigations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("connected shell saves and opens HTTPS self-hosted server URLs immediately", async ({ page }) => {
  const { pageErrors } = await bootConnectedShell(page);
  await page.getByRole("button", { name: "Connect to my server" }).click();
  await page.locator("#server-url").fill("https://hearth.example.com///");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.locator("#connected-status")).toContainText("Connecting to https://hearth.example.com");
  const state = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { savedUrls: string[]; navigations: string[] } }).__hearthStandaloneTest;
  });
  expect(state?.savedUrls).toEqual(["https://hearth.example.com"]);
  expect(state?.navigations).toEqual(["https://hearth.example.com"]);
  expect(pageErrors).toEqual([]);
});

test("connected shell allows local HTTP development and imports client certificates", async ({ page }) => {
  const { pageErrors } = await bootConnectedShell(page);
  await page.getByRole("button", { name: "Connect to my server" }).click();
  await page.locator("#server-url").fill("http://localhost:3000");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Import client certificate" }).click();

  await expect(page.locator("#connected-status")).toContainText("Imported certificate: Test certificate");
  const state = await page.evaluate(() => {
    return (window as Window & {
      __hearthStandaloneTest?: {
        savedUrls: string[];
        navigations: string[];
        importedCertificates: string[];
      };
    }).__hearthStandaloneTest;
  });
  expect(state?.savedUrls).toEqual(["http://localhost:3000"]);
  expect(state?.navigations).toEqual(["http://localhost:3000"]);
  expect(state?.importedCertificates).toEqual(["Test certificate"]);
  expect(pageErrors).toEqual([]);
});

test("connected shell autoconnects to a remembered server once", async ({ page }) => {
  const { pageErrors } = await bootConnectedShell(page, {
    mode: "connected",
    serverUrl: "https://saved.hearth.example",
  });

  await expect(page.locator("#connected-screen")).toBeVisible();
  await expect(page.locator("#server-url")).toHaveValue("https://saved.hearth.example");
  const state = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { navigations: string[] } }).__hearthStandaloneTest;
  });
  expect(state?.navigations).toEqual(["https://saved.hearth.example"]);
  expect(pageErrors).toEqual([]);
});
