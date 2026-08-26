import { cache } from "react";
import { prisma } from "@/lib/prisma";

// Cached per request — cheap, but called from RecordMeta on every domain
// detail page, so dedupe repeated calls within one render (#285).
export const getHouseholdMemberCount = cache(async (): Promise<number> => {
  return prisma.user.count();
});
