import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHouseholdTimeZone } from "@/lib/appSettings";
import { DEFAULT_REGION, displayTimeZone, type DateFormat, type Region } from "@/lib/utils";

export interface UserPreferences {
  dateFormat: DateFormat;
  preferredCurrency: string;
  timezone: string;
  region: Region;
  /**
   * #422 — where this viewer's timestamps display: their own timezone once
   * they've picked one, else the household's (utils' displayTimeZone).
   * Calendar dates don't use it; they always read in UTC.
   */
  displayTimeZone: string;
}

const DEFAULT_PREFERENCES: Omit<UserPreferences, "displayTimeZone"> = {
  dateFormat: "DD/MM/YYYY",
  preferredCurrency: "AUD",
  timezone: "UTC",
  region: DEFAULT_REGION,
};

// Cached per request (React's cache()) so calling this from many components
// in one render only hits the DB once — dateFormat/timezone/currency aren't
// carried in the JWT (unlike role) so that changes in Settings take effect
// immediately instead of waiting for the session token to refresh.
export const getUserPreferences = cache(async (): Promise<UserPreferences> => {
  const session = await auth();
  // No session (a page rendering mid sign-out): nothing personal to show, so
  // skip both reads.
  if (!session?.user?.id) return { ...DEFAULT_PREFERENCES, displayTimeZone: "UTC" };
  const [user, householdTimeZone] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { dateFormat: true, preferredCurrency: true, timezone: true, region: true },
    }),
    getHouseholdTimeZone(),
  ]);
  if (!user) return { ...DEFAULT_PREFERENCES, displayTimeZone: householdTimeZone };

  const timezone = user.timezone || DEFAULT_PREFERENCES.timezone;
  return {
    dateFormat: (user.dateFormat as DateFormat) || DEFAULT_PREFERENCES.dateFormat,
    preferredCurrency: user.preferredCurrency || DEFAULT_PREFERENCES.preferredCurrency,
    timezone,
    region: (user.region as Region) || DEFAULT_PREFERENCES.region,
    displayTimeZone: displayTimeZone(timezone, householdTimeZone),
  };
});
