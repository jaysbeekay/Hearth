import { describe, expect, it } from "vitest";
import { configuredAppUrl, resolveAppUrl } from "@/lib/env";

// APP_URL resolution (#477): an empty APP_URL is unset, and on Render the
// service's own RENDER_EXTERNAL_URL fills in when APP_URL isn't given.

describe("resolveAppUrl", () => {
  it("uses APP_URL when set", () => {
    expect(resolveAppUrl({ APP_URL: "https://hearth.example.com" })).toBe("https://hearth.example.com");
  });

  it("prefers APP_URL over RENDER_EXTERNAL_URL", () => {
    expect(
      resolveAppUrl({ APP_URL: "https://hearth.example.com", RENDER_EXTERNAL_URL: "https://hearth-abcd.onrender.com" }),
    ).toBe("https://hearth.example.com");
  });

  it("falls back to RENDER_EXTERNAL_URL when APP_URL is unset", () => {
    expect(resolveAppUrl({ RENDER_EXTERNAL_URL: "https://hearth-abcd.onrender.com" })).toBe(
      "https://hearth-abcd.onrender.com",
    );
  });

  it("treats an empty or blank APP_URL as unset", () => {
    expect(resolveAppUrl({ APP_URL: "", RENDER_EXTERNAL_URL: "https://hearth-abcd.onrender.com" })).toBe(
      "https://hearth-abcd.onrender.com",
    );
    expect(resolveAppUrl({ APP_URL: "   " })).toBe("http://localhost:3000");
    expect(resolveAppUrl({ APP_URL: "" })).toBe("http://localhost:3000");
  });

  it("defaults to localhost when nothing is set", () => {
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("configuredAppUrl", () => {
  it("is empty unless a real URL was configured", () => {
    expect(configuredAppUrl({})).toBe("");
    expect(configuredAppUrl({ APP_URL: "" })).toBe("");
    expect(configuredAppUrl({ RENDER_EXTERNAL_URL: "https://hearth-abcd.onrender.com" })).toBe(
      "https://hearth-abcd.onrender.com",
    );
  });
});
