import { createHash, timingSafeEqual } from "crypto";

// Bearer-token gate for /api/mcp. Two sources, both optional:
//   MCP_TOKEN  — one token (label "default"), with surrounding whitespace
//                trimmed so a stray newline in .env doesn't lock clients out.
//                Unchanged from before, so existing deployments keep working.
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
    // A label is the client's identity in the access log and its request
    // budget, so two tokens can't share one ("default" is MCP_TOKEN's). Nor
    // can two labels share a token: removing one entry wouldn't revoke it.
    if (tokens.some((existing) => existing.label === label)) {
      console.warn(`[mcp] ignoring a second MCP_TOKENS entry labelled "${label}"; labels must be unique`);
      continue;
    }
    if (tokens.some((existing) => existing.token === token)) {
      console.warn(`[mcp] ignoring MCP_TOKENS entry "${label}": its token is already in use; tokens must be unique`);
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

/**
 * MCP_IMPORT_LABELS: comma-separated token labels granted the import scope
 * (#529) — "default" for MCP_TOKEN, or a label from MCP_TOKENS. Unset means
 * every token stays read-only.
 */
export function parseImportLabels(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter((label) => LABEL.test(label)),
  );
}

let cached: { key: string; tokens: McpToken[] } | null = null;

/**
 * parseMcpTokens over the live environment, re-parsed only when the values
 * change, so a malformed entry warns once rather than on every request.
 */
export function configuredMcpTokens(
  env: { MCP_TOKEN?: string; MCP_TOKENS?: string } = { MCP_TOKEN: process.env.MCP_TOKEN, MCP_TOKENS: process.env.MCP_TOKENS },
): McpToken[] {
  const key = JSON.stringify([env.MCP_TOKEN ?? null, env.MCP_TOKENS ?? null]);
  if (cached?.key !== key) cached = { key, tokens: parseMcpTokens(env) };
  return cached.tokens;
}
