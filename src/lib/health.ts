// Liveness/readiness check behind GET /api/health (#477).
//
// Managed hosts (PikaPods, a Docker HEALTHCHECK, an uptime monitor) need an
// unauthenticated URL that says whether the app can serve requests. "Up"
// here means the server answers AND the database answers a trivial query —
// a process that is running but can't open its SQLite file is not healthy.
//
// The response is deliberately minimal: no version, no error text, no
// configuration. The endpoint is public, and anything it returned would be
// readable by anyone who can reach the server.

export type HealthResult = {
  httpStatus: 200 | 503;
  body: { status: "ok" | "unavailable" };
};

export async function checkHealth(pingDatabase: () => Promise<unknown>): Promise<HealthResult> {
  try {
    await pingDatabase();
    return { httpStatus: 200, body: { status: "ok" } };
  } catch (error) {
    // Logged server-side only; the caller just gets "unavailable".
    console.error("[health] database check failed:", error);
    return { httpStatus: 503, body: { status: "unavailable" } };
  }
}
