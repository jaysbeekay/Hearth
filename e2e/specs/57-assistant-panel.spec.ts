import http from "http";
import type { AddressInfo } from "net";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 1440, height: 900 } });

// An Ollama-shaped /api/chat that answers every turn with one line of text.
function startMockOllama(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ message: { role: "assistant", content: "Hello from the panel." }, done: false }) + "\n");
        res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function configureMockAssistant(page: Page, url: string) {
  await page.goto("/settings/ai");
  if (await page.getByRole("button", { name: "Turn on" }).isVisible()) {
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText("AI Assistant turned on.")).toBeVisible();
  }
  const chatAlreadySet = (await page.locator("#chatProvider").inputValue()) === "OLLAMA";
  await page.locator("#ollamaBaseUrl").fill(url);
  await page.selectOption("#chatProvider", "OLLAMA");
  const chatModel = page.locator("#chatModel");
  const modelAlreadySet = chatAlreadySet && (await chatModel.inputValue()) === "test-model";
  await chatModel.fill("test-model");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Ollama settings saved.").first()).toBeVisible();
  if (!modelAlreadySet) await expect(page.getByText("AI Assistant settings saved.").first()).toBeVisible();
}

test("assistant side panel opens beside any page, chats, and remembers open/closed", async ({ page }) => {
  const mock = await startMockOllama();
  try {
    await configureMockAssistant(page, mock.url);

    await page.goto("/contracts");
    const panel = page.getByRole("complementary", { name: "Assistant" });
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "Open assistant panel" }).click();
    await expect(panel).toBeVisible();

    await panel.locator("textarea").fill("What renews next month?");
    await page.keyboard.press("Enter");
    await expect(panel.getByText("Hello from the panel.")).toBeVisible();

    // Still open after a navigation and a reload, with the chat listed.
    await page.goto("/dashboard");
    await expect(panel).toBeVisible();
    await expect(panel.locator("#assistantPanelThread option", { hasText: "What renews next month?" })).toHaveCount(1);

    // A chat deleted on the full page leaves the panel's list, and the panel
    // starts a new chat instead of sending into the deleted one. Everything
    // from here is in-app navigation, so the panel keeps its state (its open
    // chat) the whole way, as it does for a user; a marker on window proves
    // no full reload slipped in.
    await panel.locator("#assistantPanelThread").selectOption({ label: "What renews next month?" });
    await expect(panel.getByText("Hello from the panel.")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
    });
    await panel.getByRole("link", { name: "Open full Assistant page" }).click();
    await expect(page).toHaveURL(/\/assistant\?thread=/);
    const row = page.locator("div.group", { has: page.getByRole("link", { name: "What renews next month?" }) });
    await row.getByRole("button", { name: "Delete conversation" }).click({ force: true });
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete conversation" }).click();
    await expect(page.getByRole("link", { name: "What renews next month?" })).toHaveCount(0);
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Contracts", exact: true }).click();
    await expect(page).toHaveURL(/\/contracts$/);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    await expect(panel.locator("#assistantPanelThread option", { hasText: "What renews next month?" })).toHaveCount(0);
    await expect(panel.getByText("Hello from the panel.")).toHaveCount(0);
    await panel.locator("textarea").fill("And after that?");
    await page.keyboard.press("Enter");
    await expect(panel.getByText("Hello from the panel.")).toBeVisible();
    await expect(panel.getByText("Conversation not found.")).toHaveCount(0);

    await panel.getByRole("button", { name: "Close assistant panel" }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open assistant panel" })).toBeVisible();
    await expect(panel).toHaveCount(0);

    // The full page is the same chat, so no panel there.
    await page.goto("/assistant");
    await expect(page.getByRole("button", { name: "Open assistant panel" })).toHaveCount(0);

    // Narrower windows use the Assistant page instead.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/contracts");
    await expect(page.getByRole("button", { name: "Open assistant panel" })).toBeHidden();
  } finally {
    await mock.close();
  }
});

// #617 — under reduced motion the chat jumps to the newest message instead of
// scrolling smoothly. Records the behaviour every scrollTo asks for.
test("the chat scrolls instantly under reduced motion", async ({ page }) => {
  const mock = await startMockOllama();
  try {
    await configureMockAssistant(page, mock.url);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const w = window as unknown as { __scrollBehaviors: string[] };
      w.__scrollBehaviors = [];
      const original = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
        const opts = args[0];
        if (opts && typeof opts === "object") {
          w.__scrollBehaviors.push(String((opts as ScrollToOptions).behavior));
        }
        return (original as (...a: unknown[]) => void).apply(this, args);
      } as typeof Element.prototype.scrollTo;
    });

    await page.goto("/assistant");
    await page.locator("textarea").fill("Anything due soon?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hello from the panel.")).toBeVisible();

    const behaviors = await page.evaluate(() => (window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors);
    expect(behaviors.length).toBeGreaterThan(0);
    expect(behaviors).not.toContain("smooth");
  } finally {
    await mock.close();
  }
});
