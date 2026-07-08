-- AlterTable: add market price snapshot to trades
ALTER TABLE "trades" ADD COLUMN "marketPriceOnDate" REAL;

-- CreateTable: per-ticker per-day closing price history
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticker" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "close" REAL NOT NULL,
    "adjClose" REAL,
    "source" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "price_history_ticker_date_key" ON "price_history"("ticker", "date");
