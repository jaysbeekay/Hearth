// Liveness/readiness check behind GET /api/health (#477).
//
// Managed hosts (PikaPods, Render), compose healthchecks and uptime monitors
// need an unauthenticated URL that says whether the app can serve requests.
// "Up" means the server answers AND the database file can be read. A
// process that is running but can't read its SQLite file is not healthy, so
// the probe reads the schema version from the file's header rather than
// running `SELECT 1`, which SQLite answers without touching the file.
//
// The response is deliberately minimal: no version, no error text, no
// configuration. The endpoint is public, and anything it returned would be
// readable by anyone who can reach the server.

export type HealthResult = {
  httpStatus: 200 | 503;
  body: { status: "ok" | "unavailable" };
};

type RawQueryClient = {
  $queryRaw: (query: TemplateStringsArray) => PromiseLike<unknown>;
};

/** A query that has to read the database file itself. */
export function probeDatabase(client: RawQueryClient): PromiseLike<unknown> {
  return client.$queryRaw`PRAGMA schema_version`;
}

export async function checkHealth(pingDatabase: () => PromiseLike<unknown>): Promise<HealthResult> {
  try {
    await pingDatabase();
    return { httpStatus: 200, body: { status: "ok" } };
  } catch (error) {
    // Logged server-side only; the caller just gets "unavailable".
    console.error("[health] database check failed:", error);
    return { httpStatus: 503, body: { status: "unavailable" } };
  }
}

// A public endpoint that queries the database on every hit is a cheap way to
// load the server, and the libSQL adapter serialises queries in-process. One
// probe per few seconds is plenty for any health checker.
export const HEALTH_CACHE_MS = 5000;

let cached: { at: number; result: Promise<HealthResult> } | null = null;

export function cachedHealth(
  pingDatabase: () => PromiseLike<unknown>,
  now: number = Date.now(),
): Promise<HealthResult> {
  if (cached && now - cached.at < HEALTH_CACHE_MS) return cached.result;
  const result = checkHealth(pingDatabase);
  cached = { at: now, result };
  return result;
}

export function resetHealthCacheForTests(): void {
  cached = null;
}
