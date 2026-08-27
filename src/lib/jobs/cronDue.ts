import cron from "node-cron";

// #250 — checks a cron pattern against a point in time without starting a
// real timer (cron.createTask() never calls .start()), so a scheduled
// job's config can be re-read fresh on every tick instead of being baked
// into a cron.schedule() call made once at process boot.
export function cronDue(pattern: string, at: Date): boolean {
  try {
    return cron.createTask(pattern, () => {}).match(at);
  } catch {
    return false; // an invalid pattern in Settings shouldn't crash the ticker
  }
}
