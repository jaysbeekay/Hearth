import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { saveDocument, saveProductDocument } from "@/lib/storage";
import { DEMO_USER_ID, DEMO_USER_EMAIL, DEMO_USER_NAME } from "@/lib/demo/constants";

const MODULE_KEYS = ["TRAVEL", "HOME", "VEHICLES", "INVENTORY", "WEALTH"] as const;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function monthsFromNow(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

async function wipeUploads() {
  const dir = path.resolve(env.uploadsDir);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

// Deletes every row of demo data and recreates the fixed demo user in the
// SAME transaction, so there is never a moment where `prisma.user.count()`
// is observably 0 — /login and /setup both branch on that count, and a
// visible gap would let a concurrent request hit the public /setup page
// and create a real ADMIN account on the demo instance.
//
// The libsql adapter never issues `PRAGMA foreign_keys = ON` (checked in
// node_modules/@prisma/adapter-libsql — it's absent), and SQLite defaults
// foreign-key enforcement OFF per connection, so `onDelete: Cascade` in
// schema.prisma is NOT relied on here. Every table is deleted explicitly,
// children before parents.
async function wipeAndRecreateUser() {
  const passwordHash = await bcrypt.hash(randomUUID(), 12);

  await prisma.$transaction([
    // Leaf tables (documents, notification/webhook logs, auth artifacts)
    prisma.document.deleteMany({}),
    prisma.notificationLog.deleteMany({}),
    prisma.productDocument.deleteMany({}),
    prisma.productNotificationLog.deleteMany({}),
    prisma.tripSegmentDocument.deleteMany({}),
    prisma.rentalStatementDocument.deleteMany({}),
    prisma.homeItemDocument.deleteMany({}),
    prisma.vehicleItemDocument.deleteMany({}),
    prisma.vehicleNotificationLog.deleteMany({}),
    prisma.inventoryItemDocument.deleteMany({}),
    prisma.tradeDocument.deleteMany({}),
    prisma.webhookLog.deleteMany({}),
    prisma.passkeyCredential.deleteMany({}),
    prisma.passkeyChallenge.deleteMany({}),
    prisma.passwordResetToken.deleteMany({}),
    prisma.propertyValuation.deleteMany({}),
    prisma.inboxDocument.deleteMany({}),

    // Mid-level tables
    prisma.tripSegment.deleteMany({}),
    prisma.rentalStatement.deleteMany({}),
    prisma.rentalAgreement.deleteMany({}),
    prisma.homeItem.deleteMany({}),
    prisma.vehicleItem.deleteMany({}),
    prisma.trade.deleteMany({}),
    prisma.webhookEndpoint.deleteMany({}),
    prisma.holding.deleteMany({}),

    // Top-level tables
    prisma.contract.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.trip.deleteMany({}),
    prisma.property.deleteMany({}),
    prisma.vehicle.deleteMany({}),
    prisma.inventoryItem.deleteMany({}),
    prisma.portfolio.deleteMany({}),
    prisma.moduleEnablement.deleteMany({}),
    prisma.user.deleteMany({}),

    // Recreate the fixed demo user + all modules enabled, in the same
    // transaction as the delete above.
    prisma.user.create({
      data: {
        id: DEMO_USER_ID,
        name: DEMO_USER_NAME,
        email: DEMO_USER_EMAIL,
        passwordHash,
        role: "MEMBER",
      },
    }),
    prisma.moduleEnablement.createMany({
      data: MODULE_KEYS.map((key) => ({ key, enabled: true })),
    }),
  ]);
}

async function seedContracts(userId: string) {
  const [internet, carInsurance] = await Promise.all([
    prisma.contract.create({
      data: {
        title: "Home Internet — Aussie Broadband",
        category: "TELECOM",
        provider: "Aussie Broadband",
        cost: 99,
        currency: "AUD",
        billingFrequency: "MONTHLY",
        renewalType: "AUTO_RENEW",
        endDate: monthsFromNow(7),
        status: "ACTIVE",
        createdById: userId,
      },
    }),
    prisma.contract.create({
      data: {
        title: "Car Insurance",
        category: "CAR_INSURANCE",
        provider: "AAMI",
        cost: 890,
        currency: "AUD",
        billingFrequency: "ANNUALLY",
        renewalType: "MANUAL_RENEWAL",
        endDate: monthsFromNow(5),
        status: "ACTIVE",
        createdById: userId,
      },
    }),
    prisma.contract.create({
      data: {
        title: "Streaming — Netflix",
        category: "SUBSCRIPTION",
        provider: "Netflix",
        cost: 16.99,
        currency: "AUD",
        billingFrequency: "MONTHLY",
        renewalType: "AUTO_RENEW",
        status: "ACTIVE",
        createdById: userId,
      },
    }),
    prisma.contract.create({
      data: {
        title: "Home & Contents Insurance",
        category: "HOME_INSURANCE",
        provider: "Budget Direct",
        cost: 145,
        currency: "AUD",
        billingFrequency: "ANNUALLY",
        renewalType: "MANUAL_RENEWAL",
        endDate: daysFromNow(20),
        status: "ACTIVE",
        createdById: userId,
      },
    }),
    prisma.contract.create({
      data: {
        title: "Mobile Plan — Optus",
        category: "TELECOM",
        provider: "Optus",
        cost: 49,
        currency: "AUD",
        billingFrequency: "MONTHLY",
        renewalType: "AUTO_RENEW",
        endDate: daysFromNow(-10),
        status: "ACTIVE",
        createdById: userId,
      },
    }),
    prisma.contract.create({
      data: {
        title: "Gym Membership",
        category: "SUBSCRIPTION",
        provider: "Anytime Fitness",
        cost: 65,
        currency: "AUD",
        billingFrequency: "MONTHLY",
        renewalType: "AUTO_RENEW",
        endDate: monthsFromNow(2),
        status: "ACTIVE",
        createdById: userId,
      },
    }),
  ]);

  // A couple of placeholder documents so the Documents/preview features
  // aren't empty. Content is a trivial placeholder, not a real PDF.
  await saveDocument(
    internet.id,
    new File([Buffer.from("%PDF-1.4 demo placeholder")], "internet-plan.pdf", {
      type: "application/pdf",
    }),
  ).then(({ storedName, size }) =>
    prisma.document.create({
      data: {
        contractId: internet.id,
        filename: "internet-plan.pdf",
        storedName,
        mimeType: "application/pdf",
        size,
      },
    }),
  );

  await saveDocument(
    carInsurance.id,
    new File([Buffer.from("%PDF-1.4 demo placeholder")], "car-insurance-policy.pdf", {
      type: "application/pdf",
    }),
  ).then(({ storedName, size }) =>
    prisma.document.create({
      data: {
        contractId: carInsurance.id,
        filename: "car-insurance-policy.pdf",
        storedName,
        mimeType: "application/pdf",
        size,
      },
    }),
  );

  return { internet, carInsurance };
}

async function seedProducts(userId: string) {
  const vacuum = await prisma.product.create({
    data: {
      name: "Dyson V15 Vacuum",
      manufacturer: "Dyson",
      purchaseDate: daysFromNow(-100),
      warrantyEndDate: monthsFromNow(8),
      price: 899,
      currency: "AUD",
      createdById: userId,
    },
  });

  await Promise.all([
    prisma.product.create({
      data: {
        name: 'MacBook Pro 14"',
        manufacturer: "Apple",
        purchaseDate: daysFromNow(-360),
        warrantyEndDate: daysFromNow(-5),
        price: 3499,
        currency: "AUD",
        createdById: userId,
      },
    }),
    prisma.product.create({
      data: {
        name: "Dishwasher",
        manufacturer: "Bosch",
        purchaseDate: daysFromNow(-30),
        warrantyEndDate: monthsFromNow(14),
        price: 1099,
        currency: "AUD",
        createdById: userId,
      },
    }),
  ]);

  await saveProductDocument(
    vacuum.id,
    new File([Buffer.from("%PDF-1.4 demo placeholder")], "receipt.pdf", {
      type: "application/pdf",
    }),
  ).then(({ storedName, size }) =>
    prisma.productDocument.create({
      data: {
        productId: vacuum.id,
        filename: "receipt.pdf",
        storedName,
        mimeType: "application/pdf",
        size,
        kind: "INVOICE",
      },
    }),
  );
}

async function seedVehicle(userId: string) {
  const vehicle = await prisma.vehicle.create({
    data: {
      label: "Family Wagon",
      make: "Toyota",
      model: "Kluger",
      year: 2022,
      licensePlate: "ABC-123",
      regoExpiry: monthsFromNow(5),
      insuranceExpiry: monthsFromNow(3),
      createdById: userId,
    },
  });

  await prisma.vehicleItem.createMany({
    data: [
      {
        vehicleId: vehicle.id,
        type: "REGISTRATION",
        title: "Annual Registration Renewal",
        provider: "Transport NSW",
        date: daysFromNow(-250),
        cost: 890,
      },
      {
        vehicleId: vehicle.id,
        type: "SERVICE",
        title: "10,000km Service",
        provider: "Toyota Service Centre",
        date: daysFromNow(-60),
        cost: 320,
      },
    ],
  });
}

async function seedTrip(userId: string) {
  const trip = await prisma.trip.create({
    data: {
      title: "Japan Spring Break 2026",
      destination: "Tokyo & Kyoto, Japan",
      startDate: monthsFromNow(2),
      endDate: monthsFromNow(2.5),
      notes: "Cherry blossom season! JR Pass booked, hotels confirmed.",
      createdById: userId,
    },
  });

  await prisma.tripSegment.createMany({
    data: [
      {
        tripId: trip.id,
        type: "FLIGHT",
        title: "SYD → NRT (QF21)",
        provider: "Qantas",
        confirmationCode: "QF21-XJ9T22",
        startDate: monthsFromNow(2),
        endDate: monthsFromNow(2),
        location: "Sydney Kingsford Smith Airport",
        cost: 2150,
      },
      {
        tripId: trip.id,
        type: "LODGING",
        title: "Shinjuku Prince Hotel",
        provider: "Shinjuku Prince Hotel",
        startDate: monthsFromNow(2),
        endDate: monthsFromNow(2.3),
        cost: 1400,
      },
    ],
  });
}

async function seedHome(userId: string) {
  const property = await prisma.property.create({
    data: {
      label: "Beachside Apartment",
      address: "35C Clarence Street, Sydney NSW 2000",
      isRented: true,
      createdById: userId,
    },
  });

  await prisma.homeItem.create({
    data: {
      propertyId: property.id,
      type: "IMPROVEMENT",
      title: "New Balcony Screens",
      provider: "Sydney Screens Co",
      date: daysFromNow(-300),
      cost: 620,
    },
  });

  await prisma.rentalAgreement.create({
    data: {
      propertyId: property.id,
      tenantName: "Jamie Rivera",
      weeklyRent: 650,
      leaseStart: daysFromNow(-500),
    },
  });

  await prisma.rentalStatement.create({
    data: {
      propertyId: property.id,
      periodStart: daysFromNow(-30),
      periodEnd: daysFromNow(0),
      statementDate: daysFromNow(0),
      grossRent: 2600,
      managementFee: 182,
      netAmount: 2418,
    },
  });
}

async function seedInventory(userId: string) {
  await prisma.inventoryItem.createMany({
    data: [
      {
        label: "Dining Table",
        category: "FURNITURE",
        brand: "IKEA",
        purchaseDate: daysFromNow(-400),
        purchasePrice: 899,
        createdById: userId,
      },
      {
        label: "Road Bike",
        category: "SPORTING",
        brand: "Trek",
        purchaseDate: daysFromNow(-150),
        purchasePrice: 2200,
        createdById: userId,
      },
    ],
  });
}

async function seedWealth(userId: string) {
  const portfolio = await prisma.portfolio.create({
    data: {
      name: "Growth Portfolio",
      currency: "AUD",
      createdById: userId,
    },
  });

  const [cba, vas] = await Promise.all([
    prisma.holding.create({
      data: {
        portfolioId: portfolio.id,
        ticker: "CBA.AX",
        name: "Commonwealth Bank of Australia",
        assetClass: "SHARE",
        exchange: "ASX",
      },
    }),
    prisma.holding.create({
      data: {
        portfolioId: portfolio.id,
        ticker: "VAS.AX",
        name: "Vanguard Australian Shares ETF",
        assetClass: "ETF",
        exchange: "ASX",
      },
    }),
  ]);

  await Promise.all([
    prisma.trade.create({
      data: {
        holdingId: cba.id,
        type: "BUY",
        date: daysFromNow(-180),
        units: 50,
        pricePerUnit: 95.2,
      },
    }),
    prisma.trade.create({
      data: {
        holdingId: vas.id,
        type: "BUY",
        date: daysFromNow(-120),
        units: 100,
        pricePerUnit: 88.1,
      },
    }),
  ]);
}

export async function resetDemoData(): Promise<void> {
  await wipeUploads();
  await wipeAndRecreateUser();

  await seedContracts(DEMO_USER_ID);
  await seedProducts(DEMO_USER_ID);
  await seedVehicle(DEMO_USER_ID);
  await seedTrip(DEMO_USER_ID);
  await seedHome(DEMO_USER_ID);
  await seedInventory(DEMO_USER_ID);
  await seedWealth(DEMO_USER_ID);
}
