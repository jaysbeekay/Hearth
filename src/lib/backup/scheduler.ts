import { readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { encryptBuffer } from "@/lib/crypto";
import { isBackupConfigured, getBackupDestinationChoice, getBackupScheduleConfig } from "@/lib/appSettings";
import { createSnapshot } from "@/lib/backup/snapshot";
import { pruneS3, uploadToS3 } from "@/lib/backup/s3";
import { pruneSftp, uploadToSftp } from "@/lib/backup/sftp";
import { pruneLocal, uploadToLocal } from "@/lib/backup/local";
import type { BackupDestination } from "@/generated/prisma/enums";

type Destination = {
  name: BackupDestination;
  upload: (data: Buffer, fileName: string) => Promise<void>;
  prune: (retentionCount: number) => Promise<void>;
};

const DESTINATIONS: Record<"S3" | "SFTP" | "LOCAL", Destination> = {
  S3: { name: "S3", upload: uploadToS3, prune: pruneS3 },
  SFTP: { name: "SFTP", upload: uploadToSftp, prune: pruneSftp },
  LOCAL: { name: "LOCAL", upload: uploadToLocal, prune: pruneLocal },
};

// Exactly one destination is active at a time — the admin's explicit choice
// from System settings, not "every destination with credentials saved".
export async function runBackup(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  if (!(await isBackupConfigured())) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const choice = await getBackupDestinationChoice();
  if (choice === "NONE") {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  const destination = DESTINATIONS[choice];

  const { retentionCount } = await getBackupScheduleConfig();
  const snapshot = await createSnapshot();

  try {
    const plain = await readFile(snapshot.path);
    const encrypted = encryptBuffer(plain);
    const fileName = `contracts-${new Date().toISOString().replace(/[:.]/g, "-")}.db.enc`;

    const startedAt = new Date();
    try {
      await destination.upload(encrypted, fileName);
      await destination.prune(retentionCount);
      await prisma.backupLog.create({
        data: {
          destination: destination.name,
          status: "SUCCESS",
          fileName,
          sizeBytes: encrypted.length,
          startedAt,
          finishedAt: new Date(),
        },
      });
      return { attempted: 1, succeeded: 1, failed: 0 };
    } catch (error) {
      console.error(`[backup] ${destination.name} backup failed:`, error);
      await prisma.backupLog.create({
        data: {
          destination: destination.name,
          status: "FAILURE",
          fileName,
          message: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: new Date(),
        },
      });
      return { attempted: 1, succeeded: 0, failed: 1 };
    }
  } finally {
    await snapshot.cleanup();
  }
}
