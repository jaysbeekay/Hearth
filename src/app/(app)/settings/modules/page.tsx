import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { ModuleToggle } from "@/components/ModuleToggle";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: SETTINGS_ROUTES.modules.label };

export default async function ModulesPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const enabledModules = await getEnabledModuleKeys();

  return (
    <PageShell width="form">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.modules)} />
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.modules.label}</h1>
      <p className="text-sm text-muted">
        Enable or disable optional features. Disabling a module hides it from navigation but
        keeps its data intact. Records in every module are visible to your whole household, not
        just the person who added them.
      </p>

      <Card as="section">
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
                  <p className="text-xs text-muted">{description}</p>
                </div>
                <ModuleToggle moduleKey={key} enabled={enabled} />
              </li>
            );
          })}
        </ul>
      </Card>
    </PageShell>
  );
}
