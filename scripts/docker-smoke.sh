#!/usr/bin/env bash
# Container smoke test for the Docker image (#518).
#
#   scripts/docker-smoke.sh <image> [<previous-release-image>]
#
# Starts <image> on an empty data volume and checks what a self-hoster relies
# on: migrations apply from scratch, the server answers /api/health, it runs as
# the unprivileged `node` user, the three document-extraction binaries are
# present, every external module the server bundle requires resolves from the
# standalone output (a missed trace only fails at the first request that needs
# it, so nothing else would catch it), and every MCP tool answers.
#
# With <previous-release-image>, it first starts that image on a second volume
# to create a database the way a current install has one, then starts <image>
# on it, so the upgrade path (pending migrations against an existing DB, with
# its existing ownership) is checked too.
set -euo pipefail

IMAGE="${1:?usage: $0 <image> [<previous-release-image>]}"
PREVIOUS="${2:-}"
PORT="${SMOKE_PORT:-3999}"
MCP_TOKEN="smoke-mcp-token"
WORK="$(mktemp -d)"
CONTAINERS=()

cleanup() {
  for c in "${CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  # The containers chown their data dirs to uid 1000; remove them from inside
  # a container so this works without sudo on the host.
  docker run --rm -v "$WORK:/w" --entrypoint sh "$IMAGE" -c 'rm -rf /w/*' >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

start() { # start <name> <image> <data dir>
  local name="$1" image="$2" data="$3"
  mkdir -p "$data"
  docker run -d --name "$name" -p "$PORT:3000" -v "$data:/app/data" \
    -e DATABASE_URL=file:./data/app.db \
    -e UPLOADS_DIR=./data/uploads \
    -e AUTH_SECRET=docker-smoke-secret-0123456789abcdef0123 \
    -e "MCP_TOKEN=$MCP_TOKEN" \
    "$image" >/dev/null
  CONTAINERS+=("$name")
  for _ in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health")" = "200" ]; then
      return 0
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
      docker logs "$name" >&2; fail "$name exited during startup"
    fi
    sleep 2
  done
  docker logs "$name" >&2
  fail "$name never answered /api/health"
}

stop() { docker rm -f "$1" >/dev/null; }

mcp() { # mcp <json-rpc body>
  curl -sf -X POST "http://localhost:$PORT/api/mcp" \
    -H "Authorization: Bearer $MCP_TOKEN" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' -d "$1"
}

check_running_image() { # check_running_image <container>
  local c="$1"

  echo "-- health: $(curl -s "http://localhost:$PORT/api/health")"

  local user
  # The entrypoint execs its way to the server (su-exec, then node), so PID 1
  # is the server process; /proc/1 is owned by its effective user.
  user="$(docker exec "$c" stat -c %U /proc/1)"
  [ "$user" = "node" ] || fail "server runs as '$user', expected node"
  echo "-- server runs as node"

  docker exec "$c" sh -c 'tesseract --version >/dev/null 2>&1 && pdftotext -v >/dev/null 2>&1 && pdftoppm -v >/dev/null 2>&1' \
    || fail "an extraction binary (tesseract, pdftotext, pdftoppm) is missing"
  echo "-- tesseract, pdftotext, pdftoppm present"

  # Every require("x") left in the server bundle must resolve from /app.
  # Allowed misses: `encoding` is an optional peer that node-fetch loads in a
  # try/catch, and the ajv runtime paths are code strings ajv writes into
  # *standalone* validator source, never required by the running server.
  docker exec "$c" node -e '
    const { execSync } = require("child_process");
    const { builtinModules } = require("module");
    const allowed = new Set(["encoding", "ajv-formats/dist/formats"]);
    const found = execSync(String.raw`grep -rhoE "require\(\"[^\".][^\"]*\"\)" /app/.next/server`, { encoding: "utf8" });
    const names = [...new Set(found.split("\n").filter(Boolean).map((s) => s.slice(9, -2)))];
    const missing = names.filter((m) =>
      !builtinModules.includes(m) && !m.startsWith("node:") && !allowed.has(m) && !m.startsWith("ajv/dist/runtime/") &&
      (() => { try { require.resolve(m, { paths: ["/app"] }); return false; } catch { return true; } })());
    if (missing.length) { console.error("unresolvable server externals:", missing); process.exit(1); }
    console.log("-- " + names.length + " server externals resolve");
  ' || fail "the standalone output is missing a module the server requires"

  mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docker-smoke","version":"1"}}}' >/dev/null \
    || fail "MCP initialize failed"
  local tools
  tools="$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const json = s.trim().startsWith("{") ? s : s.split("\n").find((l) => l.startsWith("data:")).slice(5);
      console.log(JSON.parse(json).result.tools.map((t) => t.name).join(" "));
    });')"
  [ -n "$tools" ] || fail "MCP tools/list returned no tools"
  local id=10 tool args
  for tool in $tools; do
    case "$tool" in
      get_contract) args='{"id":"docker-smoke-missing"}' ;;
      search_contracts) args='{"query":"docker-smoke"}' ;;
      *) args='{}' ;;
    esac
    id=$((id + 1))
    mcp "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
      | grep '"result"' >/dev/null || fail "MCP tool $tool did not return a result"
  done
  echo "-- MCP tools answer: $tools"

  if grep -E "Cannot find module|ENOENT|MODULE_NOT_FOUND" <<<"$(docker logs "$c" 2>&1)"; then
    fail "server log shows a missing file or module"
  fi
}

echo "== fresh install: $IMAGE"
start smoke-fresh "$IMAGE" "$WORK/fresh"
# Logs are captured first: under pipefail, `docker logs | grep -q` fails
# whenever grep exits early and docker logs gets SIGPIPE.
LOGS="$(docker logs smoke-fresh 2>&1)"
grep -q "All migrations have been successfully applied" <<<"$LOGS" \
  || { docker logs smoke-fresh >&2; fail "migrations did not apply on an empty volume"; }
echo "-- migrations applied to an empty database"
check_running_image smoke-fresh
stop smoke-fresh

if [ -n "$PREVIOUS" ]; then
  echo "== upgrade: database created by $PREVIOUS, then $IMAGE"
  start smoke-prev "$PREVIOUS" "$WORK/upgrade"
  stop smoke-prev
  start smoke-upgrade "$IMAGE" "$WORK/upgrade"
  LOGS="$(docker logs smoke-upgrade 2>&1)"
  grep -qE "No pending migrations|successfully applied" <<<"$LOGS" \
    || { docker logs smoke-upgrade >&2; fail "migrate deploy did not complete against the existing database"; }
  check_running_image smoke-upgrade
  stop smoke-upgrade
fi

echo "== docker smoke test passed"
