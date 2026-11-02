import { createHash, timingSafeEqual } from "crypto";

// Bearer-token gate for /api/mcp. Two sources, both optional:
//   MCP_TOKEN  — one token, used verbatim (label "default"). Unchanged from
//                before, so existing deployments keep working.
//   MCP_TOKENS — several named tokens, "label:token,label:token", so each
//                client (Claude Code, an Ollama agent, …) gets its own token
//                that can be revoked or rotated without cutting off the rest,
//                and the access log can say which client made a call.
// The endpoint is enabled when either yields at least one token.

export interface McpToken {
  label: string;
  token: string;
}

export type McpAuthResult =
  | { ok: true; label: string }
  | { ok: false; status: 401 | 404; error: string };

const LABEL = /^[A-Za-z0-9_-]{1,40}$/;

export function parseMcpTokens(env: { MCP_TOKEN?: string; MCP_TOKENS?: string }): McpToken[] {
  const tokens: McpToken[] = [];
  const single = env.MCP_TOKEN?.trim();
  if (single) tokens.push({ label: "default", token: single });

  for (const entry of (env.MCP_TOKENS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const label = trimmed.slice(0, separator).trim();
    const token = trimmed.slice(separator + 1).trim();
    if (separator <= 0 || !LABEL.test(label) || !token) {
      // Never echo the entry: it may hold a token.
      console.warn("[mcp] ignoring a malformed MCP_TOKENS entry (expected label:token)");
      continue;
    }
    tokens.push({ label, token });
  }
  return tokens;
}

// Hashing first gives both sides the same length, which timingSafeEqual
// requires, without leaking the configured token's length.
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function checkMcpAuth(tokens: McpToken[], authorization: string | null): McpAuthResult {
  if (tokens.length === 0) {
    return { ok: false, status: 404, error: "Set MCP_TOKEN or MCP_TOKENS to enable this endpoint" };
  }
  const presented = digest(authorization ?? "");
  let matched: string | null = null;
  // Compare against every token, with no early exit, so the response time
  // doesn't depend on which (if any) token matched.
  for (const { label, token } of tokens) {
    if (timingSafeEqual(presented, digest(`Bearer ${token}`)) && matched === null) matched = label;
  }
  if (matched === null) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true, label: matched };
}
