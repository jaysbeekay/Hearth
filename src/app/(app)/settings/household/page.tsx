import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  DatabaseBackup,
  History,
  Inbox,
  LayoutGrid,
  Plug,
  Sparkles,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isBackupConfigured,
  getBackupDestinationChoice,
  getBackupScheduleConfig,
  getReminderConfig,
  isEmailIngestionConfigured,
  getAppSetting,
  getHouseholdTimeZone,
  getServerDefaultTimeZone,
} from "@/lib/appSettings";
import { saveHouseholdTimeZone } from "@/lib/actions/app-settings";
import { HouseholdTimeZoneForm } from "@/components/AppSettingsForms";
import { householdTimeZoneChoices } from "@/lib/timezones";
import { BACKUP_DESTINATION_LABELS } from "@/lib/backupDestination";
import { AI_PROVIDER_LABELS } from "@/lib/ai/types";
import { activeChannels } from "@/lib/notifications/channels";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { describeSchedule } from "@/lib/cronSchedule";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import { SETTINGS_ROUTES, type SettingsRoute } from "@/lib/routeLabels";
import { SettingsTabs } from "@/components/SettingsTabs";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { cardClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.household.label };

interface Section {
  route: SettingsRoute;
  icon: LucideIcon;
  summary: string;
  /** Members see it greyed out, with "Admin only". */
  adminOnly: boolean;
}

// min-h-11 (44px) keeps each row comfortably tappable on mobile.
const rowClass = "flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm font-medium";

// #363 — the Household tab: everything shared by the household, in one
// list. It replaces the old "Household & System" hub and the long "System
// settings" page, which is split into the sections below. Members see the
// whole list so they know what exists; the admin-only sections are greyed.
export default async function HouseholdSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin = session.user.role === "ADMIN";

  const [
    memberCount,
    backupConfigured,
    backupDestination,
    backupSchedule,
    reminder,
    webhookCount,
    enabledModules,
    active,
    ingestConfigured,
    aiProvider,
    savedTimeZone,
    householdTimeZone,
  ] = await Promise.all([
    prisma.user.count(),
    isBackupConfigured(),
    getBackupDestinationChoice(),
    getBackupScheduleConfig(),
    getReminderConfig(),
    prisma.webhookEndpoint.count(),
    getEnabledModuleKeys(),
    activeChannels(),
    isEmailIngestionConfigured(),
    getAppSetting("ai.provider"),
    getAppSetting("household.timezone"),
    getHouseholdTimeZone(),
  ]);

  // What the scheduler will actually send on, as the Reminders health card
  // reports it: a disabled webhook or SMTP nobody gets reminders from is left out.
  const channels = [active.email && "Email", active.ntfy && "ntfy", active.webhook && "Webhook"].filter(Boolean);
  // Looked up through a Map rather than by a variable object key.
  const aiLabel = new Map<string, string>(Object.entries(AI_PROVIDER_LABELS)).get(aiProvider);

  const sections: Section[] = [
    {
      route: SETTINGS_ROUTES.users,
      icon: Users,
      summary: `${memberCount} ${memberCount === 1 ? "member" : "members"}`,
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.modules,
      icon: LayoutGrid,
      summary: `${enabledModules.size} of ${Object.keys(MODULE_REGISTRY).length} on`,
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.reminders,
      icon: BellRing,
      summary:
        channels.length > 0
          ? `${channels.join(" + ")} · ${describeSchedule(reminder.cron)}`
          : "No channel set up",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.ai,
      icon: Sparkles,
      summary: aiLabel ? `AI: ${aiLabel}` : "Local extraction only",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.ingestion,
      icon: Inbox,
      summary: ingestConfigured ? "Email ingestion on" : "Not set up",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.integrations,
      icon: Plug,
      summary: webhookCount === 0 ? "No webhooks" : `${webhookCount} ${webhookCount === 1 ? "webhook" : "webhooks"}`,
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.backups,
      icon: DatabaseBackup,
      summary: backupConfigured
        ? `${new Map<string, string>(Object.entries(BACKUP_DESTINATION_LABELS)).get(backupDestination)} · ${describeSchedule(backupSchedule.cron)}`
        : "Not set up",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.security,
      icon: History,
      summary: "Sign-ins and account changes",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.trash,
      icon: Trash2,
      summary: `Kept for ${TRASH_RETENTION_DAYS} days`,
      adminOnly: false,
    },
  ];

  return (
    <PageShell width="form">
      <h1 className="text-2xl font-medium">Settings</h1>
      <SettingsTabs active="household" />
      <p className="text-sm text-muted">
        Settings shared by the whole household.
        {!isAdmin && " Only an admin can change the greyed-out sections."}
      </p>

      <ul className="flex flex-col gap-2">
        {sections.map(({ route, icon: Icon, summary, adminOnly }) => {
          const label = (
            <span className="flex items-center gap-3">
              <Icon size={20} aria-hidden />
              {route.label}
            </span>
          );
          return (
            <li key={route.href}>
              {adminOnly && !isAdmin ? (
                <div
                  aria-disabled="true"
                  className={cardClass({ padding: "none" }, `${rowClass} text-muted opacity-60`)}
                >
                  {label}
                  <Pill>Admin only</Pill>
                </div>
              ) : (
                <Link href={route.href} className={cardClass({ padding: "none", interactive: true }, rowClass)}>
                  {label}
                  <span className="min-w-0 truncate text-right text-xs font-normal text-muted">{summary}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {isAdmin ? (
        <SaveChangesGroup>
          <Card as="section" className="space-y-4">
            <TimeZoneHeading />
            <HouseholdTimeZoneForm
              action={saveHouseholdTimeZone}
              current={savedTimeZone}
              serverDefault={getServerDefaultTimeZone()}
              choices={householdTimeZoneChoices(savedTimeZone)}
            />
          </Card>
        </SaveChangesGroup>
      ) : (
        <Card as="section" className="space-y-4">
          <TimeZoneHeading />
          <p className="text-sm">
            {householdTimeZone}. <span className="text-muted">Only an admin can change it.</span>
          </p>
        </Card>
      )}
    </PageShell>
  );
}

function TimeZoneHeading() {
  return (
    <div>
      <h2 className="font-medium">Household timezone</h2>
      <p className="text-xs text-muted mt-0.5">
        Reminders and due dates will use this timezone, so every member counts days the same way.
        Each member&apos;s own timezone only changes how times are shown to them.
      </p>
    </div>
  );
}
