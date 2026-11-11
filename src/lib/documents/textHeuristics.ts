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
// "R 1 234,56", "¥12,000", "AUD 5101.00". The sign and number are on one line,
// and the number takes one of three forms:
// - grouped in threes by one consistent comma, dot, non-breaking space or thin
//   space, with an optional decimal part;
// - grouped in threes by plain spaces, but only with a decimal part or at the
//   end of the line / before punctuation, so "$50 100 items" reads as 50;
// - a plain digit run with an optional decimal part.
// "R" only counts when a digit follows it (after an optional space), and the
// amount mustn't run on into more digits.
const AMOUNT_PATTERN =
  /(\b(?:AUD|USD|NZD|GBP|EUR|JPY|ZAR)|[$£€¥]|\bR(?=[^\S\r\n]?\d))[^\S\r\n]*(\d{1,3}([,.\u00A0\u2009\u202F])\d{3}(?:\3\d{3})*(?:(?!\3)[.,]\d+)?|\d{1,3} \d{3}(?: \d{3})*(?:[.,]\d+|(?=[^\S\r\n]*(?:[\r\n]|$|[^\w\s])))|\d+(?:[.,]\d+)?)(?!\d)/g;

const SPACES = /[ \u00A0\u2009\u202F]/g;

// An amount cut short by a malformed grouping ("$1.234.56", "$12,34,567").
const MALFORMED_TAIL = /[.,]\d/y;
// "R2D2", "R2 D2": a reference, not an amount in rand.
const REFERENCE_TAIL = /[A-Za-z]|[^\S\r\n]?[A-Za-z]\d/y;

function followedBy(pattern: RegExp, text: string, at: number): boolean {
  pattern.lastIndex = at;
  return pattern.test(text);
}

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
    // "0.500" is a decimal: a thousands group never follows a lone 0.
    const grouped =
      parts.length > 2 || (parts[0] !== "0" && parts[0].length <= 3 && parts[1].length === 3);
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
// ("Total €1.234,56" → "1234.56"), or undefined if there isn't one. An "R"
// amount is only used when nothing else in the text is an amount ("Unit R2
// total $500" → 500), and never when it looks like a reference ("R2D2", "R2
// D2") or starts with a 0 ("R 0412 345 678"). A malformed grouping
// ("$1.234.56") is skipped rather than read as its first part.
export function parseAmount(text: string): string | undefined {
  let randAmount: string | undefined;
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const prefix = match[1];
    const number = match[2];
    const end = (match.index ?? 0) + match[0].length;
    if (followedBy(MALFORMED_TAIL, text, end)) continue;
    if (prefix !== "R") return normaliseNumber(number, prefix === "¥" || prefix === "JPY");
    if (randAmount !== undefined || /^0\d/.test(number) || followedBy(REFERENCE_TAIL, text, end)) continue;
    randAmount = normaliseNumber(number, false);
  }
  return randAmount;
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
