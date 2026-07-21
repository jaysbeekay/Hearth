import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseBackup, KeyRound, LayoutGrid, Settings2, Users, Webhook } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateNotificationPreferences, updateUserPreferences } from "@/lib/actions/auth";
import { isEncryptionConfigured, isDemoMode } from "@/lib/env";
import { env } from "@/lib/env";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { DATE_FORMAT_OPTIONS, DATE_FORMAT_LABELS } from "@/lib/utils";
import { TIMEZONE_OPTIONS } from "@/lib/userPreferences";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { ChatSettingsForm } from "@/components/ChatSettingsForm";
import { IcalTokenSection } from "@/components/IcalTokenSection";
import { TotpSection } from "@/components/TotpSection";
import { CurrencySelect } from "@/components/CurrencySelect";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { OfflineDocumentsPanel } from "@/components/OfflineDocumentsPanel";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const [user, smtpConfigured, ntfyConfigured] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session!.user.id } }),
    isSmtpConfigured(),
    isNtfyConfigured(),
  ]);
  const appUrl = env.appUrl ?? "http://localhost:3000";

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Profile</h2>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-foreground/50">Name</dt>
            <dd className="text-sm font-medium">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Email</dt>
            <dd className="text-sm font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Role</dt>
            <dd className="text-sm font-medium">{user.role}</dd>
          </div>
        </dl>
        {user.role === "ADMIN" && (
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/settings/users"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <Users size={16} />
              Manage household members
            </Link>
            <Link
              href="/settings/backups"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <DatabaseBackup size={16} />
              Database backups
            </Link>
            <Link
              href="/settings/webhooks"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <Webhook size={16} />
              Webhooks
            </Link>
            <Link
              href="/settings/modules"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <LayoutGrid size={16} />
              Modules
            </Link>
            <Link
              href="/settings/app"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <Settings2 size={16} />
              System settings
            </Link>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Notifications</h2>
        <p className="mb-3 text-sm text-foreground/60">
          Expiry reminders are sent by email{ntfyConfigured ? " and push (ntfy)" : ""}.{" "}
          {!smtpConfigured && !ntfyConfigured && (
            <span className="text-warning">
              No notification channel is configured yet — configure SMTP or ntfy in{" "}
              <Link href="/settings/app" className="underline">System settings</Link>.
            </span>
          )}
        </p>
        <form action={updateNotificationPreferences} className="flex items-center gap-2">
          <input
            id="emailReminders"
            name="emailReminders"
            type="checkbox"
            defaultChecked={user.emailReminders}
            className="size-4 rounded border-border accent-accent"
          />
          <label htmlFor="emailReminders" className="text-sm">
            Email me about contracts expiring soon
          </label>
          <button
            type="submit"
            className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            Save
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Preferences</h2>
        <p className="mb-3 text-sm text-foreground/60">
          Localisation used throughout the app — dates, default currency for new records, and
          your timezone.
        </p>
        <form action={updateUserPreferences} className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="dateFormat" className="text-sm font-medium">
              Date format
            </label>
            <SelectWrapper>
              <select
                id="dateFormat"
                name="dateFormat"
                defaultValue={user.dateFormat}
                className={selectClass}
              >
                {DATE_FORMAT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {DATE_FORMAT_LABELS[value]}
                  </option>
                ))}
              </select>
            </SelectWrapper>
          </div>
          <div className="space-y-1">
            <label htmlFor="preferredCurrency" className="text-sm font-medium">
              Default currency
            </label>
            <CurrencySelect
              id="preferredCurrency"
              name="preferredCurrency"
              defaultValue={user.preferredCurrency}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="timezone" className="text-sm font-medium">
              Timezone
            </label>
            <SelectWrapper>
              <select
                id="timezone"
                name="timezone"
                defaultValue={user.timezone}
                className={selectClass}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </SelectWrapper>
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              Save preferences
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">AI document extraction</h2>
        {isDemoMode() ? (
          <p className="text-sm text-foreground/60">
            Disabled in this public demo — bringing your own API key would let a visitor spend
            it via this server.
          </p>
        ) : isEncryptionConfigured() ? (
          <>
            <p className="mb-3 text-sm text-foreground/60">
              Bring your own API key to send uploaded documents to a cloud AI provider for
              higher-accuracy field extraction. Documents are sent directly to your selected
              provider using your key — nothing changes about how extracted fields are saved;
              you still review them before submitting the form. Leave this unset to keep using
              the built-in local extraction only.
            </p>
            <AiSettingsForm provider={user.aiProvider} model={user.aiModel} />
          </>
        ) : (
          <p className="text-sm text-warning">
            Set ENCRYPTION_KEY on the server to enable bringing your own AI provider key.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">AI Assistant</h2>
        {isDemoMode() ? (
          <p className="text-sm text-foreground/60">
            Disabled in this public demo — bringing your own API key would let a visitor spend
            it via this server.
          </p>
        ) : isEncryptionConfigured() ? (
          <>
            <p className="mb-3 text-sm text-foreground/60">
              Bring your own API key to chat with an assistant that can answer questions using
              your household&apos;s own data — contracts, warranties, trips, vehicles, home,
              inventory, and wealth. It&apos;s read-only: it can look things up, but never
              creates, edits, or deletes anything. Configure a different provider/model here than
              document extraction if you like — the two are independent.
            </p>
            <ChatSettingsForm provider={user.chatProvider} model={user.chatModel} />
          </>
        ) : (
          <p className="text-sm text-warning">
            Set ENCRYPTION_KEY on the server to enable the AI assistant.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Security</h2>
        <div className="flex flex-col gap-2">
          <Link
            href="/settings/passkeys"
            className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <KeyRound size={16} />
            Manage passkeys
          </Link>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-medium">Two-factor authentication</h3>
          {isEncryptionConfigured() ? (
            <TotpSection enabled={user.totpEnabled} />
          ) : (
            <p className="text-sm text-warning">
              Set ENCRYPTION_KEY on the server to enable two-factor authentication.
            </p>
          )}
        </div>
      </section>

      <IcalTokenSection token={user.icalToken ?? null} appUrl={appUrl} />

      <OfflineDocumentsPanel />

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Change password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
