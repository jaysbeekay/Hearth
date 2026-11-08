import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  Coins,
  DatabaseBackup,
  Globe,
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
  getHouseholdCurrency,
  getHouseholdCurrencyFallback,
} from "@/lib/appSettings";
import { saveHouseholdCurrency, saveHouseholdTimeZone } from "@/lib/actions/app-settings";
import { HouseholdCurrencyForm, HouseholdTimeZoneForm } from "@/components/AppSettingsForms";
import { currencyLabel } from "@/components/CurrencySelect";
import { isCurrencyCode } from "@/lib/currencyCodes";
import { householdTimeZoneChoices } from "@/lib/timezones";
import { BACKUP_DESTINATION_LABELS } from "@/lib/backupDestination";
import { AI_PROVIDER_LABELS } from "@/lib/ai/types";
import { activeChannels } from "@/lib/notifications/channels";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { describeSchedule } from "@/lib/cronSchedule";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import { SETTINGS_ROUTES, type SettingsRoute } from "@/lib/routeLabels";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { SettingsDisclosure, SettingsLinkRow, SettingsRowList } from "@/components/SettingsRows";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.household.label };

interface Section {
  route: SettingsRoute;
  icon: LucideIcon;
  summary: string;
  /** Members see it greyed out, with "Admin only". */
  adminOnly: boolean;
}

// #363 — Household settings: everything shared by the household, in one
// list (its own screen and nav entry since the My account split). It replaces the old "Household & System" hub and the long "System
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
    savedCurrency,
    householdCurrency,
    currencyFallback,
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
    getAppSetting("household.currency"),
    getHouseholdCurrency(),
    getHouseholdCurrencyFallback(),
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
      summary: "Sign-ins, account changes and auto-fill confirmations",
      adminOnly: true,
    },
    {
      route: SETTINGS_ROUTES.trash,
      icon: Trash2,
      summary: `Kept for ${TRASH_RETENTION_DAYS} days`,
      adminOnly: false,
    },
  ];

  const linkRows = sections.map(({ route, icon, summary, adminOnly }) => (
    <SettingsLinkRow
      key={route.href}
      href={route.href}
      icon={icon}
      label={route.label}
      summary={summary}
      locked={adminOnly && !isAdmin}
    />
  ));

  return (
    <PageShell width="form">
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.household.label}</h1>
      <p className="text-sm text-muted">
        Settings shared by the whole household. Your own sign-in, notifications and preferences are in{" "}
        <Link href={SETTINGS_ROUTES.settings.href} className="underline">
          {SETTINGS_ROUTES.settings.label}
        </Link>
        .
        {!isAdmin && " Only an admin can change the greyed-out sections."}
      </p>

      {/* One list: the rows that open their own page, then timezone and
          currency, which drop down in place like the rows on My account. */}
      {isAdmin ? (
        <SaveChangesGroup>
          <SettingsRowList>
            {linkRows}
            <SettingsDisclosure id="timezone" icon={Globe} label="Household timezone" summary={householdTimeZone}>
              <div className="space-y-4">
                <TimeZoneHint />
                <HouseholdTimeZoneForm
                  action={saveHouseholdTimeZone}
                  current={savedTimeZone}
                  serverDefault={getServerDefaultTimeZone()}
                  choices={householdTimeZoneChoices(savedTimeZone)}
                />
              </div>
            </SettingsDisclosure>
            <SettingsDisclosure id="currency" icon={Coins} label="Household currency" summary={householdCurrency}>
              <div className="space-y-4">
                <CurrencyHint />
                <HouseholdCurrencyForm
                  action={saveHouseholdCurrency}
                  current={isCurrencyCode(savedCurrency) ? savedCurrency.toUpperCase() : ""}
                  fallback={currencyFallback}
                />
              </div>
            </SettingsDisclosure>
          </SettingsRowList>
        </SaveChangesGroup>
      ) : (
        <SettingsRowList>
          {linkRows}
          <SettingsDisclosure id="timezone" icon={Globe} label="Household timezone" summary={householdTimeZone}>
            <div className="space-y-2">
              <TimeZoneHint />
              <p className="text-sm">
                {householdTimeZone}. <span className="text-muted">Only an admin can change it.</span>
              </p>
            </div>
          </SettingsDisclosure>
          <SettingsDisclosure id="currency" icon={Coins} label="Household currency" summary={householdCurrency}>
            <div className="space-y-2">
              <CurrencyHint />
              <p className="text-sm">
                {currencyLabel(householdCurrency)}. <span className="text-muted">Only an admin can change it.</span>
              </p>
            </div>
          </SettingsDisclosure>
        </SettingsRowList>
      )}
    </PageShell>
  );
}

function TimeZoneHint() {
  return (
    <p className="text-xs text-muted">
      Reminders and due dates will use this timezone, so every member counts days the same way.
      Each member&apos;s own timezone only changes how times are shown to them.
    </p>
  );
}

function CurrencyHint() {
  return (
    <p className="text-xs text-muted">
      Spend totals for the whole household, such as the MCP spend summary, use this currency, and new members
      start with it. Each member can still pick their own currency in My account.
    </p>
  );
}
