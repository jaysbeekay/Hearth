import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { ModuleToggle } from "@/components/ModuleToggle";

export const metadata: Metadata = { title: "Modules" };

export default async function ModulesPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const enabledModules = await getEnabledModuleKeys();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Modules</h1>
      <p className="text-sm text-foreground/60">
        Enable or disable optional features. Disabling a module hides it from navigation but
        keeps its data intact.
      </p>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ul className="divide-y divide-border">
          {Object.values(MODULE_REGISTRY).map(({ key, label, description, icon: Icon }) => {
            const enabled = enabledModules.has(key);
            return (
              <li key={key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Icon size={16} />
                    {label}
                  </p>
                  <p className="text-xs text-foreground/50">{description}</p>
                </div>
                <ModuleToggle moduleKey={key} enabled={enabled} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
