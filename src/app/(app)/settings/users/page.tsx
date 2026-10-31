import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteUser } from "@/lib/actions/auth";
import { isSmtpConfigured } from "@/lib/appSettings";
import { ConfirmForm } from "@/components/ConfirmForm";
import { CreateUserForm } from "@/components/CreateUserForm";
import { MemberRoleForm } from "@/components/MemberRoleForm";
import { formatTimestamp, ROLE_LABELS } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { buttonClass } from "@/lib/ui";

export const metadata: Metadata = { title: SETTINGS_ROUTES.users.label };

export default async function ManageUsersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [users, { dateFormat, displayTimeZone }, smtpConfigured] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getUserPreferences(),
    isSmtpConfigured(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.users)} />
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.users.label}</h1>

      <Card as="section">
        <ul className="divide-y divide-border">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {user.name} <span className="text-muted">· {ROLE_LABELS[user.role] ?? user.role}</span>
                </p>
                <p className="text-xs text-muted">
                  {user.email} · joined {formatTimestamp(user.createdAt, dateFormat, displayTimeZone)}
                </p>
              </div>
              {user.id !== session.user.id && (
                <div className="flex items-center gap-3">
                  <MemberRoleForm userId={user.id} role={user.role} />
                  <ConfirmForm
                    action={deleteUser.bind(null, user.id)}
                    confirmText={`Remove ${user.name} from the household? Their records and documents stay with the household.`}
                    actionLabel={`Remove ${user.name}`}
                    ariaLabel={`Remove ${user.name} from the household`}
                    className={buttonClass("quiet", { icon: true }, "text-muted hover:text-danger")}
                  >
                    <Trash2 size={16} />
                  </ConfirmForm>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section">
        <h2 className="mb-3 font-medium">Add a household member</h2>
        <CreateUserForm smtpConfigured={smtpConfigured} />
      </Card>
    </div>
  );
}
