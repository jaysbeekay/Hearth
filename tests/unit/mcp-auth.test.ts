import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMcpAuth, parseMcpTokens } from "@/lib/mcp/auth";

describe("MCP token parsing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is empty when neither variable is set", () => {
    expect(parseMcpTokens({})).toEqual([]);
    expect(parseMcpTokens({ MCP_TOKEN: "  ", MCP_TOKENS: "" })).toEqual([]);
  });

  it("keeps MCP_TOKEN verbatim, colons and commas included", () => {
    expect(parseMcpTokens({ MCP_TOKEN: "a:b,c" })).toEqual([{ label: "default", token: "a:b,c" }]);
  });

  it("reads labelled MCP_TOKENS alongside MCP_TOKEN", () => {
    expect(parseMcpTokens({ MCP_TOKEN: "one", MCP_TOKENS: " claude-code:two , ollama:th=ree " })).toEqual([
      { label: "default", token: "one" },
      { label: "claude-code", token: "two" },
      { label: "ollama", token: "th=ree" },
    ]);
  });

  it("skips malformed MCP_TOKENS entries without echoing them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMcpTokens({ MCP_TOKENS: "nolabel,:secret,bad label:x,empty:,ok:tok" })).toEqual([
      { label: "ok", token: "tok" },
    ]);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret");
  });
});

describe("MCP authentication gate", () => {
  const tokens = [
    { label: "default", token: "secret" },
    { label: "ollama", token: "other-secret" },
  ];

  it("returns 404 when MCP is disabled", () => {
    expect(checkMcpAuth([], "Bearer anything")).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects missing and wrong bearer tokens", () => {
    expect(checkMcpAuth(tokens, null)).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth(tokens, "Bearer wrong")).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth(tokens, "secret")).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth(tokens, "Bearer secret ")).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts any configured token and names which one", () => {
    expect(checkMcpAuth(tokens, "Bearer secret")).toEqual({ ok: true, label: "default" });
    expect(checkMcpAuth(tokens, "Bearer other-secret")).toEqual({ ok: true, label: "ollama" });
  });
});

describe("MCP token labels", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps only the first token for a repeated label, including MCP_TOKEN's \"default\"", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMcpTokens({ MCP_TOKEN: "one", MCP_TOKENS: "default:two,a:three,a:four" })).toEqual([
      { label: "default", token: "one" },
      { label: "a", token: "three" },
    ]);
  });
});
