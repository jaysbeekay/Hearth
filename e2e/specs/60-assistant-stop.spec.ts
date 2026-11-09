import http from "http";
import type { AddressInfo } from "net";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 1440, height: 900 } });

// An Ollama-shaped /api/chat that streams the start of a reply and then
// never finishes, so the reply stays pending until it is stopped. Counts the
// requests it gets and the ones the server hung up on.
function startHangingOllama() {
  const stats = { requests: 0, closed: 0 };
  return new Promise<{ url: string; stats: typeof stats; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      stats.requests += 1;
      res.on("close", () => {
        stats.closed += 1;
      });
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ message: { role: "assistant", content: "Your next renewal is" }, done: false }) + "\n");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        stats,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
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

test("a streaming assistant reply can be stopped, and closing the panel stops it too", async ({ page }) => {
  const mock = await startHangingOllama();
  try {
    await configureMockAssistant(page, mock.url);

    await page.goto("/contracts");
    await page.getByRole("button", { name: "Open assistant panel" }).click();
    const panel = page.getByRole("complementary", { name: "Assistant" });

    await expect(panel.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await panel.locator("textarea").fill("When is my next renewal?");
    await page.keyboard.press("Enter");
    await expect(panel.getByText("Your next renewal is")).toBeVisible();

    // Stop replaces Send only while the reply is pending.
    await expect(panel.getByRole("button", { name: "Send" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Stop" }).click();
    await expect(panel.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(panel.getByText(/Your next renewal is\s+\(stopped\)/)).toBeVisible();
    await expect(panel.getByRole("alert")).toHaveCount(0);

    // The server gave up on the provider and made no further calls.
    await expect.poll(() => mock.stats.closed).toBe(1);
    expect(mock.stats.requests).toBe(1);

    // The composer is usable straight away, in the same chat; closing the
    // panel mid-reply stops that reply too.
    await expect(panel.locator("textarea")).toBeEnabled();
    await expect(panel.locator("textarea")).toBeFocused();
    await panel.locator("textarea").fill("Which one renews after that?");
    await page.keyboard.press("Enter");
    await expect(panel.getByText("Your next renewal is")).toHaveCount(2);
    await expect(panel.getByRole("button", { name: "Stop" })).toBeVisible();
    await panel.getByRole("button", { name: "Close assistant panel" }).click();
    await expect.poll(() => mock.stats.closed).toBe(2);
    expect(mock.stats.requests).toBe(2);

    // Re-opening the conversation shows the saved partial replies, marked as stopped.
    await page.reload();
    await page.getByRole("button", { name: "Open assistant panel" }).click();
    await panel.locator("#assistantPanelThread").selectOption({ label: "When is my next renewal?" });
    await expect(panel.getByText("Which one renews after that?")).toBeVisible();
    await expect(panel.getByText(/Your next renewal is\s+\(stopped\)/)).toHaveCount(2);
  } finally {
    await mock.close();
  }
});
