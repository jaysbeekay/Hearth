import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { isLive, RecordValidationError } from "@/lib/commands/shared";
import type { Prisma } from "@/generated/prisma/client";

/** The Property and Vehicle links a Contract or Product write can set. */
export interface RecordLinks {
  propertyId?: string | null;
  vehicleId?: string | null;
}

// The global client, or a transaction's `tx` (which must then be used for
// every query inside it: see writeContract).
type LinkClient = Pick<Prisma.TransactionClient, "property" | "vehicle" | "moduleEnablement">;

// Checks the Property and Vehicle a Contract or Product is to be linked to
// before the write, so a made-up or trashed id is refused with a message
// rather than failing as a foreign-key error (or linking to a record in
// Trash). A Property link needs the Properties (HOME) module on, and a
// Vehicle link the Vehicles module, as the forms only offer each select
// while its module is. Returns the message, or null when every given link
// is live ("live" as in shared.ts's Trash rules, #428).
//
// The Contract and Product commands run this (as assertLinksLive) inside
// their write's transaction, so every caller gets it: the forms, the
// Assistant, import and offline sync (#447). The Assistant also calls it
// directly to refuse a proposal before showing its card.
export async function linkedRecordError(links: RecordLinks, db: LinkClient = prisma): Promise<string | null> {
  if (links.propertyId) {
    if (!(await isModuleEnabled("HOME", db))) {
      return "The Properties module is off, so this can't be linked to a property.";
    }
    const property = await db.property.findUnique({
      where: { id: links.propertyId },
      select: { deletedAt: true },
    });
    if (!isLive(property)) return "That property doesn't exist or is in Trash.";
  }
  if (links.vehicleId) {
    if (!(await isModuleEnabled("VEHICLES", db))) {
      return "The Vehicles module is off, so this can't be linked to a vehicle.";
    }
    const vehicle = await db.vehicle.findUnique({
      where: { id: links.vehicleId },
      select: { deletedAt: true },
    });
    if (!isLive(vehicle)) return "That vehicle doesn't exist or is in Trash.";
  }
  return null;
}

/**
 * The links a write would newly set: those in `patch` that differ from what
 * the record already has (`existing`, or nothing for a create). A link the
 * record already has is left alone, even if its Property or Vehicle has
 * since gone to Trash or its module been turned off: the edit form keeps
 * the current link selectable (#413), so refusing it would block every
 * other edit to the record.
 */
export function newLinks(patch: RecordLinks, existing: RecordLinks = {}): RecordLinks {
  return {
    propertyId: patch.propertyId !== existing.propertyId ? patch.propertyId : undefined,
    vehicleId: patch.vehicleId !== existing.vehicleId ? patch.vehicleId : undefined,
  };
}

/** linkedRecordError for a command: throws its message as a RecordValidationError. */
export async function assertLinksLive(links: RecordLinks, db: LinkClient = prisma): Promise<void> {
  const message = await linkedRecordError(links, db);
  if (message) throw new RecordValidationError(message);
}
