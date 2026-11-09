import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAppUrlConfigured } from "@/lib/env";
import { getNtfyConfig, isSmtpConfigured } from "@/lib/appSettings";
import { getVapidPublicKey, ownPushDevices } from "@/lib/notifications/push";
import { getHouseholdReminderHealth } from "@/lib/notifications/health";
import { sendChannelTest } from "@/lib/actions/reminders";
import { NotifyThisDevice } from "@/components/DeviceReminderToggle";
import { NotificationPreferencesForm } from "@/components/NotificationPreferencesForm";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import { HouseholdReminderHealthCard } from "@/components/HouseholdReminderHealthCard";
import { SaveChangesGroup } from "@/components/SaveChangesGroup";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { sectionHeadingClass } from "@/lib/ui";

export const metadata: Metadata = { title: "Turn on reminders" };

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card as="section" className="space-y-3" aria-labelledby={`step-${n}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
        >
          {n}
        </span>
        <div>
          <h2 id={`step-${n}`} className={sectionHeadingClass()}>
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{hint}</p>
        </div>
      </div>
      <div className="space-y-3 sm:pl-9">{children}</div>
    </Card>
  );
}

function AdminSetupLink({ isAdmin, what }: { isAdmin: boolean; what: string }) {
  return (
    <p className="text-sm text-muted">
      {what} isn&apos;t set up for the household.{" "}
      {isAdmin ? (
        <>
          Set it up in{" "}
          <Link href={SETTINGS_ROUTES.reminders.href} className="text-accent underline">
            {SETTINGS_ROUTES.reminders.label}
          </Link>
          .
        </>
      ) : (
        "An admin can set it up."
      )}
    </p>
  );
}

/**
 * #375 — "Turn on reminders": the dashboard nudge's one screen, in order of
 * effort. Push on this device needs no account anywhere; email and ntfy need
 * an admin's server settings first, which stay in Settings.
 */
export default async function TurnOnRemindersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [user, smtpConfigured, ntfy, vapidPublicKey, pushDevices, health] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailReminders: true } }),
    isSmtpConfigured(),
    getNtfyConfig(),
    getVapidPublicKey(),
    ownPushDevices(session.user.id),
    getHouseholdReminderHealth(),
  ]);
  if (!user) redirect("/login");
  const isAdmin = session.user.role === "ADMIN";
  // Test sends are writes as far as roles go; read-only members still turn
  // push on and test it there.
  const canTest = session.user.role !== "READONLY";
  const ntfyConfigured = Boolean(ntfy.url && ntfy.topic);

  return (
    <PageShell width="form">
      <div>
        <BackLink href="/dashboard" label="Dashboard" />
        <h1 className="text-2xl font-medium">Turn on reminders</h1>
        <p className="mt-1 text-sm text-muted">
          Hearth reminds you before contracts, warranties and other dates come due. One of these is enough.
        </p>
      </div>

      <Step n={1} title="Notify this device" hint="One tap, no account needed. Do it on each phone or computer you use.">
        <NotifyThisDevice userId={session.user.id} vapidPublicKey={vapidPublicKey} devices={pushDevices} />
      </Step>

      <Step n={2} title="Email" hint={user.email ? `Sent to ${user.email}.` : "Sent to your account's email address."}>
        {smtpConfigured ? (
          <SaveChangesGroup>
            <NotificationPreferencesForm emailReminders={user.emailReminders} />
            {canTest && <TestConnectionButton action={sendChannelTest.bind(null, "EMAIL")} label="Send test email" />}
          </SaveChangesGroup>
        ) : (
          <AdminSetupLink isAdmin={isAdmin} what="Email" />
        )}
      </Step>

      <Step n={3} title="ntfy" hint="One topic for the whole household, read in the ntfy app.">
        {ntfyConfigured ? (
          <>
            <p className="text-sm">
              Subscribe to <span className="font-medium break-all">{ntfy.topic}</span> on{" "}
              <span className="break-all">{ntfy.url}</span> in the ntfy app.
            </p>
            {canTest && <TestConnectionButton action={sendChannelTest.bind(null, "NTFY")} label="Send test notification" />}
          </>
        ) : (
          <AdminSetupLink isAdmin={isAdmin} what="ntfy" />
        )}
      </Step>

      <HouseholdReminderHealthCard health={health} appUrlConfigured={isAppUrlConfigured()} />
    </PageShell>
  );
}
