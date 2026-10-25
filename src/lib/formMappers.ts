// Plain (non-"use server") FormData -> schema-input mappers shared by the
// server actions, the offline sync handlers (src/app/api/sync/entityHandlers.ts)
// and the bulk-import review queue. Kept out of the action files because
// those are "use server" modules, where every export must be an async
// function.

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
    propertyId: formData.get("propertyId"),
    vehicleId: formData.get("vehicleId"),
  };
}

export function formToProductInput(formData: FormData) {
  return {
    description: formData.get("description"),
    manufacturer: formData.get("manufacturer"),
    model: formData.get("model"),
    vendor: formData.get("vendor"),
    serialNumber: formData.get("serialNumber"),
    barcode: formData.get("barcode"),
    purchaseDate: formData.get("purchaseDate"),
    warrantyEndDate: formData.get("warrantyEndDate"),
    price: formData.get("price"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
    propertyId: formData.get("propertyId"),
  };
}

export function formToVehicleInput(formData: FormData) {
  return {
    label: formData.get("label"),
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    colour: formData.get("colour"),
    licensePlate: formData.get("licensePlate"),
    vin: formData.get("vin"),
    regoExpiry: formData.get("regoExpiry"),
    insuranceExpiry: formData.get("insuranceExpiry"),
    nextServiceDue: formData.get("nextServiceDue"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
    notes: formData.get("notes"),
  };
}

export function formToVehicleItemInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    date: formData.get("date"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

export function formToTripInput(formData: FormData) {
  return {
    title: formData.get("title"),
    destination: formData.get("destination"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    notes: formData.get("notes"),
  };
}

export function formToTripSegmentInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    confirmationCode: formData.get("confirmationCode"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    location: formData.get("location"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
    flightNumber: formData.get("flightNumber"),
    departureIata: formData.get("departureIata"),
    arrivalIata: formData.get("arrivalIata"),
  };
}

export function formToPropertyInput(formData: FormData) {
  return {
    label: formData.get("label"),
    street: formData.get("street"),
    suburb: formData.get("suburb"),
    state: formData.get("state"),
    postcode: formData.get("postcode"),
    country: formData.get("country"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    notes: formData.get("notes"),
    occupancyStatus: formData.get("occupancyStatus") || undefined,
  };
}

export function formToHomeItemInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    date: formData.get("date"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    isTaxDeductible: formData.get("isTaxDeductible") === "on",
    notes: formData.get("notes"),
  };
}

export function formToRentalAgreementInput(formData: FormData) {
  return {
    tenantName: formData.get("tenantName"),
    weeklyRent: formData.get("weeklyRent"),
    managementFeePercent: formData.get("managementFeePercent"),
    leaseStart: formData.get("leaseStart"),
    leaseEnd: formData.get("leaseEnd"),
    bondAmount: formData.get("bondAmount"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

export function formToRentalStatementInput(formData: FormData) {
  return {
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    statementDate: formData.get("statementDate"),
    grossRent: formData.get("grossRent"),
    managementFee: formData.get("managementFee"),
    otherDeductions: formData.get("otherDeductions"),
    netAmount: formData.get("netAmount"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

export function formToInventoryItemInput(formData: FormData) {
  return {
    label: formData.get("label"),
    category: formData.get("category") || "OTHER",
    brand: formData.get("brand"),
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    purchaseDate: formData.get("purchaseDate"),
    purchasePrice: formData.get("purchasePrice"),
    currency: formData.get("currency") || "AUD",
    location: formData.get("location"),
    notes: formData.get("notes"),
    warrantyRegistered: formData.get("warrantyRegistered") === "on",
    warrantyExtended: formData.get("warrantyExtended") === "on",
    warrantyProductId: formData.get("warrantyProductId"),
  };
}

export function formToPortfolioInput(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    currency: formData.get("currency") || "AUD",
    costMethod: formData.get("costMethod") || "FIFO",
  };
}

export function formToHoldingInput(formData: FormData) {
  return {
    ticker: formData.get("ticker"),
    name: formData.get("name"),
    assetClass: formData.get("assetClass") || "SHARE",
    exchange: formData.get("exchange"),
  };
}

export function formToTradeInput(formData: FormData) {
  return {
    type: formData.get("type"),
    date: formData.get("date"),
    units: formData.get("units"),
    pricePerUnit: formData.get("pricePerUnit"),
    fees: formData.get("fees"),
    currency: formData.get("currency") || "AUD",
    fxRate: formData.get("fxRate"),
    notes: formData.get("notes"),
  };
}

export function formToPropertyValuationInput(formData: FormData) {
  return {
    valuedAt: formData.get("valuedAt"),
    value: formData.get("value"),
    currency: formData.get("currency") || "AUD",
    source: formData.get("source"),
    notes: formData.get("notes"),
  };
}
