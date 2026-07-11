import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import {
  isBackupConfigured,
  isS3BackupConfigured,
  isSftpBackupConfigured,
  getBackupScheduleConfig,
} from "@/lib/appSettings";
import { BackupNowForm } from "@/components/BackupNowForm";
import { formatDate, humanFileSize } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Backups" };

export default async function BackupsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [logs, s3Configured, sftpConfigured, backupOk, backupSchedule, { dateFormat }] =
    await Promise.all([
      prisma.backupLog.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
      isS3BackupConfigured(),
      isSftpBackupConfigured(),
      isBackupConfigured(),
      getBackupScheduleConfig(),
      getUserPreferences(),
    ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Database backups</h1>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Configuration</h2>
        <ul className="space-y-1 text-sm">
          <li>
            Encryption: {isEncryptionConfigured() ? "configured" : "not configured"}
          </li>
          <li>S3-compatible storage: {s3Configured ? "configured" : "not configured"}</li>
          <li>SFTP: {sftpConfigured ? "configured" : "not configured"}</li>
          <li>Schedule: {backupSchedule.cron}</li>
          <li>Retention: last {backupSchedule.retentionCount} backups per destination</li>
        </ul>

        {!backupOk && (
          <p className="mt-3 text-sm text-warning">
            {isEncryptionConfigured()
              ? "Configure S3 or SFTP in System settings to enable offsite backups."
              : "Set ENCRYPTION_KEY, then configure S3 or SFTP in System settings to enable offsite backups. Backups are never sent unencrypted."}
          </p>
        )}

        {backupOk && (
          <div className="mt-4">
            <BackupNowForm />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Recent runs</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-foreground/60">No backups have run yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {log.destination}{" "}
                    <span
                      className={
                        log.status === "SUCCESS"
                          ? "text-success"
                          : "text-danger"
                      }
                    >
                      · {log.status}
                    </span>
                  </p>
                  <p className="text-xs text-foreground/50">
                    {formatDate(log.startedAt, dateFormat)}
                    {log.sizeBytes ? ` · ${humanFileSize(log.sizeBytes)}` : ""}
                    {log.message ? ` · ${log.message}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
