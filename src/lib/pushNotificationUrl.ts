// #375 — where tapping a Web Push notification goes. Used by the service
// worker (src/sw.ts); kept separate so it can be tested.

const FALLBACK = "/dashboard";

/**
 * The page to open for a notification's `url`, always on this app's own
 * origin: anything else (another site, `javascript:`, `//evil.example`, junk
 * that won't parse) opens the dashboard instead.
 */
export function notificationTarget(rawUrl: unknown, origin: string): string {
  const fallback = new URL(FALLBACK, origin).href;
  if (typeof rawUrl !== "string" || rawUrl === "") return fallback;
  try {
    const target = new URL(rawUrl, origin);
    return target.origin === origin ? target.href : fallback;
  } catch {
    return fallback;
  }
}
