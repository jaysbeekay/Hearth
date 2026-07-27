import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";

// Read-only MCP server for hooking up a local LLM agent (e.g. Ollama running
// a tool-calling model) to query contracts. Stateless: each request gets its
// own McpServer/transport pair (the SDK refuses to reuse a stateless
// transport across requests), and each call is authorized independently
// rather than via an MCP session, so there's no "initialize" handshake to
// carry between requests.
function checkAuth(request: NextRequest): NextResponse | null {
  const token = process.env.MCP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Set MCP_TOKEN to enable this endpoint" }, { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function handle(request: NextRequest) {
  const unauthorized = checkAuth(request);
  if (unauthorized) return unauthorized;

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
