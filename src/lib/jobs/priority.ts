// #398 review — the runner claims higher priority first, then oldest first.
// Everything a person or a schedule asks for runs at NORMAL; the document
// text backfill runs at BACKGROUND, so hours of catch-up OCR never delay a
// Reminder check, a backup, a price refresh or a fresh upload's extraction.
// Its own module so code the runner imports can queue jobs without a cycle.
export const JOB_PRIORITY = {
  NORMAL: 0,
  BACKGROUND: -1,
} as const;
