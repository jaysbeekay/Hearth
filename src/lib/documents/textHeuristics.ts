const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function toIsoDate(day: string, month: string, year: string): string | undefined {
  const y = year.length === 2 ? `20${year}` : year;
  const d = Number(day);
  const m = Number(month);
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}

// Numeric dates are assumed day/month/year (en-AU convention) when ambiguous.
export function matchDate(text: string): string | undefined {
  const numeric = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (numeric) {
    const iso = toIsoDate(numeric[1], numeric[2], numeric[3]);
    if (iso) return iso;
  }
  const iso8601 = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso8601) {
    const iso = toIsoDate(iso8601[3], iso8601[2], iso8601[1]);
    if (iso) return iso;
  }
  const monthName = text.match(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i,
  );
  if (monthName) {
    const month = MONTHS[monthName[2].toLowerCase()];
    const iso = toIsoDate(monthName[1], month, monthName[3]);
    if (iso) return iso;
  }
  return undefined;
}

export function findLabeledDate(text: string, labels: RegExp): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labels.test(lines[i])) continue;
    const window = lines.slice(i, i + 2).join(" ");
    const iso = matchDate(window);
    if (iso) return iso;
  }
  return undefined;
}

export function findLabeledValue(
  text: string,
  labels: RegExp,
  valuePattern: RegExp,
): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!labels.test(line)) continue;
    const match = line.match(valuePattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

export function findCost(text: string): string | undefined {
  const priority = /(total|amount due|balance due|premium|monthly fee|amount payable|payment)/i;
  let fallback: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/(?:AUD|USD|NZD|GBP|EUR|\$)\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d,.]?\d)/);
    if (!match) continue;
    const value = match[1].replace(/,/g, "");
    if (priority.test(line)) return value;
    fallback ??= value;
  }
  return fallback;
}

export function findEmail(text: string): string | undefined {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
}

// Requires at least one separator (space/dash/dot/parenthesis) so bare digit
// runs — account numbers, policy numbers — aren't mistaken for phone numbers.
export function findPhone(text: string): string | undefined {
  const pattern = /(\+?\d[\d\s().-]{6,}\d)/;
  const hasSeparator = (value: string) => /[\s().-]/.test(value);

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/(phone|tel\.?|mobile|fax|contact)/i.test(line)) continue;
    const match = line.match(pattern);
    if (match && hasSeparator(match[1])) return match[1].trim();
  }
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && hasSeparator(match[1])) return match[1].trim();
  }
  return undefined;
}

// Picks out a likely company/organisation name: a line bearing a common
// business suffix, falling back to the first short line in the document
// (letterheads and invoice headers both tend to lead with the org name).
export function findCompanyLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 1 && line.length < 80);
  // Skip financial-summary lines (e.g. "Total Inc GST: $467.00") so the
  // "Inc" suffix match below doesn't mistake a tax/total line for a company name.
  const companyLine = lines.find(
    (line) =>
      !/\$|gst|total|balance due|amount due/i.test(line) &&
      /(pty ltd|ltd\.?|inc\.?|llc|limited|insurance|telecom|energy|utilities)/i.test(line),
  );
  return (companyLine ?? lines[0])?.slice(0, 200);
}
