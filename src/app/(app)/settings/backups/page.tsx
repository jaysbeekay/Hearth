import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import {
  isBackupConfigured,
  getBackupDestinationChoice,
  getBackupScheduleConfig,
  getS3Config,
  getSftpConfig,
  getLocalConfig,
  isAppSettingSet,
} from "@/lib/appSettings";
import { saveBackupDestination } from "@/lib/actions/app-settings";
import { BackupDestinationForm } from "@/components/AppSettingsForms";
import { BACKUP_DESTINATION_LABELS } from "@/lib/backupDestination";
import { BackupNowForm } from "@/components/BackupNowForm";
import { formatDate, humanFileSize } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Backups" };

export default async function BackupsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [
    logs,
    destination,
    backupOk,
    backupSchedule,
    { dateFormat },
    s3,
    sftp,
    local,
    s3SecretIsSet,
    sftpPasswordIsSet,
    sftpPrivateKeyIsSet,
  ] = await Promise.all([
    prisma.backupLog.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    getBackupDestinationChoice(),
    isBackupConfigured(),
    getBackupScheduleConfig(),
    getUserPreferences(),
    getS3Config(),
    getSftpConfig(),
    getLocalConfig(),
    isAppSettingSet("backup.s3.secretAccessKey"),
    isAppSettingSet("backup.sftp.password"),
    isAppSettingSet("backup.sftp.privateKey"),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Database backups</h1>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Status</h2>
        <ul className="space-y-1 text-sm">
          <li>
            Encryption: {isEncryptionConfigured() ? "configured" : "not configured"}
          </li>
          <li>Backup destination: {BACKUP_DESTINATION_LABELS[destination]}</li>
          <li>Schedule: {backupSchedule.cron}</li>
          <li>Retention: last {backupSchedule.retentionCount} backups</li>
        </ul>

        {!backupOk && (
          <p className="mt-3 text-sm text-warning">
            {isEncryptionConfigured()
              ? "Choose a backup destination below to enable backups."
              : "Set ENCRYPTION_KEY, then choose a backup destination below to enable backups. Backups are never written unencrypted."}
          </p>
        )}

        {backupOk && (
          <div className="mt-4">
            <BackupNowForm />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Backup destination</h2>
          <p className="text-xs text-muted mt-0.5">
            Where encrypted database backups are written. Choose one destination.
          </p>
        </div>
        <BackupDestinationForm
          action={saveBackupDestination}
          current={{
            destination,
            local: { path: local.path },
            s3: {
              endpoint: s3.endpoint,
              region: s3.region,
              bucket: s3.bucket,
              accessKeyId: s3.accessKeyId,
              forcePathStyle: s3.forcePathStyle,
              secretKeyIsSet: s3SecretIsSet,
            },
            sftp: {
              host: sftp.host,
              port: sftp.port,
              username: sftp.username,
              remotePath: sftp.remotePath,
              passwordIsSet: sftpPasswordIsSet,
              privateKeyIsSet: sftpPrivateKeyIsSet,
            },
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Recent runs</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted">No backups have run yet.</p>
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
                  <p className="text-xs text-muted">
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
