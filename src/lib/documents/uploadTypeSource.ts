// #604 — where an Upload row's type came from: the scan's guess, the
// fallback when the scan couldn't tell (or failed), or the person.

export type UploadRowType = "CONTRACT" | "PRODUCT" | "INVENTORY" | "INBOX";
export type TypeSource = "scan" | "fallback" | "user";

type GuessedType = "CONTRACT" | "PRODUCT" | "INVENTORY";

/** The type a freshly scanned row is filed as, and where that type came from. */
export function scannedRowType(
  guessed: GuessedType | null | undefined,
  inventoryEnabled: boolean,
): { type: UploadRowType; typeSource: TypeSource } {
  if (!guessed) return { type: "CONTRACT", typeSource: "fallback" };
  // With the Inventory module off, an inventory item is filed as a Warranty.
  if (guessed === "INVENTORY" && !inventoryEnabled) return { type: "PRODUCT", typeSource: "scan" };
  return { type: guessed, typeSource: "scan" };
}

/** The note under a row's header, or null once the person has picked the type. */
export function typeSourceNote(type: UploadRowType, source: TypeSource): string | null {
  if (source === "fallback") return "Couldn't tell what this is. Pick a type.";
  if (source !== "scan") return null;
  switch (type) {
    case "CONTRACT":
      return "Detected as a contract";
    case "PRODUCT":
      return "Detected as a warranty";
    case "INVENTORY":
      return "Detected as an item";
    default:
      return null;
  }
}
