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
/** With no run on record, a run the schedule wanted within this long ago is still owed. */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * MINUTE_MS;
/** The furthest back a missed run is looked for: past a year, so yearly schedules are covered. */
const MAX_LOOKBACK_MS = 400 * 24 * 60 * MINUTE_MS;
/** Minutes checked between yields to the event loop, so a long scan doesn't stall the server. */
const YIELD_EVERY = 10_000;

const floorToMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

// How far each job's schedule has been checked with nothing owed, so a tick
// only looks at the minutes since the last tick. Lost on restart, when the
// job's last run starts the scan again.
const scannedThrough = new Map<string, number>();
// The pattern each job was last checked with, to tell when Settings changed it.
const patternInUse = new Map<string, string>();

/**
 * Whether a scheduled job is owed a run: some minute after its last run, up
 * to now, matches its schedule. cronDue only matches inside the scheduled
 * second, and node-cron skips a tick the process was asleep or blocked for
 * rather than running it late, so a daily job could silently lose its day;
 * this still runs it once the server is back, however long it was down (up
 * to 400 days, which covers a yearly schedule).
 *
 * `key` names the job; `lastRun` is when its last run was queued (null if
 * never). The first scan after a restart covers the whole time since
 * `lastRun`; later ones only the minutes since the previous tick.
 */
export async function cronOwed(key: string, pattern: string, lastRun: Date | null, now: Date): Promise<boolean> {
  let task: ReturnType<typeof cron.createTask>;
  let wallTask: ReturnType<typeof cron.createTask>;
  let dayTask: ReturnType<typeof cron.createTask> | null;
  try {
    task = cron.createTask(pattern, () => {});
    // Matches a local wall-clock time given as UTC parts, for local times
    // that don't exist (a spring-forward gap) and so have no Date of their own.
    wallTask = cron.createTask(pattern, () => {}, { timezone: "UTC" });
    dayTask = daysOf(pattern);
  } catch {
    return false; // an invalid pattern in Settings shouldn't crash the ticker
  }
  const end = floorToMinute(now.getTime());
  const memoKey = `${key}|${pattern}`;
  // A schedule edited in Settings starts from now: the new times that fell
  // between the last run and the edit were never asked for.
  const previousPattern = patternInUse.get(key);
  patternInUse.set(key, pattern);
  if (previousPattern !== undefined && previousPattern !== pattern) scannedThrough.set(memoKey, end - MINUTE_MS);

  const since = lastRun ? lastRun.getTime() : now.getTime() - FIRST_RUN_LOOKBACK_MS;
  const start = Math.max(floorToMinute(since), scannedThrough.get(memoKey) ?? -Infinity, end - MAX_LOOKBACK_MS);
  // Under a fall-back hour the same local time comes twice; a run at the
  // first one counts for the second.
  const lastRunWall = lastRun ? wallMinute(new Date(floorToMinute(lastRun.getTime()))) : null;

  let checked = 0;
  let day = "";
  let dayMatches = true;
  let previousWall = wallMinute(new Date(start));
  for (let t = start + MINUTE_MS; t <= end; t += MINUTE_MS) {
    const at = new Date(t);
    if (dayTask && at.toDateString() !== day) {
      day = at.toDateString();
      dayMatches = dayTask.match(new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12));
    }
    if (!dayMatches) {
      // Skip to the last minute of this day; the loop steps into the next one.
      t = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime() - MINUTE_MS;
      previousWall = wallMinute(new Date(t));
      continue;
    }
    const wall = wallMinute(at);
    // Spring forward: the local times the clock jumped over are owed at the
    // first minute after the jump.
    for (let w = previousWall + MINUTE_MS; w < wall; w += MINUTE_MS) {
      if (wallTask.match(new Date(w))) return true;
    }
    previousWall = wall;
    if (task.match(at) && wall !== lastRunWall) return true;
    if (++checked % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  scannedThrough.set(memoKey, end);
  return false;
}

/** A moment's local wall-clock minute, as the UTC instant with the same parts. */
function wallMinute(at: Date): number {
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes());
}

/**
 * The days a pattern runs on, as a pattern that matches any time on them,
 * so a scan can skip whole days a monthly or yearly schedule doesn't run on.
 * Null when the pattern isn't plain 5- or 6-field cron (no skipping then).
 */
function daysOf(pattern: string): ReturnType<typeof cron.createTask> | null {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return null;
  const [dayOfMonth, month, dayOfWeek] = fields.slice(-3);
  return cron.createTask(`* * ${dayOfMonth} ${month} ${dayOfWeek}`, () => {});
}

/** Forgets what cronOwed has scanned; for tests. */
export function resetCronOwedScans(): void {
  scannedThrough.clear();
  patternInUse.clear();
}
