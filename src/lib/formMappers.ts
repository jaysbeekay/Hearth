// Plain (non-"use server") FormData -> schema-input mappers shared between
// the single-item create actions and the bulk-import review queue. Kept out
// of contracts.ts/products.ts because those files are "use server" modules,
// where every export must be an async function.

export function formToContractInput(formData: FormData) {
  return {
    title: formData.get("title"),
    category: formData.get("category"),
    provider: formData.get("provider"),
    contractNumber: formData.get("contractNumber"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    renewalType: formData.get("renewalType"),
    noticePeriodDays: formData.get("noticePeriodDays"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    billingFrequency: formData.get("billingFrequency"),
    status: formData.get("status") || "ACTIVE",
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    notes: formData.get("notes"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
    isTaxDeductible: formData.get("isTaxDeductible") === "on",
  };
}

export function formToProductInput(formData: FormData) {
  return {
    name: formData.get("name"),
    manufacturer: formData.get("manufacturer"),
    vendor: formData.get("vendor"),
    serialNumber: formData.get("serialNumber"),
    barcode: formData.get("barcode"),
    purchaseDate: formData.get("purchaseDate"),
    warrantyEndDate: formData.get("warrantyEndDate"),
    price: formData.get("price"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
  };
}
