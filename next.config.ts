import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "standalone",
  // ssh2 (used by the SFTP backup destination) ships a non-ESM asset that
  // Turbopack can't bundle into server chunks — load it natively instead.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
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
