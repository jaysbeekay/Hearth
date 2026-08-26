import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidBarcode, lookupBarcode } from "@/lib/barcodeLookup";
import { normaliseGeocodeResult } from "@/lib/geocode";

vi.mock("@/lib/appSettings", () => ({
  isBarcodeLookupConfigured: vi.fn(async () => true),
  getBarcodeConfig: vi.fn(async () => ({ apiKey: "" })),
}));

describe("barcode lookup", () => {
  it("accepts six-to-fourteen digit barcodes only", () => {
    expect(isValidBarcode("123456")).toBe(true);
    expect(isValidBarcode("12345678901234")).toBe(true);
    expect(isValidBarcode("12345")).toBe(false);
    expect(isValidBarcode("123456x")).toBe(false);
  });

  beforeEach(() => vi.restoreAllMocks());

  it("maps a successful upstream result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ title: "Widget", brand: "Acme" }] }), { status: 200 })));
    await expect(lookupBarcode("123456")).resolves.toEqual({ ok: true, info: { description: "Widget", manufacturer: "Acme" } });
  });

  it("distinguishes not-found, rate-limit, and upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(lookupBarcode("123456")).resolves.toEqual({ ok: false, reason: "not_found" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    await expect(lookupBarcode("123456")).resolves.toEqual({ ok: false, reason: "rate_limited" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(lookupBarcode("123456")).resolves.toEqual({ ok: false, reason: "network_error" });
  });
});

describe("geocode result normalisation", () => {
  it("maps street and fallback locality fields", () => {
    expect(normaliseGeocodeResult({
      display_name: "1 Main St, Waterfall",
      lat: "-25.9",
      lon: "28.1",
      address: { house_number: "1", road: "Main St", town: "Waterfall", state: "Gauteng", postcode: "1000", country: "South Africa" },
    })).toEqual({ display_name: "1 Main St, Waterfall", lat: -25.9, lng: 28.1, street: "1 Main St", suburb: "Waterfall", state: "Gauteng", postcode: "1000", country: "South Africa" });
  });

  it("handles missing address details safely", () => {
    expect(normaliseGeocodeResult({ display_name: "Unknown", lat: "0", lon: "0" })).toMatchObject({ lat: 0, lng: 0, street: "", suburb: "", state: "" });
  });
});
