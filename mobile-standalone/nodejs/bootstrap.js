// Entry point for the embedded Node.js runtime (@capawesome/capacitor-nodejs).
// This is the "main" file the plugin loads on app launch. Its job: get a
// writable on-device directory from the plugin's bridge, point the app's
// existing server bundle at a local DB file inside it, then run that server
// bundle in-process (the plugin does not support spawning child processes,
// so this requires() the standalone Next.js server rather than `node
// server.js`-ing it as a separate process).
//
// UNVERIFIED — this is Phase 0 spike code, not production-ready. See
// mobile-standalone/README.md for the concrete list of what needs local
// device testing before any of this can be trusted.
"use strict";

const path = require("path");
const fs = require("fs");
const { channel, app: bridgeApp } = require("bridge");

const PORT = 4173;

async function main() {
  const dataDir = bridgeApp.datadir();
  const dbPath = path.join(dataDir, "hearth-standalone.db");
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Mirrors src/lib/env.ts's "optional feature gated on env var presence"
  // pattern — anything not set here (SMTP, S3/SFTP, MCP_TOKEN, CRON_SECRET,
  // OAuth client IDs) simply stays disabled, which is exactly the standalone
  // feature-reduction agreed in #148's plan (no MCP, no webhooks-to-nowhere,
  // no OAuth needing a public callback URL).
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.APP_URL = `http://127.0.0.1:${PORT}`;
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NEXTAUTH_URL = process.env.APP_URL;

  // AUTH_SECRET / ENCRYPTION_KEY must be generated once and persisted across
  // launches (Keychain/Keystore in the real Phase 1 build) — NOT regenerated
  // per launch, or every existing session/encrypted value breaks on restart.
  // Stubbed here with a plaintext on-device file purely so the spike can run
  // at all; this is explicitly called out as unsafe for anything beyond a
  // local PoC in README.md.
  const secretsPath = path.join(dataDir, "standalone-secrets.json");
  let secrets;
  if (fs.existsSync(secretsPath)) {
    secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  } else {
    secrets = {
      authSecret: require("crypto").randomBytes(32).toString("base64"),
      encryptionKey: require("crypto").randomBytes(32).toString("base64"),
    };
    fs.writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
  }
  process.env.AUTH_SECRET = secrets.authSecret;
  process.env.ENCRYPTION_KEY = secrets.encryptionKey;
  process.env.AUTH_TRUST_HOST = "true";

  channel.post("standalone-status", { state: "starting", port: PORT });

  try {
    // `next build --webpack` with output:"standalone" produces a self-
    // contained server.js designed to be run as the process entry point
    // (`node server.js`). Requiring it here instead of spawning it is the
    // only option under this plugin's constraints (no child_process) —
    // UNVERIFIED whether Next's standalone server.js tolerates being
    // require()'d rather than run as main; its top-level code creates an
    // http.Server and calls .listen(), which should behave the same either
    // way, but this needs confirming against a real build, not assumed.
    require("./server-bundle/server.js");

    channel.post("standalone-status", { state: "ready", port: PORT, url: process.env.APP_URL });
  } catch (err) {
    channel.post("standalone-status", {
      state: "error",
      message: err && err.stack ? err.stack : String(err),
    });
  }
}

// Runs once, immediately, when the plugin loads this file (automatic start
// mode — see capacitor.config.ts). The native side listens for
// "standalone-status" messages via Nodejs.addListener("message", ...) to
// know when it's safe to navigate the WebView to APP_URL.
main().catch((err) => {
  channel.post("standalone-status", { state: "error", message: String(err) });
});
