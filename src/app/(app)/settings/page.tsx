import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing, CalendarDays, HardDriveDownload, KeyRound, Lock, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { env } from "@/lib/env";
import { isSmtpConfigured, isNtfyConfigured, getHouseholdTimeZone, getHouseholdCurrency } from "@/lib/appSettings";
import { followsHouseholdTimeZone } from "@/lib/timezones";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { TotpSection } from "@/components/TotpSection";
import { NotificationPreferencesForm } from "@/components/NotificationPreferencesForm";
import { PushDeviceToggle } from "@/components/PushDeviceToggle";
import { getVapidPublicKey, ownPushDevices } from "@/lib/notifications/push";
import { PreferencesForm } from "@/components/PreferencesForm";
import { OfflineDocumentsPanel } from "@/components/OfflineDocumentsPanel";
import { UnconfiguredNotice } from "@/components/UnconfiguredNotice";
import { ROLE_LABELS } from "@/lib/utils";
import { SETTINGS_ROUTES } from "@/lib/routeLabels";
import { SettingsDisclosure, SettingsLinkRow, SettingsRowList } from "@/components/SettingsRows";
import { PageShell } from "@/components/ui/PageShell";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";

export const metadata: Metadata = { title: SETTINGS_ROUTES.settings.label };

export default async function SettingsPage() {
  const session = await auth();
  // auth() can now return null mid-render — a session is revoked as soon as
  // the account's sessionVersion moves (password/role change) or the account
  // is deleted, which the proxy won't have caught for an in-flight request.
  if (!session?.user) redirect("/login");

  const [user, smtpConfigured, ntfyConfigured, householdTimeZone, householdCurrency, vapidPublicKey, pushDevices, passkeyCount] =
    await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getHouseholdTimeZone(),
    getHouseholdCurrency(),
    getVapidPublicKey(),
    // #375 — the member's own devices only; other members' stay private.
    ownPushDevices(session.user.id),
    prisma.passkeyCredential.count({ where: { userId: session.user.id } }),
  ]);
  if (!user) redirect("/login");
  const appUrl = env.appUrl ?? "http://localhost:3000";

  const pushOn = pushDevices.length;
  const prefsSummary = [
    user.dateFormat,
    user.preferredCurrency,
    followsHouseholdTimeZone(user.timezone) ? "Household timezone" : user.timezone,
  ].join(" · ");

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
        <SettingsRowList>
          <SettingsDisclosure id="profile" icon={UserRound} label="Profile" summary={user.email}>
            <dl className="grid gap-3 sm:grid-cols-3">
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
          </SettingsDisclosure>

          <SettingsDisclosure
            id="notifications"
            icon={BellRing}
            label="Notifications"
            summary={[
              user.emailReminders ? "Email on" : "Email off",
              `${pushOn} ${pushOn === 1 ? "device" : "devices"}`,
            ].join(" · ")}
          >
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
                        {SETTINGS_ROUTES.household.label} → {SETTINGS_ROUTES.reminders.label}
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
          </SettingsDisclosure>

          <SettingsDisclosure id="preferences" icon={SlidersHorizontal} label="Preferences" summary={prefsSummary}>
            <p className="mb-3 text-sm text-muted">
              How the app shows things to you: dates, your default currency for new records, your timezone, and
              number formatting (decimal and thousands separators). This doesn&apos;t change the app&apos;s
              display language.
            </p>
            <PreferencesForm
              dateFormat={user.dateFormat}
              preferredCurrency={user.preferredCurrency}
              timezone={user.timezone}
              householdTimeZone={householdTimeZone}
              region={user.region}
            />
            <p className="mt-4 text-xs text-muted">
              The household timezone is {householdTimeZone}. The household currency is {householdCurrency}.
              Reminders, due dates and household totals use those, whatever you pick here.{" "}
              {user.role === "ADMIN" ? (
                <Link href={SETTINGS_ROUTES.household.href} className="underline">
                  Change them in {SETTINGS_ROUTES.household.label}.
                </Link>
              ) : (
                "Only an admin can change them."
              )}
            </p>
          </SettingsDisclosure>

          <SettingsDisclosure id="password" icon={Lock} label="Password" summary="Change your password">
            <ChangePasswordForm />
          </SettingsDisclosure>

          <SettingsDisclosure
            id="two-factor"
            icon={ShieldCheck}
            label="Two-factor authentication"
            summary={isEncryptionConfigured() ? (user.totpEnabled ? "On" : "Off") : "Not available"}
          >
            {isEncryptionConfigured() ? (
              <TotpSection enabled={user.totpEnabled} />
            ) : (
              <UnconfiguredNotice feature="two-factor authentication" />
            )}
          </SettingsDisclosure>

          <SettingsLinkRow
            href={SETTINGS_ROUTES.passkeys.href}
            icon={KeyRound}
            label={SETTINGS_ROUTES.passkeys.label}
            summary={passkeyCount === 0 ? "None yet" : `${passkeyCount} ${passkeyCount === 1 ? "passkey" : "passkeys"}`}
          />

          <SettingsDisclosure
            id="calendar-feed"
            icon={CalendarDays}
            label="Calendar feed"
            summary={user.icalTokenHash ? "On" : "Off"}
          >
            <IcalTokenSection hasToken={Boolean(user.icalTokenHash)} appUrl={appUrl} inRow />
          </SettingsDisclosure>

          <SettingsDisclosure
            id="downloaded-documents"
            icon={HardDriveDownload}
            label="Downloaded documents"
            summary="On this device"
          >
            <OfflineDocumentsPanel inRow />
          </SettingsDisclosure>
        </SettingsRowList>
      </SaveChangesGroup>
    </PageShell>
  );
}
