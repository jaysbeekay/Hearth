-- CreateTable
CREATE TABLE "fx_rates" (
    "pair" TEXT NOT NULL PRIMARY KEY,
    "rate" REAL NOT NULL,
    "cachedAt" DATETIME NOT NULL
);
