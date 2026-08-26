import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAppUrlConfigured } from "@/lib/env";
import {
  getSmtpConfig,
  getNtfyConfig,
  getOllamaConfig,
  getBarcodeConfig,
  getBackupScheduleConfig,
  getReminderConfig,
  getEmailIngestConfig,
  getAppSetting,
  isAppSettingSet,
} from "@/lib/appSettings";
import {
  saveSmtpSettings,
  saveNtfySettings,
  saveOllamaSettings,
  saveBarcodeSettings,
  saveScheduleSettings,
  saveAviationStackSettings,
  saveEmailIngestSettings,
  testEmailIngestConnection,
} from "@/lib/actions/app-settings";
import {
  SmtpForm,
  NtfyForm,
  OllamaForm,
  BarcodeForm,
  ScheduleForm,
  AviationStackForm,
  EmailIngestForm,
} from "@/components/AppSettingsForms";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { ChatSettingsForm } from "@/components/ChatSettingsForm";
import type { AiProviderId } from "@/lib/ai/types";

export const metadata: Metadata = { title: "System settings" };

// Section headers grouping these forms into the categories called out in
// #175 — this stays one page (rather than splitting into more routes) since
// every section here is a single admin-only form; the categories just make
// the long scroll easier to navigate.
function CategoryHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border pb-2 text-sm font-semibold uppercase tracking-wide text-muted">
      {children}
    </h2>
  );
}

export default async function AppSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [
    smtp,
    ntfy,
    ollama,
    barcode,
    backupSchedule,
    reminder,
    emailIngest,
    aiProvider,
    aiModel,
    chatProvider,
    chatModel,
    smtpPasswordIsSet,
    ntfyTokenIsSet,
    barcodeApiKeyIsSet,
    aviationKeyIsSet,
    aiApiKeyIsSet,
    chatApiKeyIsSet,
    emailIngestPasswordIsSet,
  ] = await Promise.all([
    getSmtpConfig(),
    getNtfyConfig(),
    getOllamaConfig(),
    getBarcodeConfig(),
    getBackupScheduleConfig(),
    getReminderConfig(),
    getEmailIngestConfig(),
    getAppSetting("ai.provider"),
    getAppSetting("ai.model"),
    getAppSetting("chat.provider"),
    getAppSetting("chat.model"),
    isAppSettingSet("smtp.password"),
    isAppSettingSet("ntfy.token"),
    isAppSettingSet("barcode.apiKey"),
    isAppSettingSet("aviationstack.apiKey"),
    isAppSettingSet("ai.apiKey"),
    isAppSettingSet("chat.apiKey"),
    isAppSettingSet("emailIngest.password"),
  ]);

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">System settings</h1>
        <p className="mt-1 text-sm text-muted">
          Configure application-wide settings. These override environment variables and are stored
          encrypted in the database where applicable.
        </p>
      </div>

      <div className="space-y-4">
        <CategoryHeading>Notifications</CategoryHeading>
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
          <div>
            <h3 className="font-medium">Email (SMTP)</h3>
            <p className="text-xs text-muted mt-0.5">Used for contract expiry reminders</p>
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
            appUrlConfigured={isAppUrlConfigured()}
          />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
          <div>
            <h3 className="font-medium">Push notifications (ntfy)</h3>
            <p className="text-xs text-muted mt-0.5">Real-time push alerts via ntfy.sh or self-hosted</p>
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
      </div>

      <div className="space-y-4">
        <CategoryHeading>AI and privacy</CategoryHeading>
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
          <div>
            <h3 className="font-medium">Local AI (Ollama)</h3>
            <p className="text-xs text-muted mt-0.5">Used as a fallback extraction backend when no cloud AI key is set</p>
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
            <h3 className="font-medium">AI document extraction</h3>
            <p className="text-xs text-muted mt-0.5">
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
            <h3 className="font-medium">AI Assistant</h3>
            <p className="text-xs text-muted mt-0.5">
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
      </div>

      <div className="space-y-4">
        <CategoryHeading>Document ingestion</CategoryHeading>
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
          <div>
            <h3 className="font-medium">Email ingestion</h3>
            <p className="text-xs text-muted mt-0.5">
              Forward or email a document to this mailbox and Hearth periodically checks it,
              guesses what type of document it is, and drops it in your Inbox for you to
              confirm — the sender is never trusted, so nothing is ever filed automatically.
            </p>
          </div>
          <EmailIngestForm
            action={saveEmailIngestSettings}
            testAction={testEmailIngestConnection}
            current={{
              host: emailIngest.host,
              port: emailIngest.port,
              secure: emailIngest.secure,
              user: emailIngest.user,
              mailbox: emailIngest.mailbox,
              passwordIsSet: emailIngestPasswordIsSet,
            }}
          />
        </section>
      </div>

      <div className="space-y-4">
        <CategoryHeading>Advanced system settings</CategoryHeading>
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
          <div>
            <h3 className="font-medium">Barcode lookup</h3>
            <p className="text-xs text-muted mt-0.5">Scanned barcode product lookup for the Warranties module</p>
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
            <h3 className="font-medium">Flight status (AviationStack)</h3>
            <p className="text-xs text-muted mt-0.5">
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
            <h3 className="font-medium">Schedules</h3>
            <p className="text-xs text-muted mt-0.5">Cron expressions for reminders and backups</p>
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
    </div>
  );
}
