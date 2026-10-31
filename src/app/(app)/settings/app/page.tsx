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
  isOllamaConfigured,
} from "@/lib/appSettings";
import { getExtractionCapabilities } from "@/lib/documents/textExtraction";
import { ExtractionCapabilitiesCard } from "@/components/ExtractionCapabilitiesCard";
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
import { HouseholdReminderHealthCard } from "@/components/HouseholdReminderHealthCard";
import { getHouseholdReminderHealth } from "@/lib/notifications/health";
import type { AiProviderId } from "@/lib/ai/types";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { inlineLinkClass } from "@/lib/ui";

export const metadata: Metadata = { title: SETTINGS_ROUTES.app.label };

// Section headers grouping these forms into the categories called out in
// #175 — this stays one page (rather than splitting into more routes) since
// every section here is a single admin-only form; the categories just make
// the long scroll easier to navigate.
function CategoryHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border pb-2 text-sm font-medium text-muted">
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
    reminderHealth,
    extractionCapabilities,
    ollamaConfigured,
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
    getHouseholdReminderHealth(),
    getExtractionCapabilities(),
    isOllamaConfigured(),
  ]);

  return (
    <PageShell width="form">
      <div>
        <BackLink {...settingsBackLink(SETTINGS_ROUTES.app)} />
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.app.label}</h1>
        <p className="mt-1 text-sm text-muted">
          Configure application-wide settings. These override environment variables and are stored
          encrypted in the database where applicable.
        </p>
      </div>

      <div className="space-y-4">
        <CategoryHeading>Notifications</CategoryHeading>
        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">Email (SMTP)</h3>
            <p className="text-xs text-muted mt-0.5">Used to send reminders</p>
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
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">Push notifications (ntfy)</h3>
            <p className="text-xs text-muted mt-0.5">Real-time push via ntfy.sh or a self-hosted ntfy server</p>
          </div>
          <NtfyForm
            action={saveNtfySettings}
            current={{
              url: ntfy.url,
              topic: ntfy.topic,
              tokenIsSet: ntfyTokenIsSet,
            }}
          />
        </Card>
      </div>

      <div className="space-y-4">
        <CategoryHeading>AI and privacy</CategoryHeading>
        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">Document text extraction</h3>
            <p className="text-xs text-muted mt-0.5">
              Local tools this server uses to read uploaded documents before any AI is involved
            </p>
          </div>
          <ExtractionCapabilitiesCard
            capabilities={extractionCapabilities}
            aiKeySet={aiApiKeyIsSet && Boolean(aiProvider)}
            ollamaConfigured={ollamaConfigured}
          />
        </Card>

        <Card as="section" className="space-y-4">
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
        </Card>

        <Card as="section" className="space-y-4">
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
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">AI Assistant</h3>
            <p className="text-xs text-muted mt-0.5">
              Bring your own API key to enable an assistant that can answer questions using the
              household&apos;s own data — contracts, warranties, trips, vehicles, properties,
              inventory and wealth. It can also propose creating or updating a contract or warranty, but
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
        </Card>
      </div>

      <div className="space-y-4">
        <CategoryHeading>Document ingestion</CategoryHeading>
        <Card as="section" className="space-y-4">
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
        </Card>
      </div>

      <div className="space-y-4">
        <CategoryHeading>Advanced system settings</CategoryHeading>
        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">Barcode lookup</h3>
            <p className="text-xs text-muted mt-0.5">Looks up a scanned barcode when adding a warranty</p>
          </div>
          <BarcodeForm
            action={saveBarcodeSettings}
            current={{
              enabled: barcode.enabled,
              apiKeyIsSet: barcodeApiKeyIsSet,
            }}
          />
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-medium">Flight status (AviationStack)</h3>
            <p className="text-xs text-muted mt-0.5">
              Real-time flight status, gate, and delay data for Travel module flights.{" "}
              <a
                href="https://aviationstack.com/signup/free"
                target="_blank"
                rel="noopener noreferrer"
                className={inlineLinkClass}
              >
                Get a free API key at aviationstack.com
              </a>
            </p>
          </div>
          <AviationStackForm action={saveAviationStackSettings} isKeySet={aviationKeyIsSet} />
        </Card>

        <Card as="section" className="space-y-4">
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
        </Card>

        <HouseholdReminderHealthCard
          health={reminderHealth}
          appUrlConfigured={isAppUrlConfigured()}
        />
      </div>
    </PageShell>
  );
}
