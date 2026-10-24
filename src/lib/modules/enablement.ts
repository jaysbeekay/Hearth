import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MODULE_KEYS, MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

export async function getEnabledModuleKeys(): Promise<Set<ModuleKey>> {
  const rows = await prisma.moduleEnablement.findMany({
    where: { enabled: true },
    select: { key: true },
  });
  return new Set(rows.map((row) => row.key as ModuleKey));
}

export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  const row = await prisma.moduleEnablement.findUnique({ where: { key } });
  return row?.enabled ?? false;
}

export async function requireModuleEnabled(key: ModuleKey) {
  if (!(await isModuleEnabled(key))) {
    redirect("/dashboard");
  }
}

export class ModuleDisabledError extends Error {
  constructor(public readonly key: ModuleKey) {
    super(`${MODULE_REGISTRY[key].label} module is disabled`);
    this.name = "ModuleDisabledError";
  }
}

// For record commands (src/lib/commands/*): throws instead of redirecting,
// so a server action, the sync route and tests all see the same plain error
// (the message matches what /api/sync already reports for a disabled module).
export async function assertModuleEnabled(key: ModuleKey) {
  if (!(await isModuleEnabled(key))) throw new ModuleDisabledError(key);
}

export function isKnownModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}
