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
 */
import { realpathSync } from "node:fs";
import path from "node:path";

const PRIMARY_CONFIRMATION = "yes-i-have-a-fresh-backup";

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

type Env = Record<string, string | undefined>;

export function livePaths(env: Env = process.env, cwd = process.cwd()): string[] {
  const fromUrl = (url: string | undefined) => (url?.startsWith("file:") ? url.slice("file:".length) : undefined);
  return [
    fromUrl(env.DATABASE_URL),
    env.UPLOADS_DIR,
    "./data/app.db",
    "./data/uploads",
    "/app/data/app.db",
    "/app/data/uploads",
  ]
    .filter((p): p is string => Boolean(p))
    .map((p) => real(path.resolve(cwd, p)));
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
  throw new Error(
    `Refusing to write to the live install (${hits.join(", ")}). Run against a copy, or, in the maintenance ` +
      `window after taking a fresh backup, set ITEM_STAGE_PRIMARY=${PRIMARY_CONFIRMATION}.`,
  );
}
