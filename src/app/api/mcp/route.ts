import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { checkMcpAuth, configuredMcpTokens, parseImportLabels } from "@/lib/mcp/auth";
import {
  checkRateLimit,
  clientAddress,
  consumeRateLimit,
  recordFailedAttempt,
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
  } catch {
    // No JSON body (e.g. a GET) — nothing to log. The parse error's message
    // can quote the body, so it stays out of the log.
    console.debug("[mcp] tool-call log skipped: body is not JSON");
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
      await logSecurityEvent({ type: "MCP_AUTH_FAILED", address, detail: address });
      // Record the lockout once, when this failure crosses the limit, rather
      // than once per throttled request — bounded however hard it's hammered.
      if (!checkRateLimit("mcpAuth", address).allowed) {
        await logSecurityEvent({ type: "MCP_THROTTLED", address, detail: address });
      }
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
  const canImport = parseImportLabels(process.env.MCP_IMPORT_LABELS).has(result.label);
  await (await createMcpServer({ importLabel: canImport ? result.label : undefined })).connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
