/**
 * #445 review — the #380 backfills write to the database and uploads tree they
 * are given. They are meant for a scratch copy first, so refuse a path that is
 * (or is inside) the live install's database or uploads directory unless the
 * operator explicitly says it is the primary and a fresh backup exists:
 *
 *   ITEM_STAGE_PRIMARY=yes-i-have-a-fresh-backup
 *
 * "Live" means what this shell's DATABASE_URL / UPLOADS_DIR point at, plus the
 * documented defaults (./data/app.db, ./data/uploads, and /app/data/... in the
 * Docker image).
 *
 * A scratch run where this shell's DATABASE_URL / UPLOADS_DIR were pointed at
 * the copy itself (e.g. exported for `prisma migrate deploy`) is confirmed
 * with ITEM_STAGE_COPY=yes-this-is-a-scratch-copy instead. That token only
 * covers the shell's own variables; it never unlocks the documented live
 * defaults, which still need ITEM_STAGE_PRIMARY.
 */
import { realpathSync } from "node:fs";
import path from "node:path";

const PRIMARY_CONFIRMATION = "yes-i-have-a-fresh-backup";
const COPY_CONFIRMATION = "yes-this-is-a-scratch-copy";
const DEFAULT_LIVE = ["./data/app.db", "./data/uploads", "/app/data/app.db", "/app/data/uploads"];

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

type Env = Record<string, string | undefined>;

// A SQLite URL can carry query parameters (file:/srv/hearth/app.db?mode=rwc);
// they aren't part of the path, so drop them before comparing (#445 review).
const fromUrl = (url: string | undefined) =>
  url?.startsWith("file:") ? url.slice("file:".length).split("?")[0] : undefined;

function resolveAll(paths: (string | undefined)[], cwd: string): string[] {
  return paths.filter((p): p is string => Boolean(p)).map((p) => real(path.resolve(cwd, p)));
}

/** What this shell's own DATABASE_URL / UPLOADS_DIR point at. */
export function shellPaths(env: Env = process.env, cwd = process.cwd()): string[] {
  return resolveAll([fromUrl(env.DATABASE_URL), env.UPLOADS_DIR], cwd);
}

export function livePaths(env: Env = process.env, cwd = process.cwd()): string[] {
  return [...shellPaths(env, cwd), ...resolveAll(DEFAULT_LIVE, cwd)];
}

/** Whether `target` is, or is inside, one of `live`. */
export function touchesLive(target: string, live: string[]): boolean {
  const t = real(target);
  return live.some((l) => t === l || t.startsWith(l + path.sep) || l.startsWith(t + path.sep));
}

export function assertDisposableTargets(targets: string[], env: Env = process.env) {
  const live = livePaths(env);
  const hits = targets.filter((t) => touchesLive(t, live));
  if (hits.length === 0) return;
  if (env.ITEM_STAGE_PRIMARY === PRIMARY_CONFIRMATION) {
    console.warn(`[items] Writing to the live install (${hits.join(", ")}): ITEM_STAGE_PRIMARY confirmed a fresh backup.`);
    return;
  }
  const defaults = resolveAll(DEFAULT_LIVE, process.cwd());
  const onlyShell = hits.every((t) => !touchesLive(t, defaults));
  if (env.ITEM_STAGE_COPY === COPY_CONFIRMATION && onlyShell) {
    console.warn(`[items] Writing to ${hits.join(", ")}: ITEM_STAGE_COPY confirmed this shell points at a scratch copy.`);
    return;
  }
  throw new Error(
    `Refusing to write to the live install (${hits.join(", ")}). For a scratch copy, unset DATABASE_URL/UPLOADS_DIR ` +
      `or set ITEM_STAGE_COPY=${COPY_CONFIRMATION}. For the primary, in the maintenance window after taking a ` +
      `fresh backup, set ITEM_STAGE_PRIMARY=${PRIMARY_CONFIRMATION}.`,
  );
}
