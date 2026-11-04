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
