import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

// The account menu's "Version" row: package.json's version, bumped on every
// release, and the commit the build came from. Docker builds have no .git
// (.dockerignore), so the publish workflow passes the commit in as the
// GIT_SHA build arg; elsewhere git is asked, and a build with neither just
// shows the version.
function buildCommit(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_COMMIT: buildCommit(),
  },
  output: "standalone",
  // The dev-mode build indicator (bottom-left badge) has no purpose in a
  // household-admin UI and previously leaked into published screenshots,
  // overlapping the sidebar account email (#178).
  devIndicators: false,
  // Stop `next dev` from writing a managed AGENTS.md into the repo root on
  // every run; agent instructions live in CLAUDE.md, maintained by hand.
  agentRules: false,
  // ssh2 (used by the SFTP backup destination) ships a non-ESM asset that
  // Turbopack can't bundle into server chunks — load it natively instead.
  // pdfkit reads its standard-font metrics (js/data/*.afm) from disk next to
  // its own source; bundled into a server chunk those files are left behind
  // and every PDF export 500s with ENOENT Helvetica.afm (#523).
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "yahoo-finance2", "pdfkit"],
  // libsql picks its native binding with a computed require, so the
  // standalone trace can't see which one the runtime will load: it picked up
  // the glibc build and missed the musl one the Alpine image actually needs
  // (#518). Include every musl binding that was installed for this platform.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@libsql/linux-*-musl/**/*"],
  },
  experimental: {
    // Document/photo uploads go through Server Actions and are validated
    // against MAX_UPLOAD_BYTES (15MB) in application code. Next's own
    // default body limits (1MB for Server Actions, 10MB for the proxy in
    // front of them) are well under that, so without raising both here
    // every upload over 1MB hard-crashes before the app's own
    // "file too large" check ever runs.
    serverActions: {
      bodySizeLimit: "20mb",
    },
    proxyClientMaxBodySize: "20mb",
  },
};

export default withSerwist(nextConfig);
