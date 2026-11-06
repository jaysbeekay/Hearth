// Sample household for the public demo instance (#553).
//
// seedDemo() fills an empty, migrated database with one fictional household
// that touches every module, so each page of the demo has something on it.
// Every record goes through the same record command (src/lib/commands) and
// Zod schema the app's own forms use, so derived state (legacy Item rows,
// link checks, the document search index) matches what the app would write.
//
// Dates are offsets from `now`, so the Due list keeps a mix of overdue,
// due-soon and later entries whatever day the seed runs. The demo image runs
// it at build time, and the nightly rebuild keeps the dates fresh.
//
// Everything here is made up: people, addresses, providers, plates, serials.
// The example.com addresses are reserved for documentation (RFC 2606).
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createContractCommand, renewContractCommand } from "@/lib/commands/contracts";
import { createProductCommand } from "@/lib/commands/products";
import { addDocumentCommand } from "@/lib/commands/documents";
import { createTripCommand, createTripSegmentCommand } from "@/lib/commands/trips";
import {
  createPropertyCommand,
  createMaintenanceRecordCommand,
  createTenancyCommand,
  createRentalStatementCommand,
  createPropertyValuationCommand,
} from "@/lib/commands/home";
import { createVehicleCommand, createServiceRecordCommand } from "@/lib/commands/vehicles";
import { createInventoryItemCommand } from "@/lib/commands/inventory";
import { createPortfolioCommand, createHoldingCommand, createTradeCommand } from "@/lib/commands/wealth";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { tripSchema, tripSegmentSchema } from "@/lib/validation/travel";
import {
  propertySchema,
  homeItemSchema,
  rentalAgreementSchema,
  rentalStatementSchema,
} from "@/lib/validation/home";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import {
  portfolioSchema,
  holdingSchema,
  tradeSchema,
  propertyValuationSchema,
} from "@/lib/validation/wealth";
import { MODULE_KEYS } from "@/lib/modules/registry";
import { textPdfBytes } from "../../e2e/textPdf";

export const DEMO_MEMBER_EMAIL = "demo@example.com";
export const DEMO_ADMIN_EMAIL = "admin@example.com";

export interface SeedDemoOptions {
  /** The day the demo's dates are counted from. */
  now?: Date;
  /** The visitors' login. It is published, so it is not a secret. */
  memberPassword: string;
  /** The maintainer's login. Never published. */
  adminPassword: string;
}

export class DemoSeedRefusedError extends Error {}

