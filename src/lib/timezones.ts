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
