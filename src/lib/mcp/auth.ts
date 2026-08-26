export type McpAuthResult = { ok: true } | { ok: false; status: 401 | 404; error: string };

export function checkMcpAuth(configuredToken: string | undefined, authorization: string | null): McpAuthResult {
  if (!configuredToken) return { ok: false, status: 404, error: "Set MCP_TOKEN to enable this endpoint" };
  if (authorization !== `Bearer ${configuredToken}`) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}
