import { describe, it, expect } from "vitest";
import { scannedRowType, typeSourceNote } from "@/lib/documents/uploadTypeSource";

// #604 — each Upload row says whether its type came from the scan or the
// fallback, and says nothing once the person has picked the type.
describe("scannedRowType", () => {
  it("takes the scan's guess as the row's type", () => {
    expect(scannedRowType("PRODUCT", true)).toEqual({ type: "PRODUCT", typeSource: "scan" });
    expect(scannedRowType("CONTRACT", false)).toEqual({ type: "CONTRACT", typeSource: "scan" });
    expect(scannedRowType("INVENTORY", true)).toEqual({ type: "INVENTORY", typeSource: "scan" });
  });

  it("maps an Inventory guess to Warranty when the Inventory module is off, still as a scan guess", () => {
    expect(scannedRowType("INVENTORY", false)).toEqual({ type: "PRODUCT", typeSource: "scan" });
  });

  it("falls back to Contract when the scan had no guess or failed", () => {
    expect(scannedRowType(null, true)).toEqual({ type: "CONTRACT", typeSource: "fallback" });
    expect(scannedRowType(undefined, true)).toEqual({ type: "CONTRACT", typeSource: "fallback" });
  });
});

describe("typeSourceNote", () => {
  it("names the detected type for a scan guess", () => {
    expect(typeSourceNote("CONTRACT", "scan")).toBe("Detected as a contract");
    expect(typeSourceNote("PRODUCT", "scan")).toBe("Detected as a warranty");
    expect(typeSourceNote("INVENTORY", "scan")).toBe("Detected as an item");
  });

  it("asks the person to pick a type after a fallback", () => {
    expect(typeSourceNote("CONTRACT", "fallback")).toBe("Couldn't tell what this is. Pick a type.");
  });

  it("says nothing once the person chose the type", () => {
    expect(typeSourceNote("CONTRACT", "user")).toBeNull();
    expect(typeSourceNote("INBOX", "user")).toBeNull();
  });
});
