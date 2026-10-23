import { describe, expect, it } from "vitest";
import { DEFAULT_SIGN_IN_DESTINATION, safeCallbackPath } from "@/lib/callbackUrl";

describe("safeCallbackPath (#341)", () => {
  it("keeps a same-origin relative path, including query and hash", () => {
    expect(safeCallbackPath("/contracts/abc?tab=docs#documents")).toBe(
      "/contracts/abc?tab=docs#documents",
    );
  });

  it("reduces an absolute URL on the request's own host to its path", () => {
    expect(safeCallbackPath("http://hearth.local:3000/products/1", "hearth.local:3000")).toBe(
      "/products/1",
    );
  });

  it("rejects an absolute URL when there is no request host to compare against", () => {
    expect(safeCallbackPath("http://hearth.local/x")).toBe(DEFAULT_SIGN_IN_DESTINATION);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-string", 42],
    ["absolute URL on another host", "https://evil.example/contracts"],
    ["protocol-relative URL", "//evil.example/path"],
    ["backslash host trick", "/\\evil.example"],
    ["tab-smuggled host", "/\t/evil.example"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["loop back to the login page", "/login?callbackUrl=%2Fcontracts"],
    ["overlong value", `/${"a".repeat(3000)}`],
  ])("falls back to the dashboard for %s", (_label, value) => {
    expect(safeCallbackPath(value, "hearth.local")).toBe(DEFAULT_SIGN_IN_DESTINATION);
  });
});
