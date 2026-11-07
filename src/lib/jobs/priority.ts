// #398 review — the runner claims higher priority first, then oldest first.
// Everything a person or a schedule asks for runs at NORMAL; the document
// text backfill runs at BACKGROUND, so a Reminder check, a backup, a price
// refresh or a fresh upload's extraction is claimed ahead of hours of
// catch-up OCR. Jobs run one at a time, so one waits at most for the
// extraction already running. /api/cron runs NORMAL jobs only.
// Its own module so code the runner imports can queue jobs without a cycle.
export const JOB_PRIORITY = {
  NORMAL: 0,
  BACKGROUND: -1,
} as const;
