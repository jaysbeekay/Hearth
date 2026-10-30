import type { OwnedDocumentKind } from "@/lib/documents/kinds";

// Prisma `where` for the Documents of each kind that are live: the Document
// isn't in Trash, and neither is the record it's attached to (or that
// record's parent). The same rule as isDocumentOwnerInTrash in
// src/lib/commands/documents.ts, which decides whether /api/documents/[id]
// serves the file, so a list never shows a Document whose link 404s.
// Portfolios and Holdings have no Trash; Trades do (#427).
export const LIVE_DOCUMENT_WHERE = {
  CONTRACT: { deletedAt: null, contract: { deletedAt: null } },
  PRODUCT: { deletedAt: null, product: { deletedAt: null } },
  TRIP_SEGMENT: { deletedAt: null, tripSegment: { deletedAt: null, trip: { deletedAt: null } } },
  RENTAL_STATEMENT: { deletedAt: null, rentalStatement: { deletedAt: null, property: { deletedAt: null } } },
  HOME_ITEM: { deletedAt: null, homeItem: { deletedAt: null, property: { deletedAt: null } } },
  VEHICLE_ITEM: { deletedAt: null, vehicleItem: { deletedAt: null, vehicle: { deletedAt: null } } },
  INVENTORY_ITEM: { deletedAt: null, inventoryItem: { deletedAt: null } },
  TRADE: { deletedAt: null, trade: { deletedAt: null } },
} as const satisfies Record<OwnedDocumentKind, object>;
