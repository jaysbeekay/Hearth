import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { env } from "@/lib/env";
import { isSmtpConfigured, isNtfyConfigured, getHouseholdTimeZone } from "@/lib/appSettings";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { TotpSection } from "@/components/TotpSection";
import { NotificationPreferencesForm } from "@/components/NotificationPreferencesForm";
import { PushDeviceToggle } from "@/components/PushDeviceToggle";
import { getVapidPublicKey } from "@/lib/notifications/push";
import { PreferencesForm } from "@/components/PreferencesForm";
import { OfflineDocumentsPanel } from "@/components/OfflineDocumentsPanel";
import { UnconfiguredNotice } from "@/components/UnconfiguredNotice";
import { ROLE_LABELS } from "@/lib/utils";
import { SETTINGS_ROUTES } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { hashToken } from "@/lib/crypto";

export const metadata: Metadata = { title: SETTINGS_ROUTES.settings.label };

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

  const [user, smtpConfigured, ntfyConfigured, householdTimeZone, vapidPublicKey, pushRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getHouseholdTimeZone(),
    getVapidPublicKey(),
    // #375 — the member's own devices only; other members' stay private.
    prisma.pushSubscription.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        endpoint: true,
        deviceLabel: true,
        createdAt: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        lastError: true,
      },
    }),
  ]);
  if (!user) redirect("/login");
  // Endpoints are capability URLs: the page gets only their hashes.
  const pushDevices = pushRows.map(({ endpoint, ...device }) => ({ ...device, endpointHash: hashToken(endpoint) }));
  const appUrl = env.appUrl ?? "http://localhost:3000";

  return (
    <PageShell width="form">
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.settings.label}</h1>
      <p className="text-sm text-muted">
        These settings only affect your own account, not the rest of the household. Settings shared by everyone
        are in{" "}
        <Link href={SETTINGS_ROUTES.household.href} className="underline">
          {SETTINGS_ROUTES.household.label}
        </Link>
        .
      </p>

      <SaveChangesGroup>
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
          </Card>

          <Card as="section">
            <h2 className="mb-3 font-medium">Reminders</h2>
            <p className="mb-3 text-sm text-muted">
              Reminders are sent to each device with notifications on
              {smtpConfigured && ntfyConfigured ? ", by email and by ntfy" : smtpConfigured ? " and by email" : ntfyConfigured ? " and by ntfy" : ""}.{" "}
              {!smtpConfigured && !ntfyConfigured && (
                <span className="text-warning">
                  Email and ntfy aren&apos;t set up
                  {user.role === "ADMIN" ? (
                    <>
                      {" "}
                      — set them up in{" "}
                      <Link href={SETTINGS_ROUTES.reminders.href} className="underline">
                        {SETTINGS_ROUTES.reminders.label}
                      </Link>
                      .
                    </>
                  ) : (
                    " — ask an admin if you'd like them."
                  )}
                </span>
              )}
            </p>
            <div className="space-y-3">
              <PushDeviceToggle vapidPublicKey={vapidPublicKey} devices={pushDevices} />
              <NotificationPreferencesForm emailReminders={user.emailReminders} />
            </div>
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
                <Link href={SETTINGS_ROUTES.household.href} className="underline">
                  Change it in {SETTINGS_ROUTES.household.label}.
                </Link>
              ) : (
                "Only an admin can change it."
              )}
            </p>
          </Card>
        </div>
      </SaveChangesGroup>

      <div className="grid gap-6 md:grid-cols-2">
        <Card as="section">
          <h2 className="mb-3 font-medium">Sign-in and security</h2>
          <Link href={SETTINGS_ROUTES.passkeys.href} className={quickLinkClass}>
            <KeyRound size={16} />
            {SETTINGS_ROUTES.passkeys.label}
          </Link>

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-medium">Two-factor authentication</h3>
            {isEncryptionConfigured() ? (
              <TotpSection enabled={user.totpEnabled} />
            ) : (
              <UnconfiguredNotice feature="two-factor authentication" />
            )}
          </div>
        </Card>

        <Card as="section">
          <h2 className="mb-3 font-medium">Change password</h2>
          <ChangePasswordForm />
        </Card>

        <IcalTokenSection hasToken={Boolean(user.icalTokenHash)} appUrl={appUrl} />

        <OfflineDocumentsPanel />
      </div>
    </PageShell>
  );
}
