import type { NextRequest } from "next/server";

/**
 * True when the request carries an Origin header naming a different host
 * than the one it was actually sent to. Next.js's Server Actions (the app's
 * primary write path per CLAUDE.md) already enforce the equivalent check
 * automatically; this covers the REST route handlers that sit outside that
 * mechanism and authenticate with a session cookie instead of a bearer
 * token — src/proxy.ts applies it centrally to state-changing requests
 * under /api/*.
 *
 * Compared against the request's own Host header (falling back to
 * X-Forwarded-Host) rather than env.appUrl, so this keeps working
 * regardless of whether APP_URL is configured or how a reverse proxy
 * terminates TLS in front of the app.
 *
 * Only acts when Origin is present and wrong: browsers always send it on a
 * cross-site state-changing request (the case this exists to catch), and
 * always send a matching one on a same-origin request. A request with no
 * Origin at all is left to the session cookie's own SameSite=Lax
 * protection rather than rejected outright — some non-browser clients never
 * send it, and CSRF is fundamentally a browser-credential problem.
 */
export function hasMismatchedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
