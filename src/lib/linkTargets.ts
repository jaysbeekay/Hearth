import { prisma } from "@/lib/prisma";
import { inTrashLabel } from "@/lib/trashWording";

export interface LinkTarget {
  id: string;
  label: string;
}

// The Properties and Vehicles a Contract or Warranty edit form offers as link
// targets (#489): live ones only, plus the record's current link even if it
// is in Trash, marked as such. Dropping the current link would make the
// select post it blank and saving would unlink it (#413); the commands also
// refuse a newly chosen trashed link (links.ts). Archived records stay in
// the list on purpose (#355).

function where(currentId: string | null | undefined) {
  return currentId ? { OR: [{ deletedAt: null }, { id: currentId }] } : { deletedAt: null };
}

function toTarget(row: { id: string; label: string; deletedAt: Date | null }): LinkTarget {
  return { id: row.id, label: row.deletedAt ? inTrashLabel(row.label) : row.label };
}

const select = { id: true, label: true, deletedAt: true } as const;

export async function propertyLinkTargets(currentId?: string | null): Promise<LinkTarget[]> {
  const rows = await prisma.property.findMany({ where: where(currentId), select, orderBy: { label: "asc" } });
  return rows.map(toTarget);
}

export async function vehicleLinkTargets(currentId?: string | null): Promise<LinkTarget[]> {
  const rows = await prisma.vehicle.findMany({ where: where(currentId), select, orderBy: { label: "asc" } });
  return rows.map(toTarget);
}
