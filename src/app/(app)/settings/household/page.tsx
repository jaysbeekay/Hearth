import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DatabaseBackup, LayoutGrid, Settings2, Users, Webhook } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBackupConfigured, getBackupDestinationChoice, isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { BACKUP_DESTINATION_LABELS } from "@/lib/backupDestination";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

export const metadata: Metadata = { title: "Household & System settings" };

// min-h-11 (44px) keeps these comfortably tappable on mobile even though
// they're plain text links, not buttons.
const quickLinkClass =
  "flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5";

export default async function HouseholdSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [memberCount, backupConfigured, backupDestination, webhookCount, enabledModules, smtpConfigured, ntfyConfigured] =
    await Promise.all([
      prisma.user.count(),
      isBackupConfigured(),
      getBackupDestinationChoice(),
      prisma.webhookEndpoint.count(),
      getEnabledModuleKeys(),
      isSmtpConfigured(),
      isNtfyConfigured(),
    ]);
  const notificationsConfigured = smtpConfigured || ntfyConfigured;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-muted hover:text-foreground">
          ← Back to Settings
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Household &amp; System</h1>
        <p className="mt-1 text-sm text-muted">
          Settings shared by the whole household, not just your own account.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Link href="/settings/users" className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Users size={18} />
            Manage household members
          </span>
          <span className="text-xs font-normal text-muted">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        </Link>
        <Link href="/settings/backups" className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <DatabaseBackup size={18} />
            Database backups
          </span>
          <span className={`text-xs font-normal ${backupConfigured ? "text-muted" : "text-warning"}`}>
            {backupConfigured ? BACKUP_DESTINATION_LABELS[backupDestination] : "Not configured"}
          </span>
        </Link>
        <Link href="/settings/webhooks" className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Webhook size={18} />
            Webhooks
          </span>
          <span className="text-xs font-normal text-muted">
            {webhookCount === 0 ? "None configured" : `${webhookCount} configured`}
          </span>
        </Link>
        <Link href="/settings/modules" className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <LayoutGrid size={18} />
            Modules
          </span>
          <span className="text-xs font-normal text-muted">
            {enabledModules.size} of {Object.keys(MODULE_REGISTRY).length} enabled
          </span>
        </Link>
        <Link href="/settings/app" className={quickLinkClass}>
          <span className="flex items-center gap-3">
            <Settings2 size={18} />
            System settings
          </span>
          <span className={`text-xs font-normal ${notificationsConfigured ? "text-muted" : "text-warning"}`}>
            {notificationsConfigured ? "Notifications configured" : "Notifications not configured"}
          </span>
        </Link>
      </div>
    </div>
  );
}
