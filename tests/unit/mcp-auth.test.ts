import { describe, expect, it } from "vitest";
import { checkMcpAuth } from "@/lib/mcp/auth";

describe("MCP authentication gate", () => {
  it("returns 404 when MCP is disabled", () => {
    expect(checkMcpAuth(undefined, "Bearer anything")).toEqual({ ok: false, status: 404, error: "Set MCP_TOKEN to enable this endpoint" });
  });

  it("rejects missing and wrong bearer tokens", () => {
    expect(checkMcpAuth("secret", null)).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth("secret", "Bearer wrong")).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the configured bearer token", () => {
    expect(checkMcpAuth("secret", "Bearer secret")).toEqual({ ok: true });
  });
});
