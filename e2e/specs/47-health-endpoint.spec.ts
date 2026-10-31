import { test, expect } from "@playwright/test";

// GET /api/health (#477) is what PikaPods, Render and uptime monitors poll.
// It has to answer without a session, through the real proxy, and paths that
// merely start with "/api/health" must not ride along as public.

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("health endpoint", () => {
  test("answers 200 JSON to an unauthenticated request, without redirecting to /login", async ({
    request,
  }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("a look-alike path is not public: it redirects to /login", async ({ request }) => {
    const response = await request.get("/api/health-admin", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login");
  });
});
