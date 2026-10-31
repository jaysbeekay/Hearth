// User-facing words for Trash used outside the Trash page itself. Kept in
// one place so the word can be changed without hunting through pages.
// No runtime imports, so client components can use it too.

/** Marks an option whose record is in Trash, e.g. "Beach house (deleted)". */
export function inTrashLabel(label: string): string {
  return `${label} (deleted)`;
}