export async function seedDemo(options: SeedDemoOptions) {
  // Never seed over a real household: an existing user means this isn't a
  // fresh demo database.
  if ((await prisma.user.count()) > 0) {
    throw new DemoSeedRefusedError("The database already has users. The demo seed only runs on an empty database.");
  }

  const now = options.now ?? new Date();
  // A date-only value as the forms send it: midnight UTC, `offset` days from now.
  const day = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));

  const [adminHash, memberHash] = await Promise.all([
    bcrypt.hash(options.adminPassword, 12),
    bcrypt.hash(options.memberPassword, 12),
  ]);
  const admin = await prisma.user.create({
    data: { name: "Jordan Taylor", email: DEMO_ADMIN_EMAIL, passwordHash: adminHash, role: "ADMIN" },
  });
  // Visitors sign in as a MEMBER, never ADMIN: they can try every record
  // screen but not household administration (users, backups, webhooks).
  const member = await prisma.user.create({
    data: { name: "Riley Taylor", email: DEMO_MEMBER_EMAIL, passwordHash: memberHash, role: "MEMBER" },
  });
  await prisma.moduleEnablement.createMany({
    data: MODULE_KEYS.map((key) => ({ key, enabled: true })),
  });

  const by = member.id;

  // --- Home ---------------------------------------------------------------
  const home = await createPropertyCommand(
    propertySchema.parse({
      label: "Home",
      street: "14 Banksia Lane",
      suburb: "Riverton",
      state: "NSW",
      postcode: "2999",
      country: "Australia",
      occupancyStatus: "OWNER_OCCUPIED",
      notes: "Three-bedroom house. Spare keys are with the neighbours at number 16.",
    }),
    admin.id,
  );
  const unit = await createPropertyCommand(
    propertySchema.parse({
      label: "Investment unit",
      street: "3/27 Ocean Parade",
      suburb: "Seabreeze",
      state: "QLD",
      postcode: "4999",
      country: "Australia",
      occupancyStatus: "RENTED",
    }),
    admin.id,
  );
  for (const record of [
    { propertyId: home.id, type: "MAINTENANCE", title: "Gutter clean", provider: "Clearflow Gutters", date: day(-60), cost: 280 },
    { propertyId: home.id, type: "IMPROVEMENT", title: "New heat-pump hot water system", provider: "Riverton Plumbing", date: day(-400), cost: 3850 },
    { propertyId: home.id, type: "REPAIR", title: "Fix leaking kitchen tap", provider: "Riverton Plumbing", date: day(-15), cost: 220 },
    { propertyId: unit.id, type: "MAINTENANCE", title: "Annual smoke alarm check", provider: "SafeHome Compliance", date: day(-30), cost: 119, isTaxDeductible: true },
  ] as const) {
    const { propertyId, ...input } = record;
    await createMaintenanceRecordCommand(propertyId, homeItemSchema.parse(input));
  }
  await createTenancyCommand(
    unit.id,
    rentalAgreementSchema.parse({
      tenantName: "A. Nguyen",
      weeklyRent: 520,
      managementFeePercent: 7.5,
      leaseStart: day(-300),
      leaseEnd: day(65),
      bondAmount: 2080,
    }),
    by,
  );
  for (const months of [3, 2, 1]) {
    await createRentalStatementCommand(
      unit.id,
      rentalStatementSchema.parse({
        periodStart: day(-30 * months),
        periodEnd: day(-30 * months + 29),
        statementDate: day(-30 * months + 31),
        grossRent: 2253,
        managementFee: 169,
        otherDeductions: months === 2 ? 119 : 0,
        netAmount: months === 2 ? 1965 : 2084,
      }),
    );
  }
  for (const [propertyId, offset, value] of [
    [home.id, -730, 980000],
    [home.id, -365, 1040000],
    [home.id, -30, 1095000],
    [unit.id, -365, 560000],
    [unit.id, -20, 585000],
  ] as const) {
    await createPropertyValuationCommand(
      propertyId,
      propertyValuationSchema.parse({ valuedAt: day(offset), value, source: "Agent appraisal" }),
    );
  }

  // --- Vehicles -----------------------------------------------------------
  const hatch = await createVehicleCommand(
    vehicleSchema.parse({
      label: "Family hatch",
      make: "Toyota",
      model: "Corolla Hybrid",
      year: 2021,
      colour: "Silver",
      licensePlate: "DEM 01A",
      vin: "DEMO0000000000001",
      regoExpiry: day(9),
      nextServiceDue: day(30),
    }),
    by,
  );
  const ute = await createVehicleCommand(
    vehicleSchema.parse({
      label: "Weekend ute",
      make: "Ford",
      model: "Ranger",
      year: 2018,
      colour: "Blue",
      licensePlate: "DEM 02B",
      vin: "DEMO0000000000002",
      regoExpiry: day(150),
      insuranceExpiry: day(-2),
      nextServiceDue: day(-10),
      notes: "Tow bar fitted. Takes the roof racks for the kayak.",
    }),
    by,
  );
  for (const record of [
    { vehicleId: hatch.id, type: "SERVICE", title: "Logbook service, 45,000 km", provider: "Riverton Auto", date: day(-180), cost: 389 },
    { vehicleId: hatch.id, type: "REPAIR", title: "Two new front tyres", provider: "Tread Right Tyres", date: day(-60), cost: 640 },
    { vehicleId: ute.id, type: "ROADWORTHY", title: "Safety inspection", provider: "Riverton Auto", date: day(-200), cost: 95 },
    { vehicleId: ute.id, type: "SERVICE", title: "Major service, 120,000 km", provider: "Riverton Auto", date: day(-370), cost: 820 },
  ] as const) {
    const { vehicleId, ...input } = record;
    await createServiceRecordCommand(vehicleId, vehicleItemSchema.parse(input));
  }

  // --- Contracts ----------------------------------------------------------
  const contract = (input: Record<string, unknown>) => createContractCommand(contractSchema.parse(input), by);

  // Renewed once, so the contract has a Term in its history.
  const homeInsurance = await contract({
    title: "Home and contents insurance",
    category: "HOME_INSURANCE",
    provider: "Harbourside Insurance",
    contractNumber: "HS-4471-920",
    startDate: day(-730),
    endDate: day(-365),
    renewalType: "AUTO_RENEW",
    cost: 1695,
    billingFrequency: "ANNUALLY",
    contactPhone: "1300 000 000",
    propertyId: home.id,
  });
  await renewContractCommand(homeInsurance.id, { startDate: day(-365), endDate: day(5), cost: 1840 }, by);
  const contracts = [
    { title: "Car insurance", category: "CAR_INSURANCE", provider: "Coastline Mutual", startDate: day(-344), endDate: day(21), renewalType: "AUTO_RENEW", cost: 1120, billingFrequency: "ANNUALLY", vehicleId: hatch.id },
    { title: "Electricity", category: "UTILITY", provider: "Brightside Energy", startDate: day(-400), renewalType: "AUTO_RENEW", cost: 165, billingFrequency: "MONTHLY" },
    { title: "Home internet", category: "TELECOM", provider: "Kookaburra Broadband", startDate: day(-500), renewalType: "AUTO_RENEW", cost: 89, billingFrequency: "MONTHLY" },
    { title: "Mobile phone plan", category: "TELECOM", provider: "Lyrebird Mobile", startDate: day(-369), endDate: day(-4), renewalType: "MANUAL_RENEWAL", cost: 45, billingFrequency: "MONTHLY", notes: "Ask about the loyalty discount before renewing." },
    { title: "Streaming bundle", category: "SUBSCRIPTION", provider: "StreamBox", startDate: day(-220), renewalType: "AUTO_RENEW", cost: 18.99, billingFrequency: "MONTHLY" },
    { title: "Gym membership", category: "SUBSCRIPTION", provider: "Peak Fitness", startDate: day(-320), endDate: day(45), renewalType: "FIXED_TERM", noticePeriodDays: 30, cost: 22, billingFrequency: "WEEKLY" },
    { title: "Private health cover", category: "HEALTH_INSURANCE", provider: "Wattle Health", startDate: day(-205), endDate: day(160), renewalType: "AUTO_RENEW", cost: 412, billingFrequency: "MONTHLY" },
    { title: "Home loan (fixed rate)", category: "LOAN", provider: "Southern Cross Bank", startDate: day(-195), endDate: day(900), renewalType: "FIXED_TERM", cost: 2950, billingFrequency: "MONTHLY", propertyId: home.id, notes: "Fixed rate ends on the end date; compare rates two months before." },
    { title: "Landlord insurance", category: "HOME_INSURANCE", provider: "Harbourside Insurance", startDate: day(-290), endDate: day(75), renewalType: "AUTO_RENEW", cost: 590, billingFrequency: "ANNUALLY", isTaxDeductible: true, propertyId: unit.id },
    { title: "Old mobile plan", category: "TELECOM", provider: "Lyrebird Mobile", startDate: day(-850), endDate: day(-120), renewalType: "MANUAL_RENEWAL", cost: 55, billingFrequency: "MONTHLY", status: "CANCELLED" },
  ];
  for (const input of contracts) await contract(input);

  // --- Products and warranties --------------------------------------------
  const product = (input: Record<string, unknown>) => createProductCommand(productSchema.parse(input), by);
  const fridge = await product({ description: "French door fridge", manufacturer: "Polar", model: "FD-540", vendor: "Harvey's Appliances", serialNumber: "PL540-88213", purchaseDate: day(-335), warrantyEndDate: day(395), price: 2499, propertyId: home.id });
  const drill = await product({ description: "Cordless drill kit", manufacturer: "Torque", model: "TX-18", vendor: "Hammer Hardware", serialNumber: "TQ18-55120", purchaseDate: day(-300), warrantyEndDate: day(795), price: 329 });
  const products = [
    { description: "Front-loader washing machine", manufacturer: "Polar", model: "WM-8", vendor: "Harvey's Appliances", purchaseDate: day(-718), warrantyEndDate: day(12), price: 949, propertyId: home.id },
    { description: "Laptop", manufacturer: "Northwind", model: "Aero 14", vendor: "Byte Barn", serialNumber: "NW14-2290-AX", purchaseDate: day(-400), warrantyEndDate: day(330), price: 1899 },
    { description: "65-inch TV", manufacturer: "Lumen", model: "L65-Q", vendor: "Byte Barn", purchaseDate: day(-900), warrantyEndDate: day(-170), price: 1599 },
    { description: "Robot vacuum", manufacturer: "Kestrel", model: "Swift 3", vendor: "Byte Barn", purchaseDate: day(-200), warrantyEndDate: day(530), price: 699 },
    { description: "Espresso machine", manufacturer: "Brewcraft", model: "Barista Duo", vendor: "Harvey's Appliances", purchaseDate: day(-500), warrantyEndDate: day(230), price: 1149 },
    { description: "Split-system air conditioner", manufacturer: "Aerotherm", model: "AT-71", vendor: "CoolAir Installations", purchaseDate: day(-405), warrantyEndDate: day(1420), price: 2860, propertyId: home.id },
  ];
  for (const input of products) await product(input);

  // --- Documents ----------------------------------------------------------
  // Small real PDFs, with their text given up front so the search index has
  // it straight away and no extraction job is queued.
  const pdf = (name: string, lines: string[]) => ({
    file: new File([new Uint8Array(textPdfBytes(lines))], name, { type: "application/pdf" }),
    extractedText: lines.join("\n"),
  });
  await addDocumentCommand("CONTRACT", homeInsurance.id, {
    ...pdf("policy-schedule.pdf", [
      "Harbourside Insurance - Policy schedule",
      "Policy HS-4471-920: Home and contents",
      "Insured: Jordan and Riley Taylor, 14 Banksia Lane, Riverton",
      "Building sum insured $850,000. Contents $120,000.",
      "Sample document for the Hearth demo.",
    ]),
    category: "POLICY",
  });
  await addDocumentCommand("PRODUCT", fridge.id, {
    ...pdf("fridge-receipt.pdf", [
      "Harvey's Appliances - Tax invoice",
      "Polar FD-540 French door fridge  $2,499.00",
      "Serial PL540-88213. Two-year manufacturer warranty.",
      "Sample document for the Hearth demo.",
    ]),
    category: "RECEIPT",
  });

  // --- Inventory ----------------------------------------------------------
  const items = [
    { label: "Three-seat sofa", category: "FURNITURE", brand: "Hearthwood", purchaseDate: day(-1100), purchasePrice: 2200, location: "Living room" },
    { label: "Dining table and six chairs", category: "FURNITURE", brand: "Hearthwood", purchaseDate: day(-1500), purchasePrice: 1800, location: "Dining room" },
    { label: "Mountain bike", category: "SPORTING", brand: "Ridgeline", model: "Trail 2", serialNumber: "RL-T2-77410", purchaseDate: day(-640), purchasePrice: 1450, location: "Garage" },
    { label: "Sea kayak", category: "SPORTING", brand: "Paddlecraft", purchaseDate: day(-980), purchasePrice: 1300, location: "Garage" },
    { label: "Mirrorless camera", category: "ELECTRONICS", brand: "Optix", model: "M50", serialNumber: "OX-M50-31877", purchaseDate: day(-520), purchasePrice: 1650, location: "Study" },
    { label: "Coffee grinder", category: "APPLIANCE", brand: "Brewcraft", purchaseDate: day(-480), purchasePrice: 349, location: "Kitchen" },
    { label: "Cordless drill kit", category: "TOOL", brand: "Torque", model: "TX-18", serialNumber: "TQ18-55120", purchaseDate: day(-300), purchasePrice: 329, location: "Garage", warrantyRegistered: true, warrantyProductId: drill.id },
    { label: "Acoustic guitar", category: "OTHER", brand: "Songbird", purchaseDate: day(-2000), purchasePrice: 900, location: "Study" },
    { label: "Winter ski jacket", category: "CLOTHING", brand: "Alpine Co", purchaseDate: day(-700), purchasePrice: 380, location: "Hall cupboard" },
    { label: "Cookbook collection", category: "BOOK", location: "Kitchen", notes: "About 40 books." },
    { label: "Board games", category: "MEDIA", location: "Living room" },
  ];
  for (const input of items) await createInventoryItemCommand(inventoryItemSchema.parse(input), by);

  // --- Travel -------------------------------------------------------------
  const trip = async (input: Record<string, unknown>, segments: Record<string, unknown>[]) => {
    const created = await createTripCommand(tripSchema.parse(input), by);
    for (const segment of segments) await createTripSegmentCommand(created.id, tripSegmentSchema.parse(segment));
    return created;
  };
  await trip({ title: "Tasmania long weekend", destination: "Hobart", startDate: day(-120), endDate: day(-116) }, [
    { type: "FLIGHT", title: "Sydney to Hobart", provider: "Southern Skies", flightNumber: "SS402", departureIata: "SYD", arrivalIata: "HBA", startDate: day(-120), endDate: day(-120), cost: 389 },
    { type: "LODGING", title: "Harbourfront apartment", provider: "Salamanca Stays", location: "Hobart", startDate: day(-120), endDate: day(-116), cost: 760 },
    { type: "FLIGHT", title: "Hobart to Sydney", provider: "Southern Skies", flightNumber: "SS409", departureIata: "HBA", arrivalIata: "SYD", startDate: day(-116), endDate: day(-116) },
  ]);
  await trip({ title: "Melbourne work trip", destination: "Melbourne", startDate: day(-1), endDate: day(2) }, [
    { type: "FLIGHT", title: "Sydney to Melbourne", provider: "Southern Skies", flightNumber: "SS120", departureIata: "SYD", arrivalIata: "MEL", startDate: day(-1), endDate: day(-1) },
    { type: "LODGING", title: "City hotel", provider: "Laneway Hotel", confirmationCode: "LW-58213", location: "Melbourne", startDate: day(-1), endDate: day(2), cost: 690 },
    { type: "FLIGHT", title: "Melbourne to Sydney", provider: "Southern Skies", flightNumber: "SS133", departureIata: "MEL", arrivalIata: "SYD", startDate: day(2), endDate: day(2) },
  ]);
  await trip({ title: "Japan in spring", destination: "Tokyo and Kyoto", startDate: day(40), endDate: day(54), notes: "Get rail passes before we fly." }, [
    { type: "FLIGHT", title: "Sydney to Tokyo", provider: "Pacific Air", flightNumber: "PA101", confirmationCode: "PQ7XK2", departureIata: "SYD", arrivalIata: "HND", startDate: day(40), endDate: day(40), cost: 2380 },
    { type: "LODGING", title: "Shinjuku hotel", provider: "Sakura Inn", location: "Tokyo", startDate: day(40), endDate: day(46), cost: 1420 },
    { type: "ACTIVITY", title: "Cooking class", provider: "Kitchen Tokyo", location: "Tokyo", startDate: day(43), endDate: day(43), cost: 180 },
    { type: "LODGING", title: "Ryokan stay", provider: "Hinoki House", location: "Kyoto", startDate: day(46), endDate: day(54), cost: 1980 },
    { type: "FLIGHT", title: "Osaka to Sydney", provider: "Pacific Air", flightNumber: "PA108", departureIata: "KIX", arrivalIata: "SYD", startDate: day(54), endDate: day(54) },
  ]);

  // --- Wealth -------------------------------------------------------------
  // Well-known tickers, so the live price feeds (Yahoo Finance, CoinGecko)
  // price them and gains show against the cost basis below.
  const holding = async (portfolioId: string, input: Record<string, unknown>, trades: Record<string, unknown>[]) => {
    const created = await createHoldingCommand(portfolioId, holdingSchema.parse(input));
    for (const t of trades) await createTradeCommand(created.id, tradeSchema.parse(t));
  };
  const shares = await createPortfolioCommand(
    portfolioSchema.parse({ name: "Long-term shares", description: "Index funds for retirement.", costMethod: "FIFO" }),
    by,
  );
  await holding(shares.id, { ticker: "VAS.AX", name: "Vanguard Australian Shares ETF", assetClass: "ETF" }, [
    { type: "BUY", date: day(-900), units: 50, pricePerUnit: 88.5, fees: 9.5 },
    { type: "BUY", date: day(-500), units: 40, pricePerUnit: 92.1, fees: 9.5 },
    { type: "SELL", date: day(-100), units: 20, pricePerUnit: 101.3, fees: 9.5 },
  ]);
  await holding(shares.id, { ticker: "VGS.AX", name: "Vanguard International Shares ETF", assetClass: "ETF" }, [
    { type: "BUY", date: day(-700), units: 30, pricePerUnit: 105, fees: 9.5 },
    { type: "BUY", date: day(-200), units: 25, pricePerUnit: 118, fees: 9.5 },
  ]);
  const crypto = await createPortfolioCommand(
    portfolioSchema.parse({ name: "Crypto", costMethod: "AVERAGE" }),
    by,
  );
  await holding(crypto.id, { ticker: "BTC", name: "Bitcoin", assetClass: "CRYPTO" }, [
    { type: "BUY", date: day(-600), units: 0.05, pricePerUnit: 62000 },
    { type: "BUY", date: day(-250), units: 0.03, pricePerUnit: 98000 },
  ]);
  await holding(crypto.id, { ticker: "ETH", name: "Ethereum", assetClass: "CRYPTO" }, [
    { type: "BUY", date: day(-400), units: 1.2, pricePerUnit: 4100 },
  ]);

  return { adminId: admin.id, memberId: member.id };
}
