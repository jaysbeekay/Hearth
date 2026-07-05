-- Add WEALTH to ModuleKey (SQLite stores enums as TEXT, no column change needed)

-- CreateTable: portfolios
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "portfolios_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: holdings
CREATE TABLE "holdings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT,
    "assetClass" TEXT NOT NULL DEFAULT 'SHARE',
    "exchange" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "holdings_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "holdings_portfolioId_ticker_key" ON "holdings"("portfolioId", "ticker");

-- CreateTable: trades
CREATE TABLE "trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holdingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "units" REAL NOT NULL,
    "pricePerUnit" REAL NOT NULL,
    "fees" REAL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "fxRate" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trades_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "holdings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: trade_documents
CREATE TABLE "trade_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_documents_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: price_cache
CREATE TABLE "price_cache" (
    "ticker" TEXT NOT NULL PRIMARY KEY,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "changePct" REAL,
    "source" TEXT NOT NULL,
    "cachedAt" DATETIME NOT NULL
);

-- CreateTable: property_valuations
CREATE TABLE "property_valuations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "valuedAt" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "property_valuations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
