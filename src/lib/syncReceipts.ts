import { prisma } from "@/lib/prisma";

// #249 — how long a sync-operation receipt is kept before it's purged. Has
// to outlive a realistic "device went offline for a while" gap: the queued
// operation itself can sit in IndexedDB indefinitely until connectivity
// returns, so a receipt purged too early would stop protecting exactly the
// case it exists for. Matches Trash's own retention window for the same
// "runs opportunistically, no dedicated job-runner yet (#250)" reasoning.
export const SYNC_RECEIPT_RETENTION_DAYS = 30;

export async function purgeExpiredSyncReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - SYNC_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.syncOperationReceipt.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
