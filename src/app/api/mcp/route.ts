import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { checkMcpAuth, configuredMcpTokens } from "@/lib/mcp/auth";
import {
  checkRateLimit,
  clientAddress,
  consumeRateLimit,
  recordFailedAttempt,
  RATE_LIMITS,
  type RateLimitResult,
} from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/securityEventLog";

// Read-only MCP server for hooking up an LLM agent (Claude Code/Desktop, or a
// local Ollama tool-calling model) to query household data. Stateless: each
// request gets its own McpServer/transport pair (the SDK refuses to reuse a
// stateless transport across requests), and each call is authorized
// independently rather than via an MCP session, so there's no "initialize"
// handshake to carry between requests.
//
// /api/mcp skips the session login (PUBLIC_PATHS), so the bearer token is the
// only gate. Failed tokens are throttled per client address and recorded in
// Settings → Security; authorized clients get a per-token request ceiling so
// a runaway agent can't hammer the database or the price feeds.

function tooMany(result: RateLimitResult) {
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

// One line per tool call in the server log, naming the token's label — the
// access log for "which client asked what". Arguments are left out: they can
// carry search terms about the household's records. Never throws: a body that
// isn't JSON (or any other logging fault) is left for the transport to reject,
// and must not fail the request it's only observing.
async function logToolCalls(request: NextRequest, label: string, address: string) {
  try {
    const body: unknown = await request.clone().json();
    for (const message of Array.isArray(body) ? body : [body]) {
      if (message && typeof message === "object" && (message as { method?: unknown }).method === "tools/call") {
        const name = (message as { params?: { name?: unknown } }).params?.name;
        // JSON-quoted: both come from the request, and a raw newline in
        // either could forge extra log lines.
        console.info(
          `[mcp] ${label} called ${JSON.stringify(typeof name === "string" ? name : "?")} from ${JSON.stringify(address)}`,
        );
      }
    }
  } catch (error) {
    // No JSON body (e.g. a GET) — nothing to log. Only the error's name is
    // logged: a parse error's message can quote the body.
    console.debug(`[mcp] tool-call log skipped (${error instanceof Error ? error.name : "unknown error"})`);
  }
}

// Security-log rows for auth failures are capped across all addresses
// (mcpAuthLog): a client rotating X-Forwarded-For on a proxy-less install
// could otherwise write a row per request and push real events off the
// Settings → Security list. Past the cap, one row says logging is paused.
async function logAuthFailure(type: "MCP_AUTH_FAILED" | "MCP_THROTTLED", address: string) {
  const budget = checkRateLimit("mcpAuthLog", "all");
  if (!budget.allowed) return;
  consumeRateLimit("mcpAuthLog", "all");
  if (checkRateLimit("mcpAuthLog", "all").allowed) {
    await logSecurityEvent({ type, address, detail: address });
  } else {
    await logSecurityEvent({
      type: "MCP_THROTTLED",
      address,
      detail: `${address}; too many MCP auth failures, logging paused for up to ${Math.ceil(RATE_LIMITS.mcpAuthLog.windowMs / 60_000)} minutes`,
    });
  }
}

async function handle(request: NextRequest) {
  const tokens = configuredMcpTokens();
  const address = clientAddress(request.headers);

  if (tokens.length > 0) {
    const throttle = checkRateLimit("mcpAuth", address);
    if (!throttle.allowed) return tooMany(throttle);
  }

  const result = checkMcpAuth(tokens, request.headers.get("authorization"));
  if (!result.ok) {
    if (result.status === 401) {
      recordFailedAttempt("mcpAuth", address);
      await logAuthFailure("MCP_AUTH_FAILED", address);
      // Record the lockout once, when this failure crosses the limit, rather
      // than once per throttled request.
      if (!checkRateLimit("mcpAuth", address).allowed) await logAuthFailure("MCP_THROTTLED", address);
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const usage = consumeRateLimit("mcpRequests", result.label);
  if (!usage.allowed) return tooMany(usage);

  await logToolCalls(request, result.label, address);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await (await createMcpServer()).connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
