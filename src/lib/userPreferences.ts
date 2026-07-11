import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { DateFormat } from "@/lib/utils";

export interface UserPreferences {
  dateFormat: DateFormat;
  preferredCurrency: string;
  timezone: string;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  dateFormat: "DD/MM/YYYY",
  preferredCurrency: "AUD",
  timezone: "UTC",
};

// Cached per request (React's cache()) so calling this from many components
// in one render only hits the DB once — dateFormat/timezone/currency aren't
// carried in the JWT (unlike role) so that changes in Settings take effect
// immediately instead of waiting for the session token to refresh.
export const getUserPreferences = cache(async (): Promise<UserPreferences> => {
  const session = await auth();
  if (!session?.user?.id) return DEFAULT_PREFERENCES;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dateFormat: true, preferredCurrency: true, timezone: true },
  });
  if (!user) return DEFAULT_PREFERENCES;

  return {
    dateFormat: (user.dateFormat as DateFormat) || DEFAULT_PREFERENCES.dateFormat,
    preferredCurrency: user.preferredCurrency || DEFAULT_PREFERENCES.preferredCurrency,
    timezone: user.timezone || DEFAULT_PREFERENCES.timezone,
  };
});

// ~30 common IANA zones, grouped roughly by region for the settings select.
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
