import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DatabaseBackup, LayoutGrid, Settings2, Users, Webhook } from "lucide-react";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Household & System settings" };

// min-h-11 (44px) keeps these comfortably tappable on mobile even though
// they're plain text links, not buttons.
const quickLinkClass =
  "flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5";

export default async function HouseholdSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to Settings
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Household &amp; System</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Settings shared by the whole household, not just your own account.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Link href="/settings/users" className={quickLinkClass}>
          <Users size={18} />
          Manage household members
        </Link>
        <Link href="/settings/backups" className={quickLinkClass}>
          <DatabaseBackup size={18} />
          Database backups
        </Link>
        <Link href="/settings/webhooks" className={quickLinkClass}>
          <Webhook size={18} />
          Webhooks
        </Link>
        <Link href="/settings/modules" className={quickLinkClass}>
          <LayoutGrid size={18} />
          Modules
        </Link>
        <Link href="/settings/app" className={quickLinkClass}>
          <Settings2 size={18} />
          System settings
        </Link>
      </div>
    </div>
  );
}
