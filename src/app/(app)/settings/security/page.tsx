import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import type { SecurityEventType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Security log" };

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

  const [events, { dateFormat }] = await Promise.all([
    prisma.securityEventLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    getUserPreferences(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Security log</h1>
      <p className="text-sm text-foreground/60">
        Auth-relevant events across the household — failed and throttled sign-ins, password
        and role changes, two-factor disablement, and account removal. The most recent 100
        events.
      </p>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        {events.length === 0 ? (
          <p className="text-sm text-foreground/60">No security events recorded yet.</p>
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
                  <p className="truncate text-xs text-foreground/50">
                    {event.email ?? (event.userId ? `user ${event.userId}` : "—")}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-foreground/50">
                  {formatDate(event.createdAt, dateFormat)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
