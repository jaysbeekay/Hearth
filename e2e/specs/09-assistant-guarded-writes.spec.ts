import http from "http";
import type { AddressInfo } from "net";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// A minimal Ollama-compatible /api/chat mock: the first round (no "tool"
// role message yet) proposes creating a contract; the second round (after
// the tool result comes back) streams a short closing reply. Mirrors
// Ollama's real newline-delimited-JSON streaming shape closely enough to
// exercise the app's own NDJSON parser (src/lib/ai/chat/providers/ollama.ts)
// end-to-end, without needing a real provider/API key.
function startMockOllama(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const payload = JSON.parse(body);
        const hasToolResult = payload.messages.some((m: { role: string }) => m.role === "tool");
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });

        if (!hasToolResult) {
          res.write(
            JSON.stringify({
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "propose_create_contract",
                      arguments: {
                        title: "Netflix Subscription",
                        category: "SUBSCRIPTION",
                        provider: "Netflix",
                        renewalType: "AUTO_RENEW",
                        cost: 15.99,
                        currency: "AUD",
                        billingFrequency: "MONTHLY",
                      },
                    },
                  },
                ],
              },
              done: true,
            }) + "\n",
          );
        } else {
          res.write(
            JSON.stringify({ message: { role: "assistant", content: "Prepared above." }, done: false }) + "\n",
          );
          res.write(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
        }
        res.end();
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

test("assistant proposes a contract, confirming creates it and cancelling doesn't", async ({ page }) => {
  const mock = await startMockOllama();
  try {
    await page.goto("/settings/app");
    await page.locator("#ollamaBaseUrl").fill(mock.url);
    await page
      .locator("#ollamaBaseUrl")
      .locator("xpath=ancestor::form[1]")
      .locator("button[type=submit]")
      .click();

    await page.goto("/settings");
    await page.selectOption("#chatProvider", "OLLAMA");
    await page.locator("#chatModel").fill("test-model");
    await page
      .locator("#chatProvider")
      .locator("xpath=ancestor::form[1]")
      .locator("button[type=submit]")
      .click();

    await page.goto("/assistant");
    await page.locator("textarea").last().fill("Add a Netflix subscription for me");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Create contract: Netflix Subscription")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Created the contract successfully.")).toBeVisible();

    await page.goto("/contracts");
    await expect(page.getByText("Netflix Subscription").first()).toBeVisible();

    // Second round: propose again, this time cancel — no second contract.
    await page.goto("/assistant");
    await page.locator("textarea").last().fill("Add a Netflix subscription for me");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Cancelled")).toBeVisible();

    await page.goto("/contracts");
    await expect(page.locator("a", { hasText: "Netflix Subscription" })).toHaveCount(1);
  } finally {
    await mock.close();
  }
});
