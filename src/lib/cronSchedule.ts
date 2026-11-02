// #363 — the reminder and backup schedules in plain language. Settings
// offers "Daily at 08:00" and "Weekly on Monday at 08:00" and writes the cron
// string from them; anything else stays a raw cron expression behind the
// "Advanced (cron)" choice. Pure, so the picker, the pages and the tests
// share it.

export type ScheduleKind = "daily" | "weekly" | "advanced";

export type Schedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }
  | { kind: "advanced"; cron: string };

/** Sunday first, as cron counts them (0–6; cron also takes 7 for Sunday). */
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const SIMPLE = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7])$/;

/** Reads a cron string as daily or weekly where it is one, else advanced. */
export function parseSchedule(cron: string): Schedule {
  const trimmed = cron.trim().replace(/\s+/g, " ");
  const match = SIMPLE.exec(trimmed);
  if (match) {
    const minute = Number(match[1]);
    const hour = Number(match[2]);
    if (minute <= 59 && hour <= 23) {
      if (match[3] === "*") return { kind: "daily", hour, minute };
      return { kind: "weekly", day: Number(match[3]) % 7, hour, minute };
    }
  }
  return { kind: "advanced", cron: cron.trim() };
}

/** The cron string a schedule stands for. */
export function scheduleToCron(schedule: Schedule): string {
  switch (schedule.kind) {
    case "daily":
      return `${schedule.minute} ${schedule.hour} * * *`;
    case "weekly":
      return `${schedule.minute} ${schedule.hour} * * ${schedule.day}`;
    case "advanced":
      return schedule.cron.trim();
  }
}

/** "08:00" */
export function formatScheduleTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "08:00" → { hour: 8, minute: 0 }; null for anything that isn't a time of day. */
export function parseScheduleTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

// "Daily at 08:00", "Weekly on Monday at 03:30", or "Custom (<the cron string>)".
export function describeSchedule(cron: string): string {
  const schedule = parseSchedule(cron);
  switch (schedule.kind) {
    case "daily":
      return `Daily at ${formatScheduleTime(schedule.hour, schedule.minute)}`;
    case "weekly":
      return `Weekly on ${WEEKDAYS.at(schedule.day)} at ${formatScheduleTime(schedule.hour, schedule.minute)}`;
    case "advanced":
      return `Custom (${schedule.cron})`;
  }
}
