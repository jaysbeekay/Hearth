-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_portfolios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "costMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "portfolios_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_portfolios" ("createdAt", "createdById", "currency", "description", "id", "name", "updatedAt") SELECT "createdAt", "createdById", "currency", "description", "id", "name", "updatedAt" FROM "portfolios";
DROP TABLE "portfolios";
ALTER TABLE "new_portfolios" RENAME TO "portfolios";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
