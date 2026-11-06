import { z } from "zod";

const CURRENCY_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));

/** Whether `code` is an ISO 4217 currency code this runtime knows, in any case ("aud" counts). */
export function isCurrencyCode(code: string): boolean {
  return CURRENCY_CODES.has(code.toUpperCase());
}

/** An ISO 4217 code input (spend_summary's `currency`, the household currency). */
export const currencyCodeSchema = z
  .string()
  .refine(isCurrencyCode, { message: "Must be an ISO 4217 currency code, such as AUD or USD." });

/**
 * The currencies the app's selects offer. Server actions validate against it
 * too (the household currency, a new member's default), so it lives here
 * rather than in the select component.
 */
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
