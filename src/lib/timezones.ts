// ~30 common IANA zones, grouped roughly by region for the settings select.
// Kept dependency-free (no prisma/auth imports) so it can be safely imported
// from client components as well as server-only code.
export const TIMEZONE_OPTIONS = [
  "UTC",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Hobart",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Pacific/Honolulu",
] as const;

// #422 — a member's own timezone (Settings → Preferences) only changes where
// timestamps display; until they pick one, timestamps follow the household's.
//
// - "" is the explicit "Household default" choice.
// - "UTC" is the User.timezone column default, which every member who never
//   opened Preferences still has, so it can't tell "chose UTC" from "never
//   chose". It reads as the household default too, and the select shows it
//   as such; no migration rewrites it.
// - A deliberate UTC choice is stored as "Etc/UTC" (the same zone), which is
//   honoured like any other pick.

/** Stored when a member defers to the household timezone. */
export const HOUSEHOLD_DEFAULT_USER_TIME_ZONE = "";
/** The column default: never deliberately chosen, so it means the household default. */
export const LEGACY_UNSET_USER_TIME_ZONE = "UTC";
/** How a deliberate UTC choice is stored. */
export const EXPLICIT_UTC_TIME_ZONE = "Etc/UTC";

/** The Preferences timezone choices, in order; the server accepts exactly these. */
export const USER_TIMEZONE_OPTIONS: readonly string[] = [
  HOUSEHOLD_DEFAULT_USER_TIME_ZONE,
  EXPLICIT_UTC_TIME_ZONE,
  ...TIMEZONE_OPTIONS.filter((tz) => tz !== "UTC"),
];

export function isUserTimeZoneOption(value: unknown): value is string {
  return typeof value === "string" && USER_TIMEZONE_OPTIONS.includes(value);
}

/** Whether a stored member timezone defers to the household's. */
export function followsHouseholdTimeZone(stored: string | null | undefined): boolean {
  return !stored || stored === LEGACY_UNSET_USER_TIME_ZONE;
}

/** The Preferences option a stored member timezone selects. */
export function userTimeZoneChoice(stored: string | null | undefined): string {
  return !followsHouseholdTimeZone(stored) && isUserTimeZoneOption(stored) ? stored : HOUSEHOLD_DEFAULT_USER_TIME_ZONE;
}

/**
 * Choices for the household timezone: the common zones above, then every
 * other zone this runtime knows. `current` (a stored value) is always
 * included so the select never silently shows something else.
 */
export function householdTimeZoneChoices(current: string): { common: string[]; others: string[] } {
  const common: string[] = [...TIMEZONE_OPTIONS];
  const others = Intl.supportedValuesOf("timeZone").filter((tz) => !common.includes(tz));
  if (current && !common.includes(current) && !others.includes(current)) others.unshift(current);
  return { common, others };
}
