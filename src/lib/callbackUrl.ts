export const DEFAULT_SIGN_IN_DESTINATION = "/dashboard";

// A throwaway origin to resolve relative input against: anything that
// resolves to a different origin was trying to leave the app.
const PROBE_ORIGIN = "http://hearth.invalid";

/**
 * Turns a `callbackUrl` (from src/proxy.ts's redirect to /login) into a
 * same-origin path that's safe to redirect to after sign-in, or the
 * dashboard when it isn't (#341).
 *
 * Accepts a relative path ("/contracts/abc?x=1"). An absolute URL is only
 * accepted when its host matches `requestHost` — older /login links carried
 * the full URL — and is reduced to its path. Everything else (other hosts,
 * protocol-relative "//evil.example", backslash or control-character tricks
 * the URL parser normalises into another host, non-http schemes, a loop back
 * to /login) falls back to the dashboard, so this can never become an open
 * redirect.
 */
export function safeCallbackPath(raw: unknown, requestHost?: string | null): string {
  if (typeof raw !== "string") return DEFAULT_SIGN_IN_DESTINATION;
  const value = raw.trim();
  if (!value || value.length > 2048) return DEFAULT_SIGN_IN_DESTINATION;

  let url: URL;
  try {
    if (value.startsWith("/")) {
      url = new URL(value, PROBE_ORIGIN);
      if (url.origin !== PROBE_ORIGIN) return DEFAULT_SIGN_IN_DESTINATION;
    } else {
      url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_SIGN_IN_DESTINATION;
      if (!requestHost || url.host !== requestHost) return DEFAULT_SIGN_IN_DESTINATION;
    }
  } catch {
    return DEFAULT_SIGN_IN_DESTINATION;
  }

  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    return DEFAULT_SIGN_IN_DESTINATION;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
