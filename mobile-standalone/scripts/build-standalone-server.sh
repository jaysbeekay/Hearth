#!/usr/bin/env bash
# Phase 0 spike build script (#148) — assembles the embedded Node.js
# server bundle that @capawesome/capacitor-nodejs will load on-device.
#
# UNVERIFIED end to end. Known-shaky steps are called out inline; see
# mobile-standalone/README.md for the full risk list — most notably, the
# Node.js version the plugin currently bundles (18.20.4) is older than
# what this app's Next.js version requires (>=20.9.0), which is a
# confirmed, currently-unresolved blocker independent of anything this
# script does. Run from the repo root: ./mobile-standalone/scripts/build-standalone-server.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIBSQL_WASM_VERSION="0.17.4"
BUILD_DIR="$(mktemp -d)"
DEST="$REPO_ROOT/ios-shell/www/nodejs"

# Guarantees cleanup even if any step below fails — without this, a failed
# `npm install`/`next build` (very plausible on a first attempt) leaves a
# full repo copy + node_modules install (hundreds of MB) behind in /tmp on
# every failed retry.
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "==> Copying repo to isolated build dir ($BUILD_DIR) so the libsql-wasm"
echo "    override below never touches your normal node_modules/dev setup"
rsync -a \
  --exclude='/.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='/mobile-standalone' \
  --exclude='/data' \
  --exclude='/android' \
  --exclude='/ios' \
  --exclude='e2e/.data' \
  --exclude='ios-shell/www/nodejs' \
  --exclude='.env' \
  --exclude='.env.*' \
  "$REPO_ROOT/" "$BUILD_DIR/"

echo "==> Applying @libsql/client -> @libsql/client-wasm override for this build only"
echo "    REASON (verified, not speculative): the 'libsql' package's native binding"
echo "    only ships prebuilts for linux-gnu/musl, darwin, and win32 — none of which"
echo "    match Android's Bionic libc or iOS. The WASM build has no native binary at"
echo "    all, so it's the only variant with any chance of loading in an embedded"
echo "    mobile Node runtime. UNVERIFIED: whether @prisma/adapter-libsql (which"
echo "    imports '@libsql/client' internally, expecting the native client's shape)"
echo "    actually works against the WASM client's interface. If Prisma queries fail"
echo "    at runtime with a type/shape mismatch, this is the first place to look."
echo "    This is the ONLY place this override is applied — mobile-standalone/nodejs/"
echo "    has its own separate, direct @libsql/client-wasm dependency for its own"
echo "    migration-runner code, not an override of this package's name."
node -e '
  const fs = require("fs");
  const path = require("path");
  const pkgPath = path.join(process.argv[1], "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.overrides = { ...(pkg.overrides || {}), "@libsql/client": `npm:@libsql/client-wasm@^${process.argv[2]}` };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
' "$BUILD_DIR" "$LIBSQL_WASM_VERSION"

cd "$BUILD_DIR"
npm install --prefer-offline
# `npm install`'s postinstall hook already runs `prisma generate` (this
# repo's own CLAUDE.md notes exactly this) — no separate step needed.

echo "==> Building the Next.js standalone server bundle"
npm run build

echo "==> Assembling $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/server-bundle"
cp -r "$BUILD_DIR/.next/standalone/." "$DEST/server-bundle/"
mkdir -p "$DEST/server-bundle/.next"
cp -r "$BUILD_DIR/.next/static" "$DEST/server-bundle/.next/static"
cp -r "$BUILD_DIR/public" "$DEST/server-bundle/public"
# Required for bootstrap.js's own migration step (applyMigrations reads
# these directly) — Dockerfile's runner stage copies the same two paths
# for the same reason (its entrypoint's `prisma migrate deploy` needs them).
cp -r "$BUILD_DIR/prisma" "$DEST/server-bundle/prisma"
cp "$BUILD_DIR/prisma.config.ts" "$DEST/server-bundle/prisma.config.ts"

echo "==> Copying bootstrap.js + package.json into $DEST"
cp "$REPO_ROOT/mobile-standalone/nodejs/bootstrap.js" "$DEST/bootstrap.js"
cp "$REPO_ROOT/mobile-standalone/nodejs/package.json" "$DEST/package.json"

echo "==> Installing bootstrap.js's own dependency (@libsql/client-wasm, for its migration runner)"
(cd "$DEST" && npm install --prefer-offline --omit=dev)

cat <<'EOF'

Done. UNVERIFIED next steps (see mobile-standalone/README.md):
  1. `npx cap sync android` to copy ios-shell/www/nodejs into the Android
     project the way @capawesome/capacitor-nodejs expects.
  2. Open the Android project and run on a device/emulator — watch logcat
     for "standalone-status" bridge messages from bootstrap.js. Nothing
     calls Nodejs.start() yet (no native "Set up locally" UI exists) — see
     README.md's "Not done" section for a temporary debug trigger.
  3. CONFIRMED BLOCKER, not yet resolved: @capawesome/capacitor-nodejs
     currently bundles Node.js 18.20.4; this app's Next.js requires
     Node >=20.9.0. This may prevent the server from running at all,
     independent of anything else in this build.
  4. If @libsql/client-wasm doesn't satisfy @prisma/adapter-libsql's
     expectations, that's the next thing to debug.
EOF
