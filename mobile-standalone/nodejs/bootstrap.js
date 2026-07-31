// Entry point for the embedded Node.js runtime (@capawesome/capacitor-nodejs).
// This is the "main" file the plugin loads once native code calls
// Nodejs.start() (manual start mode — see capacitor.config.ts). Its job: get
// a writable on-device directory from the plugin's bridge, apply any
// unapplied Prisma migrations directly (no `prisma migrate deploy` CLI —
// the plugin doesn't support child_process), then require() the app's
// standalone Next.js server bundle in-process and wait for it to actually
// accept connections before telling the native side it's safe to navigate.
//
// UNVERIFIED — this is Phase 0 spike code, not production-ready. See
// mobile-standalone/README.md for the concrete list of what needs local
// device testing before any of this can be trusted.
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { channel, app: bridgeApp } = require("bridge");

// NOTE for whoever wires up the native side next: the plugin has its own
// built-in "ready" event (Nodejs.addListener("ready", ...) / isReady()),
// documented as firing as soon as this file has required "bridge" — i.e.
// almost immediately, long before DATABASE_URL/ENCRYPTION_KEY are set or
// migrations have run. That is NOT the signal to navigate the WebView on.
// The signal to use is this file's own "standalone-status" channel message
// below, specifically { state: "ready" } — only posted once migrations
// have applied and the server has actually confirmed it's accepting
// connections.

const PORT = 4173;
// Bind address Next's server actually listens on — an IP literal, so it
// doesn't depend on DNS/hosts-file resolution inside the runtime.
const BIND_HOST = "127.0.0.1";
// Hostname used for APP_URL/NEXTAUTH_URL and therefore the WebAuthn
// relying-party ID (src/lib/auth.ts derives expectedRPID from
// `new URL(env.appUrl).hostname`). This must be "localhost", not an IP
// literal — the WebAuthn spec requires the RP ID to be a valid domain
// string, and most client implementations reject bare IP addresses.
// "localhost" resolves to BIND_HOST on-device via the system resolver, so
// the WebView can still reach the server bound above.
const PUBLIC_HOST = "localhost";

function postStatus(payload) {
  channel.post("standalone-status", payload);
}

function postError(context, err) {
  postStatus({
    state: "error",
    context,
    message: err && err.stack ? err.stack : String(err),
  });
}

// Applies any Prisma migration under `migrationsDir` not yet recorded in a
// tracking table, using @libsql/client-wasm directly (not Prisma's own
// migrate engine, which is itself a native binary with the same
// Android/iOS ABI problem this whole build works around for the main DB
// client — see README.md risk #1). Deliberately named `_standalone_migrations`
// rather than Prisma's own `_prisma_migrations` so this on-device DB is
// never mistaken for one `prisma migrate` itself has touched.
async function applyMigrations(dbPath, migrationsDir) {
  const { createClient } = require("@libsql/client-wasm");
  const client = createClient({ url: `file:${dbPath}` });
  try {
    await client.execute(
      "CREATE TABLE IF NOT EXISTS _standalone_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const { rows } = await client.execute("SELECT name FROM _standalone_migrations");
    const applied = new Set(rows.map((row) => row.name));

    const migrationDirs = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const dir of migrationDirs) {
      if (applied.has(dir)) continue;
      const sqlPath = path.join(migrationsDir, dir, "migration.sql");
      const sql = fs.readFileSync(sqlPath, "utf8");
      await client.executeMultiple(sql);
      await client.execute({
        sql: "INSERT INTO _standalone_migrations (name, applied_at) VALUES (?, ?)",
        args: [dir, new Date().toISOString()],
      });
    }
  } finally {
    client.close();
  }
}

// Reads or generates AUTH_SECRET/ENCRYPTION_KEY, self-healing on a missing
// OR corrupt/truncated file (the app process getting killed mid-write on a
// previous launch is a realistic mobile scenario). NOTE: self-healing means
// a corrupt file is treated the same as a missing one and a *new* key pair
// is generated — any data encrypted under the old, now-unrecoverable key
// (TOTP secrets, previously-taken backups) becomes permanently
// undecryptable. Acceptable for a Phase 0 PoC; Phase 1 needs this backed by
// iOS Keychain / Android Keystore, which don't have this failure mode.
function getOrCreateSecrets(secretsPath) {
  try {
    return JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  } catch {
    const secrets = {
      authSecret: crypto.randomBytes(32).toString("base64"),
      encryptionKey: crypto.randomBytes(32).toString("base64"),
    };
    fs.writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

// require("./server-bundle/server.js") returns as soon as that file's
// top-level code finishes running — but it only *calls* Next's async
// startServer(...), it doesn't await it, so the HTTP listener may not be
// bound yet when require() returns. Polling here (rather than trusting
// require()'s return) is what actually confirms the server is reachable
// before telling the native side it's safe to navigate the WebView, and
// also detects the failure case where startServer() never binds at all
// (its own rejection handler calls process.exit(1) directly, bypassing
// this file's try/catch entirely — polling-with-timeout is the only way
// this file can detect that failure mode too).
function waitForServer(url, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url} to accept connections`));
        } else {
          setTimeout(attempt, intervalMs);
        }
      });
    };
    attempt();
  });
}

async function main() {
  const dataDir = bridgeApp.datadir();
  const dbPath = path.join(dataDir, "hearth-standalone.db");
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const appUrl = `http://${PUBLIC_HOST}:${PORT}`;

  // Mirrors src/lib/env.ts's "optional feature gated on env var presence"
  // pattern — anything not set here (SMTP, S3/SFTP, MCP_TOKEN, CRON_SECRET,
  // OAuth client IDs) simply stays disabled, which is exactly the standalone
  // feature-reduction agreed in #148's plan (no MCP, no webhooks-to-nowhere,
  // no OAuth needing a public callback URL).
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.APP_URL = appUrl;
  process.env.NEXTAUTH_URL = appUrl;
  process.env.PORT = PORT;
  process.env.HOSTNAME = BIND_HOST;

  const secrets = getOrCreateSecrets(path.join(dataDir, "standalone-secrets.json"));
  process.env.AUTH_SECRET = secrets.authSecret;
  process.env.ENCRYPTION_KEY = secrets.encryptionKey;

  postStatus({ state: "starting", url: appUrl });

  try {
    await applyMigrations(dbPath, path.join(__dirname, "server-bundle", "prisma", "migrations"));
  } catch (err) {
    postError("migrations", err);
    return;
  }

  try {
    require("./server-bundle/server.js");
  } catch (err) {
    postError("server-require", err);
    return;
  }

  try {
    await waitForServer(appUrl);
  } catch (err) {
    postError("server-startup", err);
    return;
  }

  postStatus({ state: "ready", url: appUrl });
}

main().catch((err) => postError("unhandled", err));
