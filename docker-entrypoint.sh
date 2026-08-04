#!/bin/sh
set -e

# The application runs as the unprivileged `node` user (uid 1000), never as
# root (#160).
#
# The entrypoint itself still starts as root, deliberately. Earlier versions of
# this image ran everything as root, so an existing deployment's ./data
# bind-mount is owned by root on the host; a container that dropped straight to
# uid 1000 would fail to open its own database on upgrade. Starting as root
# lets us correct that ownership once, then drop privileges for the actual
# server process. Nothing that touches the network or user data runs as root.
#
# Operators who prefer the container never to hold root at all can set
# `user: "1000:1000"` in docker-compose.yml — the branch below detects that,
# skips the chown and runs directly. In that case ./data on the host must
# already be writable by uid 1000.

APP_USER="${APP_USER:-node}"
# Overridable mainly so this script can be exercised outside a container;
# /app/data is what the image and docker-compose.yml actually use.
DATA_DIR="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"

  # Only recurse when the ownership is actually wrong — on a large document
  # store an unconditional `chown -R` adds noticeable startup time.
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u "$APP_USER")" ]; then
    echo "[entrypoint] adopting $DATA_DIR for the $APP_USER user (uid $(id -u "$APP_USER"))"
    chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  fi

  # Re-exec this same script as the app user; the block below then runs.
  exec su-exec "$APP_USER" "$0" "$@"
fi

# From here on we are unprivileged — either dropped to by the block above, or
# started that way by an explicit `user:` setting.
if [ ! -w "$DATA_DIR" ]; then
  echo "[entrypoint] $DATA_DIR is not writable by uid $(id -u)." >&2
  echo "[entrypoint] The container is running as a non-root user, so the host" >&2
  echo "[entrypoint] directory bind-mounted there must be writable by it:" >&2
  echo "[entrypoint]     sudo chown -R $(id -u):$(id -g) ./data" >&2
  exit 1
fi

# Direct binary invocation, not `npx prisma` — the runner image has no npm
# CLI (#221), and none is needed here: prisma is already a production
# dependency with its own resolved bin.
./node_modules/.bin/prisma migrate deploy

exec node server.js
