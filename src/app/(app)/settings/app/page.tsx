import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getSmtpConfig,
  getNtfyConfig,
  getOllamaConfig,
  getBarcodeConfig,
  getS3Config,
  getSftpConfig,
  getBackupScheduleConfig,
  getReminderConfig,
  isAppSettingSet,
} from "@/lib/appSettings";
import {
  saveSmtpSettings,
  saveNtfySettings,
  saveOllamaSettings,
  saveBarcodeSettings,
  saveS3Settings,
  saveSftpSettings,
  saveScheduleSettings,
  saveAviationStackSettings,
} from "@/lib/actions/app-settings";
import {
  SmtpForm,
  NtfyForm,
  OllamaForm,
  BarcodeForm,
  S3Form,
  SftpForm,
  ScheduleForm,
  AviationStackForm,
} from "@/components/AppSettingsForms";

export const metadata: Metadata = { title: "System settings" };

export default async function AppSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [
    smtp,
    ntfy,
    ollama,
    barcode,
    s3,
    sftp,
    backupSchedule,
    reminder,
    smtpPasswordIsSet,
    ntfyTokenIsSet,
    barcodeApiKeyIsSet,
    s3SecretIsSet,
    sftpPasswordIsSet,
    sftpPrivateKeyIsSet,
    aviationKeyIsSet,
  ] = await Promise.all([
    getSmtpConfig(),
    getNtfyConfig(),
    getOllamaConfig(),
    getBarcodeConfig(),
    getS3Config(),
    getSftpConfig(),
    getBackupScheduleConfig(),
    getReminderConfig(),
    isAppSettingSet("smtp.password"),
    isAppSettingSet("ntfy.token"),
    isAppSettingSet("barcode.apiKey"),
    isAppSettingSet("backup.s3.secretAccessKey"),
    isAppSettingSet("backup.sftp.password"),
    isAppSettingSet("backup.sftp.privateKey"),
    isAppSettingSet("aviationstack.apiKey"),
  ]);

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">System settings</h1>
      <p className="text-sm text-foreground/60">
        Configure application-wide settings. These override environment variables and are stored
        encrypted in the database where applicable.
      </p>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Email (SMTP)</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Used for contract expiry reminders</p>
        </div>
        <SmtpForm
          action={saveSmtpSettings}
          current={{
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            user: smtp.user,
            from: smtp.from,
            passwordIsSet: smtpPasswordIsSet,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Push notifications (ntfy)</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Real-time push alerts via ntfy.sh or self-hosted</p>
        </div>
        <NtfyForm
          action={saveNtfySettings}
          current={{
            url: ntfy.url,
            topic: ntfy.topic,
            tokenIsSet: ntfyTokenIsSet,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Local AI (Ollama)</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Used as a fallback extraction backend when no cloud AI key is set</p>
        </div>
        <OllamaForm
          action={saveOllamaSettings}
          current={{
            baseUrl: ollama.baseUrl,
            model: ollama.model,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Barcode lookup</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Scanned barcode product lookup for the Products module</p>
        </div>
        <BarcodeForm
          action={saveBarcodeSettings}
          current={{
            enabled: barcode.enabled,
            apiKeyIsSet: barcodeApiKeyIsSet,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">S3 backup</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Encrypted offsite backups to S3-compatible storage</p>
        </div>
        <S3Form
          action={saveS3Settings}
          current={{
            endpoint: s3.endpoint,
            region: s3.region,
            bucket: s3.bucket,
            accessKeyId: s3.accessKeyId,
            forcePathStyle: s3.forcePathStyle,
            secretKeyIsSet: s3SecretIsSet,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">SFTP backup</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Encrypted offsite backups via SFTP</p>
        </div>
        <SftpForm
          action={saveSftpSettings}
          current={{
            host: sftp.host,
            port: sftp.port,
            username: sftp.username,
            remotePath: sftp.remotePath,
            passwordIsSet: sftpPasswordIsSet,
            privateKeyIsSet: sftpPrivateKeyIsSet,
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Flight status (AviationStack)</h2>
          <p className="text-xs text-foreground/50 mt-0.5">
            Real-time flight status, gate, and delay data for Travel module flights.{" "}
            <a
              href="https://aviationstack.com/signup/free"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Get a free API key at aviationstack.com
            </a>
          </p>
        </div>
        <AviationStackForm action={saveAviationStackSettings} isKeySet={aviationKeyIsSet} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Schedules</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Cron expressions for reminders and backups</p>
        </div>
        <ScheduleForm
          action={saveScheduleSettings}
          current={{
            reminderCron: reminder.cron,
            reminderDefaultDays: reminder.defaultDays,
            backupCron: backupSchedule.cron,
            retentionCount: backupSchedule.retentionCount,
          }}
        />
      </section>
    </div>
  );
}
