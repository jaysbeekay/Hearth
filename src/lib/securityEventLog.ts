import { prisma } from "@/lib/prisma";
import type { SecurityEventType } from "@/generated/prisma/enums";

/**
 * Persists an auth-relevant security event for the Settings > Security log.
 * Never throws: a logging failure must not break the auth flow it's
 * observing (same reasoning as the webhook-secret backfill in
 * instrumentation.ts), so a write failure is only reported to the console.
 */
export async function logSecurityEvent(params: {
  type: SecurityEventType;
  userId?: string;
  email?: string;
  detail?: string;
  address?: string;
}): Promise<void> {
  try {
    await prisma.securityEventLog.create({
      data: {
        type: params.type,
        userId: params.userId ?? null,
        email: params.email ?? null,
        detail: params.detail ?? null,
        address: params.address ?? null,
      },
    });
  } catch (error) {
    console.error("[security] failed to record security event:", error);
  }
}
