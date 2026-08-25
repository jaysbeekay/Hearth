import { describe, expect, it } from "vitest";
import { heuristicExtract as extractContract } from "@/lib/documents/fieldExtraction";
import { heuristicExtract as extractInvoice } from "@/lib/documents/invoiceFieldExtraction";
import { heuristicExtract as extractLease, normaliseFields } from "@/lib/documents/leaseAgreementExtraction";
import { heuristicExtract as extractInventory } from "@/lib/documents/inventoryItemFieldExtraction";

describe("document extraction heuristics", () => {
  it("extracts invoice/product fields", () => {
    expect(extractInvoice("Acme Pty Ltd\nProduct: Vented Dryer\nManufacturer: Acme\nModel: DR-1\nSerial Number: SN-1234\nPurchase date: 25/08/2026\nTotal: $1,299.00")).toMatchObject({
      vendor: "Acme Pty Ltd", description: "Vented Dryer", manufacturer: "Acme", model: "DR-1", serialNumber: "SN-1234", purchaseDate: "2026-08-25", price: "1299.00",
    });
  });

  it("extracts lease-specific spaced dates and rent", () => {
    const fields = normaliseFields(extractLease("Residential tenancy agreement\nRent is $650 per week\nCommencement: 01 09 2026\nExpiry: 31/08/2027\nTenant\nGiven name: Jon\nFamily name: Smith"));
    expect(fields).toMatchObject({ weeklyRent: "650", leaseStart: "2026-09-01", leaseEnd: "2027-08-31", tenantName: "Jon Smith" });
  });

  it("fills generic contract fields without overriding them with lease gaps", () => {
    expect(extractContract("Acme Insurance\nStart date: 2026-01-01\nEnd date: 2026-12-31\nRent is $500 per week")).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31", cost: "500", billingFrequency: "WEEKLY" });
  });

  it("classifies inventory receipts and extracts price", () => {
    expect(extractInventory("Samsung\nLaptop purchase\nDate: 25/08/2026\nTotal: $999.00")).toMatchObject({ category: "ELECTRONICS", brand: "Samsung", purchaseDate: "2026-08-25", purchasePrice: "999.00" });
  });
});
