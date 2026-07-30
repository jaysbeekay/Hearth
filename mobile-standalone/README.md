# Standalone-mode spike (#148, Phase 0)

**Status: unverified scaffolding, not a working feature.** This is Phase 0 of
the plan on [#148](https://github.com/jaysbeekay/Hearth/issues/148) — a
feasibility spike, not production code. Nothing here is wired into the app's
actual sign-in flow yet (see "Not done" below). Expect to debug this by hand
on a real device; it was written without the ability to build or run an
Android/iOS project in the environment that produced it.

## ⚠️ Confirmed blocker, found after this scaffolding was first written

**`@capawesome/capacitor-nodejs` currently bundles Node.js 18.20.4. This
app's `next` package requires Node `>=20.9.0`.** Confirmed directly from the
plugin's own README FAQ ("The plugin currently runs Node.js 18.20.4 ...
Support for newer Node.js versions requires self-built runtime binaries for
mobile platforms, which we are evaluating") and this repo's installed
`next/package.json` (`"engines": {"node": ">=20.9.0"}`).

This is **not something a config change fixes** — it's a real, currently-open
gap in the plugin itself. Before investing further in this approach, it's
worth checking whether the plugin has added Node 20+ support since this was
written, or whether the app boots at all on Node 18 despite the declared
`engines` requirement (Next may or may not hard-fail on an unsupported
runtime — untested). If neither holds, Option A (embed the existing server)
needs re-evaluating against Option B/C from the #148 plan.

## What this is trying to prove

Can the *existing* Hearth server (unmodified business logic, unmodified
Prisma schema, unmodified server actions) run entirely on-device, with no
network server anywhere, by embedding a real Node.js runtime inside the
Capacitor shell via
[`@capawesome/capacitor-nodejs`](https://www.npmjs.com/package/@capawesome/capacitor-nodejs)
and pointing the WebView at `http://localhost:4173` instead of a remote host?

If yes, "standalone" and "connect to a self-hosted server" become one
runtime toggle (local server vs. remote URL) rather than two codebases —
see the full writeup on #148 for why that matters.

## What's here

- `nodejs/bootstrap.js` — the entry point the plugin loads once native code
  calls `Nodejs.start()` (manual start mode). It:
  1. Gets a writable on-device directory from the plugin's bridge.
  2. Points `DATABASE_URL` at a local file there, and applies any unapplied
     Prisma migrations directly via `@libsql/client-wasm`'s `executeMultiple`
     — not the `prisma migrate deploy` CLI, since the plugin doesn't support
     `child_process` and the CLI's own migration engine is yet another
     native binary with the same Android/iOS ABI problem as risk #1 below.
  3. Generates (or reloads) `AUTH_SECRET`/`ENCRYPTION_KEY`, self-healing if
     the on-device secrets file is missing or corrupt.
  4. `require()`s the built Next.js standalone server bundle in-process (the
     plugin doesn't support `child_process`, so this can't be a subprocess).
  5. Polls the server over HTTP until it actually accepts a connection
     before reporting `{state: "ready"}` — `require()` returning doesn't mean
     the server has finished binding its port (Next's own `startServer()` is
     async and unawaited at the top of its generated `server.js`).
- `nodejs/package.json` — bootstrap.js's own dependency manifest
  (`@libsql/client-wasm`, used directly for the migration step above — this
  is *not* where the server bundle's own libsql override lives; see below).
- `scripts/build-standalone-server.sh` — copies the repo to a scratch
  directory, applies a `@libsql/client` → `@libsql/client-wasm` override to
  *that copy only*, runs `next build`, copies in `prisma/`
  (schema + migrations) alongside the standalone output — the Dockerfile's
  runner stage copies the same two paths for the same reason — and
  assembles the result into `ios-shell/www/nodejs` (gitignored — generated
  output, not checked in). Run via `npm run cap:build-standalone`.
- `capacitor.config.ts` has a `plugins.Nodejs` block (`nodeDir: "nodejs"`,
  `startMode: "manual"`) — manual start so a future native "Set up locally"
  vs. "Connect to a server" choice can decide whether to boot the embedded
  runtime at all. **Nothing currently calls `Nodejs.start()`** — see "Not
  done" below.
- `@capawesome/capacitor-nodejs` lives in root `devDependencies`, not
  `dependencies` — confirmed via `@capacitor/cli`'s own plugin-discovery
  code that it scans both, so `cap sync` still finds it, while the
  production Docker image's `npm ci --omit=dev` correctly excludes it (it
  has an install script and would otherwise bloat the server-only runtime
  image with tens of MB it never uses).

## Verified risks

1. **`@libsql/client`'s native binding has no Android or iOS build.**
   Checked directly: the underlying `libsql` package's `optionalDependencies`
   list `darwin-x64`, `darwin-arm64`, `linux-x64-gnu`, `linux-x64-musl`,
   `win32-x64-msvc`, `linux-arm64-gnu`, `linux-arm64-musl`,
   `linux-arm-gnueabihf`, `linux-arm-musleabihf` — no Android (Bionic libc)
   target, and `darwin-*` is macOS, not iOS. The build script substitutes
   `@libsql/client-wasm` (no native binary) for the *server bundle's* copy as
   the fix attempt. **Unverified**: whether `@prisma/adapter-libsql` — which
   imports `@libsql/client` internally and is written against the native
   client's exact shape — actually works correctly against the WASM client's
   interface. If Prisma queries fail or behave differently at runtime, this
   is the next thing to check; a custom Prisma driver adapter written
   directly against `@libsql/client-wasm` may be needed instead of reusing
   `@prisma/adapter-libsql` unmodified. (`bootstrap.js`'s own migration step
   uses `@libsql/client-wasm` directly, bypassing Prisma entirely, so that
   part doesn't depend on this working.)
2. **`sharp` (native image processing, used for barcode/photo handling) has
   the same class of problem** — not directly checked with the same rigor as
   libsql, but its prebuilt binaries follow the same platform-support
   pattern (standard OS targets, not Android/iOS). Expect this to fail the
   same way; no fix attempted yet. If it does fail, the pragmatic fix is
   probably swapping to a pure-JS image library for the standalone build
   specifically, not fixing sharp itself.
3. **`nodeDir` needing to sit literally inside `webDir` (vs. an arbitrary
   relative path) is unconfirmed** — this spike assumes it does (default
   convention: `ios-shell/www/nodejs`), which is why the build script's
   destination is exactly that path.
4. **Whether the pre-existing `cap:sync`/`cap:android`/`cap:ios` workflow
   (used for the already-shipped "connect to a remote server" mode) still
   behaves correctly when `ios-shell/www/nodejs` doesn't exist yet is
   unverified.** `capacitor.config.ts` now unconditionally references that
   `nodeDir`; a developer who runs the existing commands without first
   running `npm run cap:build-standalone` may hit a new failure mode that
   didn't exist before this spike. Not fixed here — needs checking on a
   machine with the Android toolchain.
5. **iOS runs the embedded JS engine in interpreter-only mode (no JIT)** —
   confirmed from the plugin's own documented limitations. Expect Next.js
   server-side rendering to be meaningfully slower on iOS than Android.
   Reinforces doing the Android build first, matching #65's precedent.
6. **App size**: the plugin's docs state the embedded runtime adds "several
   tens of megabytes per CPU architecture" — a real Play Store/App Store
   size consideration, not investigated further here.
7. **The Node runtime "can only be started once per app launch"** per the
   plugin's own docs — no restart support. If the embedded server needs to
   restart (crash, a settings change requiring it), the whole app needs to
   relaunch, not just the runtime.
8. **`ENCRYPTION_KEY`/`AUTH_SECRET` generation in `bootstrap.js` is a
   plaintext on-device file, explicitly not production-safe** — real Phase 1
   work needs these in iOS Keychain / Android Keystore instead.

## Fixed since the first pass (found via `/code-review`)

- Added the missing migration step (was completely absent — the on-device
  DB would have had zero tables on every launch).
- Added the missing `prisma/` copy into the assembled bundle (needed by the
  migration step above; the Dockerfile copies the same path for the
  equivalent reason).
- `bootstrap.js` now polls the server over HTTP before reporting `ready`,
  instead of trusting `require()`'s synchronous return — fixes a real race
  where the native side could navigate the WebView before the server had
  actually bound its port.
- `APP_URL`'s hostname changed from the IP literal `127.0.0.1` to
  `localhost` — an IP literal isn't a valid WebAuthn relying-party ID, so
  passkey sign-in would have silently failed in standalone mode.
- Fixed a direct self-contradiction: `bootstrap.js`'s comment claimed
  "automatic start mode" while `capacitor.config.ts` sets
  `startMode: "manual"`.
- Moved `@capawesome/capacitor-nodejs` to `devDependencies` so it no longer
  bloats the production Docker image (confirmed it was landing there via
  the Dockerfile's `prod-deps` stage, independent of Next's own output
  tracing) — confirmed safe via `@capacitor/cli`'s plugin-discovery code,
  which scans both `dependencies` and `devDependencies`.
- Removed the dead `overrides` entry from `nodejs/package.json` (it was
  copied into the final bundle but nothing ever ran `npm install` against
  it there — the override that actually took effect was always the build
  script's separate one). That package.json now has a real purpose:
  `bootstrap.js`'s own `@libsql/client-wasm` dependency for the migration
  step.
- Build script: added `trap ... EXIT` so a failed run always cleans up its
  scratch directory (previously only cleaned up on success); excluded
  `.env`/`.env.*` from the rsync copy (previously a developer's real
  secrets could ride into the scratch build dir); excluded the script's own
  prior output, `android/`, and `ios/` from the rsync copy (previously
  wasted, unbounded-growing copy time); anchored the `/data`, `/android`,
  `/ios`, `/mobile-standalone` excludes to the repo root (previously
  unanchored, matching a real bug pattern flagged in the `data` exclude);
  removed the redundant explicit `prisma generate` call (`npm install`'s
  postinstall already runs it).
- Self-healing secrets: a corrupt/truncated secrets file (realistic if the
  app is killed mid-write) now regenerates instead of permanently bricking
  the app with an uncaught `JSON.parse` error.
- Unified error reporting through one `postError()` helper so every failure
  path reports a stack trace, not just some of them.

## Not done in this pass (deliberately out of scope for Phase 0)

- No native UI for choosing "standalone" vs. "connect to a server" — that's
  real Android/iOS UI work belonging to Phase 1 once Phase 0 proves the
  underlying approach works at all. For now, starting the runtime would need
  a temporary debug trigger (e.g. a button added to `ios-shell/www/index.html`
  calling `Nodejs.start()`) if you want to test end-to-end before building
  that UI.
- No background-execution handling (Phase 2, gated on #65's findings per the
  #148 plan).
- No local backup export/import UX (Phase 3).
- No iOS-specific wiring beyond what Capacitor's cross-platform config
  provides — Android-first per the #148 plan's recommendation.

## How to test this locally

This environment has no Android SDK, emulator, physical device, or Xcode —
none of the following has been run. From a machine that has the Android
toolchain set up:

```bash
npm install
npm run cap:build-standalone   # builds + assembles ios-shell/www/nodejs
npx cap sync android
npm run cap:android            # opens Android Studio
```

Then, with a temporary way to trigger `Nodejs.start()` (see "Not done"
above), watch `adb logcat` for the `standalone-status` bridge messages
`bootstrap.js` posts (`starting` → `ready` or `error`, with a `context`
field naming which stage failed: `migrations`, `server-require`,
`server-startup`, or `unhandled`). Given the confirmed Node version blocker
above, expect to hit that before anything else — check `adb logcat` for
signs the embedded runtime is even starting correctly before assuming any
of the application-level fixes here are the problem.
