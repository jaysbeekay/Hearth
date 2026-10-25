import { prisma } from "@/lib/prisma";

// Checks the Property and Vehicle a Contract or Product is to be linked to
// before the write, so a made-up or trashed id is refused with a message
// rather than failing as a foreign-key error (or linking to a record in
// Trash). The forms only offer live records; this is for callers that take
// ids from elsewhere, such as the Assistant. Returns the message, or null
// when every given link is live.
export async function linkedRecordError(links: {
  propertyId?: string | null;
  vehicleId?: string | null;
}): Promise<string | null> {
  if (links.propertyId) {
    const property = await prisma.property.findUnique({
      where: { id: links.propertyId },
      select: { deletedAt: true },
    });
    if (!property || property.deletedAt) return "That property doesn't exist or is in Trash.";
  }
  if (links.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: links.vehicleId },
      select: { deletedAt: true },
    });
    if (!vehicle || vehicle.deletedAt) return "That vehicle doesn't exist or is in Trash.";
  }
  return null;
}
