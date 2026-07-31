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
  getLocalConfig,
  getBackupDestinationChoice,
  getBackupScheduleConfig,
  getReminderConfig,
  getAppSetting,
  isAppSettingSet,
} from "@/lib/appSettings";
import {
  saveSmtpSettings,
  saveNtfySettings,
  saveOllamaSettings,
  saveBarcodeSettings,
  saveBackupDestination,
  saveScheduleSettings,
  saveAviationStackSettings,
} from "@/lib/actions/app-settings";
import {
  SmtpForm,
  NtfyForm,
  OllamaForm,
  BarcodeForm,
  BackupDestinationForm,
  ScheduleForm,
  AviationStackForm,
} from "@/components/AppSettingsForms";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { ChatSettingsForm } from "@/components/ChatSettingsForm";
import type { AiProviderId } from "@/lib/ai/types";

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
    local,
    backupDestination,
    backupSchedule,
    reminder,
    aiProvider,
    aiModel,
    chatProvider,
    chatModel,
    smtpPasswordIsSet,
    ntfyTokenIsSet,
    barcodeApiKeyIsSet,
    s3SecretIsSet,
    sftpPasswordIsSet,
    sftpPrivateKeyIsSet,
    aviationKeyIsSet,
    aiApiKeyIsSet,
    chatApiKeyIsSet,
  ] = await Promise.all([
    getSmtpConfig(),
    getNtfyConfig(),
    getOllamaConfig(),
    getBarcodeConfig(),
    getS3Config(),
    getSftpConfig(),
    getLocalConfig(),
    getBackupDestinationChoice(),
    getBackupScheduleConfig(),
    getReminderConfig(),
    getAppSetting("ai.provider"),
    getAppSetting("ai.model"),
    getAppSetting("chat.provider"),
    getAppSetting("chat.model"),
    isAppSettingSet("smtp.password"),
    isAppSettingSet("ntfy.token"),
    isAppSettingSet("barcode.apiKey"),
    isAppSettingSet("backup.s3.secretAccessKey"),
    isAppSettingSet("backup.sftp.password"),
    isAppSettingSet("backup.sftp.privateKey"),
    isAppSettingSet("aviationstack.apiKey"),
    isAppSettingSet("ai.apiKey"),
    isAppSettingSet("chat.apiKey"),
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
          <h2 className="font-medium">AI document extraction</h2>
          <p className="text-xs text-foreground/50 mt-0.5">
            Bring your own API key to send uploaded documents to a cloud AI provider for
            higher-accuracy field extraction, shared by the whole household. Leave this unset to
            keep using the built-in local extraction only.
          </p>
        </div>
        <AiSettingsForm
          provider={(aiProvider || null) as AiProviderId | null}
          model={aiModel || null}
          apiKeyIsSet={aiApiKeyIsSet}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">AI Assistant</h2>
          <p className="text-xs text-foreground/50 mt-0.5">
            Bring your own API key to enable an assistant that can answer questions using the
            household&apos;s own data — contracts, warranties, trips, vehicles, home, inventory,
            and wealth. It can also propose creating or updating a contract or product, but
            nothing is ever written without the requesting member&apos;s explicit confirmation
            first. Configure a different provider/model here than document extraction if you like
            — the two are independent.
          </p>
        </div>
        <ChatSettingsForm
          provider={(chatProvider || null) as AiProviderId | null}
          model={chatModel || null}
          apiKeyIsSet={chatApiKeyIsSet}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Barcode lookup</h2>
          <p className="text-xs text-foreground/50 mt-0.5">Scanned barcode product lookup for the Warranties module</p>
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
          <h2 className="font-medium">Backup destination</h2>
          <p className="text-xs text-foreground/50 mt-0.5">
            Where encrypted database backups are written. Choose one destination.
          </p>
        </div>
        <BackupDestinationForm
          action={saveBackupDestination}
          current={{
            destination: backupDestination,
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
