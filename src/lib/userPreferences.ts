import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_REGION, type DateFormat, type Region } from "@/lib/utils";

export interface UserPreferences {
  dateFormat: DateFormat;
  preferredCurrency: string;
  timezone: string;
  region: Region;
}

const DEFAULT_PREFERENCES: UserPreferences = {
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
  if (!session?.user?.id) return DEFAULT_PREFERENCES;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dateFormat: true, preferredCurrency: true, timezone: true, region: true },
  });
  if (!user) return DEFAULT_PREFERENCES;

  return {
    dateFormat: (user.dateFormat as DateFormat) || DEFAULT_PREFERENCES.dateFormat,
    preferredCurrency: user.preferredCurrency || DEFAULT_PREFERENCES.preferredCurrency,
    timezone: user.timezone || DEFAULT_PREFERENCES.timezone,
    region: (user.region as Region) || DEFAULT_PREFERENCES.region,
  };
});
