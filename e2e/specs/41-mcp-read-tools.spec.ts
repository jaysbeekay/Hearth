import { test, expect, type APIRequestContext } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #394 — MCP's Contract tools and whats_due answer from the Due policy, and
// spend_summary matches the dashboard. /api/mcp is gated on MCP_TOKEN, set to
// "e2e-mcp-token" in playwright.config.ts.

test.use({ storageState: ADMIN_AUTH_FILE });

const MCP_HEADERS = {
  authorization: "Bearer e2e-mcp-token",
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};

let rpcId = 0;

async function mcp(request: APIRequestContext, method: string, params: Record<string, unknown> = {}) {
  rpcId += 1;
  const response = await request.post("/api/mcp", {
    headers: MCP_HEADERS,
    data: { jsonrpc: "2.0", id: rpcId, method, params },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.error).toBeUndefined();
  return body.result;
}

async function callTool(request: APIRequestContext, name: string, args: Record<string, unknown> = {}) {
  const result = await mcp(request, "tools/call", { name, arguments: args });
  return JSON.parse(result.content[0].text);
}

// UTC calendar arithmetic, so the day doesn't shift with the runner's zone.
function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The number in a formatted amount such as "A$1,234.56" or "AUD 1,234.56". */
function amountIn(text: string | null): number {
  return Number((text ?? "").replace(/[^\d.]/g, ""));
}

test("MCP is read-only and offers whats_due", async ({ request }) => {
  const { tools } = await mcp(request, "tools/list");
  const names: string[] = tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(expect.arrayContaining(["list_contracts", "get_contract", "upcoming_renewals", "spend_summary", "whats_due"]));
  expect(names.filter((n) => /propose|create|update|delete/.test(n))).toEqual([]);
});

test("a Contract's notice deadline drives upcoming_renewals and whats_due", async ({ page, request }) => {
  const title = `MCP Notice Contract ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("MCP Provider");
  await page.locator("#endDate").fill(isoInDays(40));
  await page.selectOption("#renewalType", "AUTO_RENEW");
  await page.locator("#noticePeriodDays").fill("30");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  // Its end date is 40 days off, beyond the default 30-day horizon; its
  // notice deadline, 30 days before that, is inside it.
  const upcoming = await callTool(request, "upcoming_renewals");
  const contract = upcoming.find((c: { id: string }) => c.id === id);
  expect(contract).toBeDefined();
  expect(contract.due[0]).toMatchObject({ field: "noticeDeadline", state: "due-soon" });
  expect(contract.due[0].label).toMatch(/^Cancel by /);
  expect(contract).not.toHaveProperty("daysUntilDeadline");

  const due = await callTool(request, "whats_due");
  expect(due).toContainEqual(expect.objectContaining({ kind: "contract", id, title, field: "noticeDeadline" }));

  const detail = await callTool(request, "get_contract", { id });
  expect(detail).toMatchObject({ id, title, state: "due-soon", documents: [] });
});

test("spend_summary gives the dashboard's and the Spending page's monthly figure", async ({ page, request }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`MCP Spend Contract ${Date.now()}`);
  await page.locator("#provider").fill("MCP Provider");
  await page.locator("#endDate").fill(isoInDays(200));
  await page.locator("#cost").fill("25");
  await page.selectOption("#billingFrequency", "MONTHLY");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  const summary = await callTool(request, "spend_summary");
  expect(summary.estimatedMonthlySpendTotal).toBeGreaterThanOrEqual(25);
  await page.goto("/dashboard");
  const text = await page.getByRole("link", { name: /^about .+ a month$/ }).textContent();
  expect(amountIn(text)).toBeCloseTo(summary.estimatedMonthlySpendTotal, 2);

  await page.goto("/spend");
  const monthly = page.getByText("Monthly recurring", { exact: true }).locator("xpath=following-sibling::p[1]");
  expect(amountIn(await monthly.textContent())).toBeCloseTo(summary.estimatedMonthlySpendTotal, 2);
});
