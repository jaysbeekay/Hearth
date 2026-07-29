import { getBarcodeConfig, isBarcodeLookupConfigured } from "@/lib/appSettings";

export interface BarcodeProductInfo {
  description?: string;
  manufacturer?: string;
}

export type BarcodeLookupResult =
  | { ok: true; info: BarcodeProductInfo }
  | { ok: false; reason: "not_found" | "rate_limited" | "network_error" };

interface UpcItemDbResponse {
  code: string;
  items?: {
    title?: string;
    brand?: string;
  }[];
}

const TRIAL_ENDPOINT = "https://api.upcitemdb.com/prod/trial/lookup";
const PROD_ENDPOINT = "https://api.upcitemdb.com/prod/v1/lookup";

export function isValidBarcode(code: string): boolean {
  return /^\d{6,14}$/.test(code);
}

// Returns null only when barcode lookup isn't configured at all — callers
// that reach this point should already have checked isBarcodeLookupConfigured().
export async function lookupBarcode(code: string): Promise<BarcodeLookupResult | null> {
  if (!(await isBarcodeLookupConfigured())) return null;

  const { apiKey } = await getBarcodeConfig();
  const endpoint = apiKey ? PROD_ENDPOINT : TRIAL_ENDPOINT;
  const url = `${endpoint}?upc=${encodeURIComponent(code)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: apiKey
        ? { user_key: apiKey, key_type: "3scale" }
        : undefined,
    });

    if (res.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    if (!res.ok) {
      return { ok: false, reason: "network_error" };
    }

    const data = (await res.json()) as UpcItemDbResponse;
    const item = data.items?.[0];
    if (!item) return { ok: false, reason: "not_found" };

    const info: BarcodeProductInfo = {};
    if (item.title) info.description = item.title;
    if (item.brand) info.manufacturer = item.brand;
    if (Object.keys(info).length === 0) return { ok: false, reason: "not_found" };
    return { ok: true, info };
  } catch {
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}
