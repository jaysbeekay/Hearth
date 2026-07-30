# Standalone-mode spike (#148, Phase 0)

**Status: unverified scaffolding, not a working feature.** This is Phase 0 of
the plan on [#148](https://github.com/jaysbeekay/Hearth/issues/148) — a
feasibility spike, not production code. Nothing here is wired into the app's
actual sign-in flow yet (see "Not done" below). Expect to debug this by hand
on a real device; it was written without the ability to build or run an
Android/iOS project in the environment that produced it.

## What this is trying to prove

Can the *existing* Hearth server (unmodified business logic, unmodified
Prisma schema, unmodified server actions) run entirely on-device, with no
network server anywhere, by embedding a real Node.js runtime inside the
Capacitor shell via
[`@capawesome/capacitor-nodejs`](https://www.npmjs.com/package/@capawesome/capacitor-nodejs)
and pointing the WebView at `http://127.0.0.1:4173` instead of a remote host?

If yes, "standalone" and "connect to a self-hosted server" become one
runtime toggle (local server vs. remote URL) rather than two codebases —
see the full writeup on #148 for why that matters.

## What's here

- `nodejs/bootstrap.js` — the entry point the plugin loads. Sets
  `DATABASE_URL`/`APP_URL`/`ENCRYPTION_KEY`/etc. to point at on-device
  storage, then `require()`s the built Next.js standalone server in-process
  (the plugin doesn't support `child_process`, so this can't just be
  `node server.js` in a subprocess — it has to run in the same process the
  plugin gives us).
- `nodejs/package.json` — exists only to carry an `overrides` entry
  substituting `@libsql/client` for `@libsql/client-wasm` for this build —
  see "Verified risks" below for why.
- `scripts/build-standalone-server.sh` — copies the repo to a scratch
  directory, applies that override, runs `next build`, and assembles the
  result into `ios-shell/www/nodejs` (gitignored — generated output, not
  checked in). Run via `npm run cap:build-standalone`.
- `capacitor.config.ts` now has a `plugins.Nodejs` block (`nodeDir: "nodejs"`,
  `startMode: "manual"`) — manual start so a future native "Set up locally"
  vs. "Connect to a server" choice can decide whether to boot the embedded
  runtime at all.

## Verified risks (found by actually checking, not guessing)

1. **`@libsql/client`'s native binding has no Android or iOS build.**
   Checked directly: the underlying `libsql` package's `optionalDependencies`
   list `darwin-x64`, `darwin-arm64`, `linux-x64-gnu`, `linux-x64-musl`,
   `win32-x64-msvc`, `linux-arm64-gnu`, `linux-arm64-musl`,
   `linux-arm-gnueabihf`, `linux-arm-musleabihf` — no Android (Bionic libc)
   target, and `darwin-*` is macOS, not iOS. **This means the app's database
   layer, exactly as it exists today, will not load inside the embedded
   mobile Node runtime.** The build script substitutes `@libsql/client-wasm`
   (no native binary, should load anywhere V8 does) as the fix attempt.
   **Unverified**: whether `@prisma/adapter-libsql` — which imports
   `@libsql/client` internally and is written against the native client's
   exact shape — actually works correctly against the WASM client's
   interface. If Prisma queries fail or behave differently at runtime, this
   is the first place to look; a custom Prisma driver adapter written
   directly against `@libsql/client-wasm` may be needed instead of reusing
   `@prisma/adapter-libsql` unmodified.
2. **`sharp` (native image processing, used for barcode/photo handling) has
   the same class of problem** — not directly checked with the same rigor as
   libsql, but its prebuilt binaries follow the same platform-support pattern
   (standard OS targets, not Android/iOS). Expect this to fail the same way;
   no fix attempted yet. If it does fail, the pragmatic fix is probably
   swapping to a pure-JS image library for the standalone build specifically
   (mirroring the libsql-wasm-override pattern), not fixing sharp itself.
3. **Requiring Next's `output: standalone` `server.js` instead of running it
   as the process entry point is unverified.** Its top-level code creates an
   `http.Server` and calls `.listen()`, which *should* behave identically
   either way, but this has not been confirmed against a real build.
4. **The plugin's docs say nothing about an HTTP-server capability** — Node
   code must open its own server for anything, which the app already does
   (it's a full Next.js server), so this should be fine, but it means the
   plugin isn't providing any of the wiring here — everything routes through
   the app's own `next build` output.
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
   relaunch, not just the runtime. Worth designing around rather than
   fighting.
8. **`ENCRYPTION_KEY`/`AUTH_SECRET` generation in `bootstrap.js` is a
   plaintext on-device file, explicitly not production-safe** — real Phase 1
   work needs these in iOS Keychain / Android Keystore instead. Written this
   way purely so the spike can boot and be inspected at all.
9. **Whether `nodeDir` in `capacitor.config.ts` needs to sit literally inside
   `webDir`, or can point elsewhere via a relative path, was not confirmed**
   — this spike assumes the former (default convention: `ios-shell/www/nodejs`),
   which is why the build script's destination is exactly that path rather
   than referencing `mobile-standalone/nodejs/` directly.

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
`bootstrap.js` posts (`starting` → `ready` or `error`). An `error` state's
message will be the actual Node.js exception — that's where the real
debugging starts, most likely at risk #1 or #2 above.
