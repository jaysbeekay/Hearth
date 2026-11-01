import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import type { SecurityEventType } from "@/generated/prisma/enums";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.security.label };

const EVENT_LABELS: Record<SecurityEventType, string> = {
  LOGIN_FAILED: "Failed sign-in",
  LOGIN_THROTTLED: "Sign-in throttled",
  PASSWORD_CHANGED: "Password changed",
  PASSWORD_RESET_COMPLETED: "Password reset completed",
  TOTP_DISABLED: "Two-factor authentication disabled",
  ROLE_CHANGED: "Role changed",
  USER_DELETED: "User removed",
};

// Events a household member should notice, not just an admin auditing the
// account list — everything else here is still visible to admins only.
const CONCERNING_EVENTS = new Set<SecurityEventType>([
  "LOGIN_FAILED",
  "LOGIN_THROTTLED",
]);

export default async function SecurityLogPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [events, { dateFormat, displayTimeZone }] = await Promise.all([
    prisma.securityEventLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    getUserPreferences(),
  ]);

  return (
    <PageShell width="form">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.security)} />
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.security.label}</h1>
      <p className="text-sm text-muted">
        Auth-relevant events across the household — failed and throttled sign-ins, password
        and role changes, two-factor disablement, and account removal. The most recent 100
        events.
      </p>

      <Card as="section">
        {events.length === 0 ? (
          <p className="text-sm text-muted">No security events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p
                    className={`font-medium ${CONCERNING_EVENTS.has(event.type) ? "text-warning" : ""}`}
                  >
                    {EVENT_LABELS[event.type]}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {event.email ?? (event.userId ? `user ${event.userId}` : "—")}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {formatTimestamp(event.createdAt, dateFormat, displayTimeZone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}
