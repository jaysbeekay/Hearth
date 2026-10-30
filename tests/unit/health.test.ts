import { describe, expect, it, vi } from "vitest";
import { setupTestDb } from "../helpers/testDb";
import { checkHealth } from "@/lib/health";
import { isPublicPath } from "@/lib/auth.config";
import { GET } from "@/app/api/health/route";

// GET /api/health (#477): a public check that the server and its database
// answer, for managed hosts such as PikaPods and for uptime monitors.

setupTestDb();

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    await expect(checkHealth(async () => 1)).resolves.toEqual({
      httpStatus: 200,
      body: { status: "ok" },
    });
  });

  it("reports unavailable, without the error text, when the database fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await checkHealth(async () => {
      throw new Error("SQLITE_CANTOPEN: /app/data/app.db");
    });
    expect(result).toEqual({ httpStatus: 503, body: { status: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("SQLITE");
    consoleError.mockRestore();
  });
});

describe("/api/health route", () => {
  it("is reachable without a session", () => {
    expect(isPublicPath("/api/health")).toBe(true);
  });

  it("answers 200 ok against a real database, uncached", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
