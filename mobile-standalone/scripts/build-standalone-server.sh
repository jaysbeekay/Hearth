#!/usr/bin/env bash
# Phase 0 spike build script (#148) — assembles the embedded Node.js
# server bundle that @capawesome/capacitor-nodejs will load on-device.
#
# UNVERIFIED end to end. Known-shaky steps are called out inline; see
# mobile-standalone/README.md for the full risk list. Run this from the
# repo root: ./mobile-standalone/scripts/build-standalone-server.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$(mktemp -d)"
DEST="$REPO_ROOT/ios-shell/www/nodejs"

echo "==> Copying repo to isolated build dir ($BUILD_DIR) so the libsql-wasm"
echo "    override below never touches your normal node_modules/dev setup"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='mobile-standalone' \
  --exclude='data' \
  --exclude='e2e/.data' \
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
node -e '
  const fs = require("fs");
  const path = require("path");
  const pkgPath = path.join(process.argv[1], "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.overrides = { ...(pkg.overrides || {}), "@libsql/client": "npm:@libsql/client-wasm@^0.17.4" };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
' "$BUILD_DIR"

cd "$BUILD_DIR"
npm install
npx prisma generate

echo "==> Building the Next.js standalone server bundle"
npm run build

echo "==> Assembling $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/server-bundle"
cp -r "$BUILD_DIR/.next/standalone/." "$DEST/server-bundle/"
mkdir -p "$DEST/server-bundle/.next"
cp -r "$BUILD_DIR/.next/static" "$DEST/server-bundle/.next/static"
cp -r "$BUILD_DIR/public" "$DEST/server-bundle/public"

echo "==> Copying bootstrap.js + package.json into $DEST"
cp "$REPO_ROOT/mobile-standalone/nodejs/bootstrap.js" "$DEST/bootstrap.js"
cp "$REPO_ROOT/mobile-standalone/nodejs/package.json" "$DEST/package.json"

echo "==> Cleaning up isolated build dir"
rm -rf "$BUILD_DIR"

cat <<'EOF'

Done. UNVERIFIED next steps (see mobile-standalone/README.md):
  1. `npx cap sync android` to copy ios-shell/www/nodejs into the Android
     project the way @capawesome/capacitor-nodejs expects.
  2. Open the Android project and run on a device/emulator — watch logcat
     for "standalone-status" bridge messages from bootstrap.js.
  3. If Next's server.js refuses to run when require()'d instead of being
     the process entry point, that's the first thing to debug.
  4. If @libsql/client-wasm doesn't satisfy @prisma/adapter-libsql's
     expectations, that's the second thing to debug.
EOF
