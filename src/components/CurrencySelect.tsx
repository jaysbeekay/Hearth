import { SelectWrapper, selectClass } from "@/components/SelectWrapper";

export const POPULAR_CURRENCIES = [
  "AUD",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "NZD",
  "JPY",
  "CHF",
  "CNY",
  "HKD",
  "SGD",
  "INR",
  "MXN",
  "BRL",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "KRW",
  "THB",
] as const;

const CURRENCY_LABELS: Record<string, string> = {
  AUD: "AUD — Australian Dollar",
  USD: "USD — US Dollar",
  EUR: "EUR — Euro",
  GBP: "GBP — British Pound",
  CAD: "CAD — Canadian Dollar",
  NZD: "NZD — New Zealand Dollar",
  JPY: "JPY — Japanese Yen",
  CHF: "CHF — Swiss Franc",
  CNY: "CNY — Chinese Yuan",
  HKD: "HKD — Hong Kong Dollar",
  SGD: "SGD — Singapore Dollar",
  INR: "INR — Indian Rupee",
  MXN: "MXN — Mexican Peso",
  BRL: "BRL — Brazilian Real",
  ZAR: "ZAR — South African Rand",
  SEK: "SEK — Swedish Krona",
  NOK: "NOK — Norwegian Krone",
  DKK: "DKK — Danish Krone",
  KRW: "KRW — South Korean Won",
  THB: "THB — Thai Baht",
};

export function CurrencySelect({
  id,
  name,
  defaultValue,
}: {
  id?: string;
  name: string;
  defaultValue?: string | null;
}) {
  return (
    <SelectWrapper>
      <select id={id ?? name} name={name} defaultValue={defaultValue ?? "AUD"} className={selectClass}>
        {POPULAR_CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {CURRENCY_LABELS[code]}
          </option>
        ))}
      </select>
    </SelectWrapper>
  );
}
