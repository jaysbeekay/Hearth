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

const MINUTE_MS = 60_000;
/** How far ahead to look for a schedule's next run: past a week, so weekly schedules are covered. */
const SEARCH_AHEAD_MS = 8 * 24 * 60 * MINUTE_MS;
/** With no run on record, a run the schedule wanted within this long ago is still owed. */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * MINUTE_MS;

/**
 * The first whole minute strictly after `after`'s minute that `pattern`
 * matches, looking at most `withinMs` ahead. Null when there is none in
 * that window or the pattern is invalid.
 */
export function nextCronMinute(pattern: string, after: Date, withinMs = SEARCH_AHEAD_MS): Date | null {
  let task: ReturnType<typeof cron.createTask>;
  try {
    task = cron.createTask(pattern, () => {});
  } catch {
    return null;
  }
  const start = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let t = start; t <= after.getTime() + withinMs; t += MINUTE_MS) {
    const at = new Date(t);
    if (task.match(at)) return at;
  }
  return null;
}

// The next run only changes when the pattern or the last run does, so the
// minute-by-minute search runs once per run rather than on every tick.
const nextRunMemo = new Map<string, Date | null>();

/**
 * Whether a scheduled job is owed a run: the schedule's first time after
 * the job's last run has come. cronDue only matches inside the scheduled
 * second, and node-cron skips a tick the process was asleep or blocked for
 * rather than running it late, so a daily job could silently lose its day.
 * This still runs it once the server is back. `lastRun` is when the last
 * run was queued (null if never). A schedule with no time in the next week
 * (a monthly one) falls back to cronDue.
 */
export function cronOwed(pattern: string, lastRun: Date | null, now: Date): boolean {
  const since = lastRun ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  const key = `${pattern}|${since.getTime()}`;
  if (!nextRunMemo.has(key)) {
    if (nextRunMemo.size > 50) nextRunMemo.clear();
    nextRunMemo.set(key, nextCronMinute(pattern, since));
  }
  const next = nextRunMemo.get(key) ?? null;
  if (next == null) return cronDue(pattern, now);
  return next.getTime() <= now.getTime();
}
