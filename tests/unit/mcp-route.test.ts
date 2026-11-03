// The /api/mcp route handler itself (#528 review): the auth gate's
// throttling, Retry-After, per-token budgets, the disabled endpoint, and the
// security log, exercised through the real handler rather than its helpers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb } from "../helpers/testDb";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/mcp/route";
import { RATE_LIMITS, __clearAllRateLimits } from "@/lib/rateLimit";

setupTestDb();

const LIST_TOOLS = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

function request(token: string | null, address = "203.0.113.7") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-forwarded-for": address,
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/mcp", { method: "POST", headers, body: LIST_TOOLS });
}

const AUTH_LIMIT = RATE_LIMITS.mcpAuth.limit;

beforeEach(() => {
  __clearAllRateLimits();
  vi.stubEnv("MCP_TOKEN", "");
  vi.stubEnv("MCP_TOKENS", "claude-code:token-a,ollama:token-b");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/mcp", () => {
  it("404s when no token is configured, without counting or logging anything", async () => {
    vi.stubEnv("MCP_TOKENS", "");
    for (let i = 0; i < AUTH_LIMIT + 2; i += 1) {
      expect((await POST(request("anything"))).status).toBe(404);
    }
    expect(await prisma.securityEventLog.count()).toBe(0);
  });

  it("quotes request-supplied values in the access log, so they can't forge lines", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "whats_due\n[mcp] admin called everything", arguments: {} },
    });
    await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "x-forwarded-for": "203.0.113.7",
          authorization: "Bearer token-a",
        },
        body,
      }),
    );
    const line = info.mock.calls.map((call) => String(call[0])).find((l) => l.startsWith("[mcp] claude-code called"));
    expect(line).toBe('[mcp] claude-code called "whats_due\\n[mcp] admin called everything" from "203.0.113.7"');
    expect(line).not.toContain("\n");
  });

  it("answers a valid token", async () => {
    const response = await POST(request("token-a"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it(`throttles an address after ${AUTH_LIMIT} wrong tokens, with Retry-After, and logs the lockout once`, async () => {
    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      expect((await POST(request("wrong"))).status).toBe(401);
    }
    const blocked = await POST(request("wrong"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    // A further hammering adds no more rows.
    await POST(request("wrong"));
    const events = await prisma.securityEventLog.groupBy({ by: ["type"], _count: true });
    expect(Object.fromEntries(events.map((e) => [e.type, e._count]))).toEqual({
      MCP_AUTH_FAILED: AUTH_LIMIT,
      MCP_THROTTLED: 1,
    });
  });

  it("caps security-log rows when wrong tokens arrive from rotating addresses", async () => {
    // No proxy: a client sets its own X-Forwarded-For per request.
    for (let i = 0; i < 100; i += 1) {
      expect((await POST(request("wrong", `198.51.100.${i}`))).status).toBe(401);
    }
    const cap = RATE_LIMITS.mcpAuthLog.limit;
    expect(await prisma.securityEventLog.count()).toBe(cap);
    expect(await prisma.securityEventLog.count({ where: { detail: { contains: "logging paused" } } })).toBe(1);
  });

  it("also blocks a valid token from a locked-out address (documented trade-off), but not from another address", async () => {
    for (let i = 0; i < AUTH_LIMIT; i += 1) await POST(request("wrong"));
    expect((await POST(request("token-a"))).status).toBe(429);
    expect((await POST(request("token-a", "198.51.100.9"))).status).toBe(200);
  });

  it("gives each token its own request budget", async () => {
    const budget = RATE_LIMITS.mcpRequests.limit;
    for (let i = 0; i < budget; i += 1) {
      expect((await POST(request("token-a"))).status).toBe(200);
    }
    const over = await POST(request("token-a"));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await POST(request("token-b"))).status).toBe(200);
  }, 60_000);

  it("still answers 401 when the security log can't be written", async () => {
    const create = vi.spyOn(prisma.securityEventLog, "create").mockRejectedValue(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(create).toHaveBeenCalled();
  });
});
