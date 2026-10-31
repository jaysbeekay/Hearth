import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, KeyRound, History, Trash2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { env } from "@/lib/env";
import { isSmtpConfigured, isNtfyConfigured, getHouseholdTimeZone } from "@/lib/appSettings";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { TotpSection } from "@/components/TotpSection";
import { NotificationPreferencesForm } from "@/components/NotificationPreferencesForm";
import { PreferencesForm } from "@/components/PreferencesForm";
import { OfflineDocumentsPanel } from "@/components/OfflineDocumentsPanel";
import { UnconfiguredNotice } from "@/components/UnconfiguredNotice";
import { ROLE_LABELS } from "@/lib/utils";
import { SETTINGS_ROUTES } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Settings" };

// min-h-11 (44px) keeps these comfortably tappable on mobile even though
// they're plain text links, not buttons.
const quickLinkClass =
  "flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-accent hover:bg-hover";

export default async function SettingsPage() {
  const session = await auth();
  // auth() can now return null mid-render — a session is revoked as soon as
  // the account's sessionVersion moves (password/role change) or the account
  // is deleted, which the proxy won't have caught for an in-flight request.
  if (!session?.user) redirect("/login");

  const [user, smtpConfigured, ntfyConfigured, householdTimeZone] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getHouseholdTimeZone(),
  ]);
  if (!user) redirect("/login");
  const appUrl = env.appUrl ?? "http://localhost:3000";

  return (
    <PageShell width="form">
      <h1 className="text-2xl font-medium">Settings</h1>
      <p className="text-sm text-muted">
        These settings only affect your own account, not the rest of the household.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card as="section">
          <h2 className="mb-3 font-medium">Profile</h2>
          <dl className="grid gap-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted">Name</dt>
              <dd className="text-sm font-medium break-words">{user.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Email</dt>
              <dd className="text-sm font-medium break-words">{user.email}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Role</dt>
              <dd className="text-sm font-medium">{ROLE_LABELS[user.role] ?? user.role}</dd>
            </div>
          </dl>
          {user.role === "ADMIN" && (
            <Link
              href="/settings/household"
              className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-accent hover:bg-hover"
            >
              <ArrowRight size={16} />
              {SETTINGS_ROUTES.household.label}
            </Link>
          )}
        </Card>

        <Card as="section">
          <h2 className="mb-3 font-medium">Reminders</h2>
          <p className="mb-3 text-sm text-muted">
            Reminders are sent by email{ntfyConfigured ? " and push (ntfy)" : ""}.{" "}
            {!smtpConfigured && !ntfyConfigured && (
              <span className="text-warning">
                No reminder channel is configured yet
                {user.role === "ADMIN" ? (
                  <>
                    {" "}
                    — configure SMTP or ntfy in{" "}
                    <Link href="/settings/app" className="underline">{SETTINGS_ROUTES.app.label}</Link>.
                  </>
                ) : (
                  " — ask an admin to configure SMTP or ntfy."
                )}
              </span>
            )}
          </p>
          <NotificationPreferencesForm emailReminders={user.emailReminders} />
        </Card>

        <Card as="section" className="md:col-span-2">
          <h2 className="mb-3 font-medium">Preferences</h2>
          <p className="mb-3 text-sm text-muted">
            Localisation used throughout the app — dates, default currency for new records, your
            timezone, and the region convention used for number formatting (decimal/thousands
            separators). This doesn&apos;t change the app&apos;s display language.
          </p>
          <PreferencesForm
            dateFormat={user.dateFormat}
            preferredCurrency={user.preferredCurrency}
            timezone={user.timezone}
            householdTimeZone={householdTimeZone}
            region={user.region}
          />
          <p className="mt-4 text-xs text-muted">
            The household timezone is {householdTimeZone}. Reminders and due dates will use it.{" "}
            {user.role === "ADMIN" ? (
              <Link href="/settings/household" className="underline">Change it in {SETTINGS_ROUTES.household.label}.</Link>
            ) : (
              "Only an admin can change it."
            )}
          </p>
        </Card>

        <Card as="section">
          <h2 className="mb-3 font-medium">Security</h2>
          <div className="flex flex-col gap-1">
            <Link href={SETTINGS_ROUTES.passkeys.href} className={quickLinkClass}>
              <KeyRound size={16} />
              {SETTINGS_ROUTES.passkeys.label}
            </Link>
            {user.role === "ADMIN" && (
              <Link href={SETTINGS_ROUTES.security.href} className={quickLinkClass}>
                <History size={16} />
                {SETTINGS_ROUTES.security.label}
              </Link>
            )}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-medium">Two-factor authentication</h3>
            {isEncryptionConfigured() ? (
              <TotpSection enabled={user.totpEnabled} />
            ) : (
              <UnconfiguredNotice feature="two-factor authentication" />
            )}
          </div>
        </Card>

        <IcalTokenSection hasToken={Boolean(user.icalTokenHash)} appUrl={appUrl} />

        <Card as="section">
          <h2 className="mb-3 font-medium">Trash</h2>
          <p className="mb-3 text-sm text-muted">
            Deleted contracts, warranties, vehicles, properties, trips, and inventory items stay
            here for 30 days before they&apos;re removed for good.
          </p>
          <Link href={SETTINGS_ROUTES.trash.href} className={quickLinkClass}>
            <Trash2 size={16} />
            {SETTINGS_ROUTES.trash.label}
          </Link>
        </Card>

        <OfflineDocumentsPanel />

        <Card as="section">
          <h2 className="mb-3 font-medium">Change password</h2>
          <ChangePasswordForm />
        </Card>
      </div>
    </PageShell>
  );
}
