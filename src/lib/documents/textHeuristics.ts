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

// An amount after a currency sign or code: "$1,234.56", "€1.234,56",
// "R 1 234,56", "¥12,000", "AUD 5101.00". The number is either grouped in
// threes by one consistent thousands separator (comma, dot, space, or a thin /
// non-breaking space), with an optional decimal part, or a plain digit run with
// an optional decimal part. "R" only counts when a digit follows it (after an
// optional space), and the amount mustn't run on into more digits.
const AMOUNT_PATTERN =
  /(\b(?:AUD|USD|NZD|GBP|EUR|JPY|ZAR)|[$£€¥]|\bR(?=\s?\d))\s*(\d{1,3}([,.    ])\d{3}(?:\3\d{3})*(?:(?!\3)[.,]\d+)?|\d+(?:[.,]\d+)?)(?!\d)/g;

const SPACES = /[    ]/g;

// Turns a matched number into a plain decimal string ("1.234,56" → "1234.56").
// With both "." and "," the last one is the decimal separator. With one kind
// only, it's a thousands separator when it splits the number into groups of
// three ("1.234", "12,000,000"), otherwise a decimal separator ("12,50", "12.5").
function normaliseNumber(raw: string, wholeUnitsOnly: boolean): string {
  const digits = raw.replace(SPACES, "");
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let whole: string;
  let fraction: string | undefined;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    whole = digits.slice(0, decimalAt).replace(/[.,]/g, "");
    fraction = digits.slice(decimalAt + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = digits.split(/[.,]/);
    const grouped = parts.length > 2 || (parts[0].length <= 3 && parts[1].length === 3);
    if (grouped) {
      whole = parts.join("");
    } else {
      whole = parts[0];
      fraction = parts[1];
    }
  } else {
    whole = digits;
  }
  // Yen have no minor unit, so a decimal part is dropped rather than kept.
  if (fraction === undefined || wholeUnitsOnly) return whole;
  return `${whole}.${fraction}`;
}

// The first currency-marked amount in the text, as a plain decimal string
// ("Total €1.234,56" → "1234.56"), or undefined if there isn't one. A
// reference like "R2D2" isn't read: an "R" amount mustn't run on into letters.
export function parseAmount(text: string): string | undefined {
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const prefix = match[1];
    const end = (match.index ?? 0) + match[0].length;
    if (prefix === "R" && /^[A-Za-z]/.test(text.slice(end))) continue;
    return normaliseNumber(match[2], prefix === "¥" || prefix === "JPY");
  }
  return undefined;
}

// The first amount on a line matching `labels` ("Weekly rent £1,200.00").
export function findLabeledAmount(text: string, labels: RegExp): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!labels.test(line)) continue;
    const amount = parseAmount(line);
    if (amount) return amount;
  }
  return undefined;
}

export function findCost(text: string): string | undefined {
  const priority = /(total|amount due|balance due|premium|monthly fee|amount payable|payment)/i;
  let fallback: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const value = parseAmount(line);
    if (!value) continue;
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
