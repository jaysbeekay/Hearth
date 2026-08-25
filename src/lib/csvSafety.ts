const RISKY_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Defuses CSV/spreadsheet formula injection (OWASP: a cell opened in Excel,
 * Sheets, or LibreOffice that starts with =, +, -, or @ can execute as a
 * formula rather than display as text). Only strings are at risk — numbers,
 * booleans, null, etc. pass through unchanged. Prefixing a leading single
 * quote is the standard mitigation: every major spreadsheet app then treats
 * the cell as literal text instead of evaluating it.
 */
export function sanitizeCsvCell<T>(value: T): T | string {
  if (typeof value !== "string" || value.length === 0) return value;
  return RISKY_LEADING_CHARS.has(value[0]) ? `'${value}` : value;
}

/** Applies sanitizeCsvCell across every cell of one row. */
export function sanitizeCsvRow(row: readonly unknown[]): unknown[] {
  return row.map(sanitizeCsvCell);
}
