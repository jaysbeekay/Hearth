import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAppUrlConfigured } from "@/lib/env";
import {
  getSmtpConfig,
  getNtfyConfig,
  getReminderConfig,
  getServerDefaultTimeZone,
  isAppSettingSet,
} from "@/lib/appSettings";
import { saveSmtpSettings, saveNtfySettings, saveReminderSchedule } from "@/lib/actions/app-settings";
import { SmtpForm, NtfyForm, ReminderScheduleForm } from "@/components/AppSettingsForms";
import { HouseholdReminderHealthCard } from "@/components/HouseholdReminderHealthCard";
import { getHouseholdReminderHealth } from "@/lib/notifications/health";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.reminders.label };

// #363 — delivery health first, so an admin fixing notifications sees what's
// wrong before the forms; then the channels and the schedule.
export default async function ReminderSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [smtp, ntfy, reminder, smtpPasswordIsSet, ntfyTokenIsSet, reminderHealth] = await Promise.all([
    getSmtpConfig(),
    getNtfyConfig(),
    getReminderConfig(),
    isAppSettingSet("smtp.password"),
    isAppSettingSet("ntfy.token"),
    getHouseholdReminderHealth(),
  ]);

  return (
    <PageShell width="form">
      <div>
        <BackLink {...settingsBackLink(SETTINGS_ROUTES.reminders)} />
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.reminders.label}</h1>
        <p className="mt-1 text-sm text-muted">
          How the household gets its reminders, and when they go out.
        </p>
      </div>

      <HouseholdReminderHealthCard health={reminderHealth} appUrlConfigured={isAppUrlConfigured()} />

      <SaveChangesGroup>
        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">Email (SMTP)</h2>
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
            <h2 className="font-medium">Push notifications (ntfy)</h2>
            <p className="text-xs text-muted mt-0.5">Real-time push via ntfy.sh or a self-hosted ntfy server</p>
          </div>
          <NtfyForm
            action={saveNtfySettings}
            current={{ url: ntfy.url, topic: ntfy.topic, tokenIsSet: ntfyTokenIsSet }}
          />
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h2 className="font-medium">Schedule</h2>
            <p className="text-xs text-muted mt-0.5">
              When Hearth checks for reminders to send. Webhooks are under{" "}
              {SETTINGS_ROUTES.integrations.label}.
            </p>
          </div>
          <ReminderScheduleForm
            action={saveReminderSchedule}
            current={{ cron: reminder.cron, defaultDays: reminder.defaultDays }}
            serverTimeZone={getServerDefaultTimeZone()}
          />
        </Card>
      </SaveChangesGroup>
    </PageShell>
  );
}
