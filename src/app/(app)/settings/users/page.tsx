import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteUser } from "@/lib/actions/auth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { CreateUserForm } from "@/components/CreateUserForm";
import { MemberRoleForm } from "@/components/MemberRoleForm";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Household members" };

export default async function ManageUsersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [users, { dateFormat }] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getUserPreferences(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Household members</h1>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ul className="divide-y divide-border">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {user.name}{" "}
                  {user.id === session.user.id && (
                    <span className="text-foreground/50">· {user.role}</span>
                  )}
                </p>
                <p className="text-xs text-foreground/50">
                  {user.email} · joined {formatDate(user.createdAt, dateFormat)}
                </p>
              </div>
              {user.id !== session.user.id && (
                <div className="flex items-center gap-3">
                  <MemberRoleForm userId={user.id} role={user.role} />
                  <ConfirmForm
                    action={deleteUser.bind(null, user.id)}
                    confirmText={`Remove ${user.name} from the household?`}
                    ariaLabel={`Remove ${user.name} from the household`}
                    className="rounded-md p-2 text-foreground/50 hover:text-danger"
                  >
                    <Trash2 size={16} />
                  </ConfirmForm>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Add a household member</h2>
        <CreateUserForm />
      </section>
    </div>
  );
}
