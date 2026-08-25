import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, KeyRound, History } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { env } from "@/lib/env";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { TotpSection } from "@/components/TotpSection";
import { NotificationPreferencesForm } from "@/components/NotificationPreferencesForm";
import { PreferencesForm } from "@/components/PreferencesForm";
import { OfflineDocumentsPanel } from "@/components/OfflineDocumentsPanel";
import { UnconfiguredNotice } from "@/components/UnconfiguredNotice";

export const metadata: Metadata = { title: "Settings" };

// min-h-11 (44px) keeps these comfortably tappable on mobile even though
// they're plain text links, not buttons.
const quickLinkClass =
  "flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-accent hover:bg-black/5 dark:hover:bg-white/5";

export default async function SettingsPage() {
  const session = await auth();
  // auth() can now return null mid-render — a session is revoked as soon as
  // the account's sessionVersion moves (password/role change) or the account
  // is deleted, which the proxy won't have caught for an in-flight request.
  if (!session?.user) redirect("/login");

  const [user, smtpConfigured, ntfyConfigured] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isSmtpConfigured(),
    isNtfyConfigured(),
  ]);
  if (!user) redirect("/login");
  const appUrl = env.appUrl ?? "http://localhost:3000";

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-foreground/60">
        These settings only affect your own account, not the rest of the household.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Profile</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <dt className="text-xs text-foreground/50">Name</dt>
              <dd className="text-sm font-medium break-words">{user.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground/50">Email</dt>
              <dd className="text-sm font-medium break-words">{user.email}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground/50">Role</dt>
              <dd className="text-sm font-medium">{user.role}</dd>
            </div>
          </dl>
          {user.role === "ADMIN" && (
            <Link
              href="/settings/household"
              className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-accent hover:bg-black/5 dark:hover:bg-white/5"
            >
              <ArrowRight size={16} />
              Household &amp; System settings
            </Link>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Notifications</h2>
          <p className="mb-3 text-sm text-foreground/60">
            Expiry reminders are sent by email{ntfyConfigured ? " and push (ntfy)" : ""}.{" "}
            {!smtpConfigured && !ntfyConfigured && (
              <span className="text-warning">
                No notification channel is configured yet
                {user.role === "ADMIN" ? (
                  <>
                    {" "}
                    — configure SMTP or ntfy in{" "}
                    <Link href="/settings/app" className="underline">System settings</Link>.
                  </>
                ) : (
                  " — ask an admin to configure SMTP or ntfy."
                )}
              </span>
            )}
          </p>
          <NotificationPreferencesForm emailReminders={user.emailReminders} />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4 md:p-6 md:col-span-2">
          <h2 className="mb-3 font-medium">Preferences</h2>
          <p className="mb-3 text-sm text-foreground/60">
            Localisation used throughout the app — dates, default currency for new records, your
            timezone, and the region convention used for number formatting (decimal/thousands
            separators). This doesn&apos;t change the app&apos;s display language.
          </p>
          <PreferencesForm
            dateFormat={user.dateFormat}
            preferredCurrency={user.preferredCurrency}
            timezone={user.timezone}
            region={user.region}
          />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Security</h2>
          <div className="flex flex-col gap-1">
            <Link href="/settings/passkeys" className={quickLinkClass}>
              <KeyRound size={16} />
              Manage passkeys
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/settings/security" className={quickLinkClass}>
                <History size={16} />
                View security log
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
        </section>

        <IcalTokenSection hasToken={Boolean(user.icalTokenHash)} appUrl={appUrl} />

        <OfflineDocumentsPanel />

        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Change password</h2>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  );
}
