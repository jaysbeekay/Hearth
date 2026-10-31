import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DatabaseBackup, LayoutGrid, Settings2, Users, Webhook } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isBackupConfigured,
  getBackupDestinationChoice,
  isSmtpConfigured,
  isNtfyConfigured,
  getAppSetting,
  getServerDefaultTimeZone,
} from "@/lib/appSettings";
import { saveHouseholdTimeZone } from "@/lib/actions/app-settings";
import { HouseholdTimeZoneForm } from "@/components/AppSettingsForms";
import { householdTimeZoneChoices } from "@/lib/timezones";
import { BACKUP_DESTINATION_LABELS } from "@/lib/backupDestination";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: SETTINGS_ROUTES.household.label };

// min-h-11 (44px) keeps these comfortably tappable on mobile even though
// they're plain text links, not buttons.
const quickLinkClass =
  "flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm font-medium hover:bg-hover";

export default async function HouseholdSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [
    memberCount,
    backupConfigured,
    backupDestination,
    webhookCount,
    enabledModules,
    smtpConfigured,
    ntfyConfigured,
    householdTimeZone,
  ] = await Promise.all([
    prisma.user.count(),
    isBackupConfigured(),
    getBackupDestinationChoice(),
    prisma.webhookEndpoint.count(),
    getEnabledModuleKeys(),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getAppSetting("household.timezone"),
  ]);
  const notificationsConfigured = smtpConfigured || ntfyConfigured;

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.household)} />
      <div>
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.household.label}</h1>
        <p className="mt-1 text-sm text-muted">
          Settings shared by the whole household, not just your own account.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Link href={SETTINGS_ROUTES.users.href} className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Users size={20} />
            {SETTINGS_ROUTES.users.label}
          </span>
          <span className="text-xs font-normal text-muted">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        </Link>
        <Link href={SETTINGS_ROUTES.backups.href} className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <DatabaseBackup size={20} />
            {SETTINGS_ROUTES.backups.label}
          </span>
          <span className="text-xs font-normal text-muted">
            {backupConfigured ? BACKUP_DESTINATION_LABELS[backupDestination] : "Not configured"}
          </span>
        </Link>
        <Link href={SETTINGS_ROUTES.webhooks.href} className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Webhook size={20} />
            {SETTINGS_ROUTES.webhooks.label}
          </span>
          <span className="text-xs font-normal text-muted">
            {webhookCount === 0 ? "None configured" : `${webhookCount} configured`}
          </span>
        </Link>
        <Link href={SETTINGS_ROUTES.modules.href} className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <LayoutGrid size={20} />
            {SETTINGS_ROUTES.modules.label}
          </span>
          <span className="text-xs font-normal text-muted">
            {enabledModules.size} of {Object.keys(MODULE_REGISTRY).length} enabled
          </span>
        </Link>
        <Link href={SETTINGS_ROUTES.app.href} className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Settings2 size={20} />
            {SETTINGS_ROUTES.app.label}
          </span>
          <span className="text-xs font-normal text-muted">
            {notificationsConfigured ? "Notifications configured" : "Notifications not configured"}
          </span>
        </Link>
      </div>

      <Card as="section" className="space-y-4">
        <div>
          <h2 className="font-medium">Household timezone</h2>
          <p className="text-xs text-muted mt-0.5">
            Reminders and due dates will use this timezone, so every member counts days the
            same way. Each member&apos;s own timezone only changes how times are shown to them.
          </p>
        </div>
        <HouseholdTimeZoneForm
          action={saveHouseholdTimeZone}
          current={householdTimeZone}
          serverDefault={getServerDefaultTimeZone()}
          choices={householdTimeZoneChoices(householdTimeZone)}
        />
      </Card>
    </div>
  );
}
