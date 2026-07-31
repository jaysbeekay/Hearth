import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, isPublicPath } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

// CSP is nonce-based: Next reads the nonce back off the request's own
// content-security-policy header when rendering, so its bootstrap and flight
// scripts carry it, and 'strict-dynamic' lets those load the rest of the
// bundle. Script injected by an attacker has no nonce and no way to get one.
//
// The exceptions worth naming:
//  - style-src 'unsafe-inline': Leaflet and Next both write inline style
//    attributes, for which there is no nonce path.
//  - img-src blob:/data:: document thumbnails and camera captures render from
//    object URLs before upload.
//  - img-src cartocdn: PropertyMap's basemap tiles (see PropertyMap.tsx).
//  - 'unsafe-eval' in development only, for the webpack dev runtime.
function buildCsp(nonce: string, { isDev, isHttps }: { isDev: boolean; isHttps: boolean }) {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
    "font-src 'self' data:",
    // Every outbound integration — AI providers, ntfy, webhooks, geocoding — is
    // called server-side, so the browser only ever talks to its own origin.
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only meaningful once TLS is already in play. On a plain-HTTP LAN
    // deployment this would rewrite every request to a port that isn't
    // listening.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function requestIsHttps(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";
  return request.nextUrl.protocol === "https:";
}

function withSecurityHeaders(response: NextResponse, csp: string, isHttps: boolean) {
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set(
    "permissions-policy",
    "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()",
  );

  // HSTS is only safe once the response actually arrived over TLS — sending it
  // from a plain-HTTP deployment would pin browsers to an endpoint that isn't
  // there. No `preload`: that's a one-way, hard-to-undo commitment to make on
  // behalf of someone else's self-hosted domain.
  if (isHttps) {
    response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  }

  return response;
}

// A handler is supplied here purely so security headers can be attached to
// every response. That has a catch: when NextAuth is given a handler it stops
// acting on its own `authorized` callback (see next-auth/lib/index.js — the
// `!authorized` redirect branch is only reached when no handler exists), so
// the unauthenticated redirect has to be made explicitly below. Dropping it
// would leave every authenticated page reachable without a session.
export default auth((request) => {
  const isDev = process.env.NODE_ENV !== "production";
  const isHttps = requestIsHttps(request);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, { isDev, isHttps });

  if (!isPublicPath(request.nextUrl.pathname) && !request.auth?.user) {
    // Built from scratch rather than cloning the request URL: cloning carried
    // the original query string onto /login, so a request to a token-bearing
    // URL echoed that token into the login page's address, its history entry
    // and anything logging URLs. Only callbackUrl is carried across.
    const signInUrl = new URL("/login", request.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.href);
    return withSecurityHeaders(NextResponse.redirect(signInUrl), csp, isHttps);
  }

  // Passing headers through `request` is what makes the nonce visible to the
  // renderer; setting CSP on the response alone would leave Next's own inline
  // scripts unnonced, and therefore blocked.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
    isHttps,
  );
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icons).*)",
  ],
};
