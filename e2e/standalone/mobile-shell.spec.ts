import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";

const shellUrl = pathToFileURL(`${process.cwd()}/ios-shell/www/index.html`).toString();

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.addInitScript(() => {
    const preferences = new Map<string, string>();
    const sqliteRuns: { statement: string; values: unknown[] }[] = [];
    const scheduledNotifications: unknown[] = [];
    const fileWrites: { directory?: string; path?: string; data?: string }[] = [];
    const rowsByTable: Record<string, unknown[]> = {
      local_profile: [
        {
          id: "local",
          display_name: "Hearth standalone",
          default_currency: "AUD",
          created_at: "2099-01-01T00:00:00.000Z",
          updated_at: "2099-01-01T00:00:00.000Z",
          version: 1,
        },
      ],
      contracts: [
        {
          id: "contract-1",
          title: "Broadband Plan",
          category: "UTILITIES",
          provider: "Fibre Co",
          contract_number: "BB-123",
          end_date: "2099-06-30",
          cost: 89,
          currency: "AUD",
          billing_frequency: "MONTHLY",
          status: "ACTIVE",
          reminder_days_before: "30,14,7,1",
          extraction_pending: 1,
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      products: [
        {
          id: "product-1",
          description: "Laptop",
          manufacturer: "Example",
          model: "Pro 14",
          vendor: "Tech Store",
          warranty_end_date: "2099-03-15",
          price: 2400,
          currency: "AUD",
          reminder_days_before: "30,14,7,1",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      vehicles: [
        {
          id: "vehicle-1",
          label: "Family Car",
          make: "Toyota",
          model: "RAV4",
          license_plate: "HEARTH",
          rego_expiry: "2099-04-20",
          insurance_expiry: "2099-05-20",
          reminder_days_before: "30,14,7,1",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      vehicle_items: [
        {
          id: "vehicle-item-1",
          vehicle_id: "vehicle-1",
          type: "SERVICE",
          title: "Annual service",
          provider: "Local Mechanic",
          date: "2099-01-15",
          cost: 450,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      properties: [
        {
          id: "property-1",
          label: "Home",
          street: "1 Hearth Street",
          suburb: "Melbourne",
          state: "VIC",
          country: "Australia",
          occupancy_status: "OWNER_OCCUPIED",
          estimated_value: 900000,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      home_items: [
        {
          id: "home-item-1",
          property_id: "property-1",
          type: "INSURANCE",
          title: "Home insurance",
          provider: "Safe Home",
          date: "2099-02-01",
          cost: 1200,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      rental_agreements: [
        {
          id: "rental-agreement-1",
          property_id: "property-1",
          tenant_name: "Alex Tenant",
          weekly_rent: 650,
          management_fee_percent: 7.5,
          lease_start: "2099-01-01",
          lease_end: "2099-12-31",
          bond_amount: 2600,
          currency: "AUD",
          notes: "Baseline lease",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      rental_statements: [
        {
          id: "rental-statement-1",
          property_id: "property-1",
          period_start: "2099-01-01",
          period_end: "2099-01-31",
          statement_date: "2099-02-01",
          gross_rent: 2600,
          management_fee: 195,
          other_deductions: 30,
          net_amount: 2375,
          currency: "AUD",
          notes: "January statement",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      inventory_items: [
        {
          id: "inventory-1",
          label: "Camera",
          category: "ELECTRONICS",
          brand: "Example",
          model: "X100",
          purchase_price: 1800,
          currency: "AUD",
          location: "Office",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      trips: [
        {
          id: "trip-1",
          title: "Japan Holiday",
          destination: "Tokyo",
          start_date: "2099-09-01",
          end_date: "2099-09-14",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      trip_segments: [
        {
          id: "trip-segment-1",
          trip_id: "trip-1",
          type: "FLIGHT",
          title: "Flight to Tokyo",
          provider: "Example Air",
          confirmation_code: "TOKYO1",
          start_date: "2099-09-01",
          cost: 1600,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      portfolios: [
        {
          id: "portfolio-1",
          name: "Family Portfolio",
          description: "Long-term investments",
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      holdings: [
        {
          id: "holding-1",
          portfolio_id: "portfolio-1",
          ticker: "VAS",
          name: "Vanguard Australian Shares",
          asset_class: "ETF",
          exchange: "XASX",
          units: 10,
          average_price: 90,
          market_price: 100,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      trades: [
        {
          id: "trade-1",
          portfolio_id: "portfolio-1",
          holding_id: "holding-1",
          ticker: "VAS",
          type: "BUY",
          trade_date: "2099-01-05",
          units: 10,
          price_per_unit: 90,
          fees: 9.5,
          currency: "AUD",
          updated_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      documents: [
        {
          id: "document-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          filename: "insurance.pdf",
          storage_key: "insurance.pdf",
          mime_type: "application/pdf",
          size: 1024,
          sha256: "duplicate-hash",
          important: 0,
          is_head: 1,
          uploaded_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      inbox_documents: [
        {
          id: "inbox-1",
          filename: "receipt.pdf",
          storage_key: "receipt.pdf",
          mime_type: "application/pdf",
          size: 2048,
          status: "POSSIBLE_DUPLICATE",
          sha256: "duplicate-hash",
          uploaded_at: "2099-01-02T00:00:00.000Z",
        },
      ],
      reminder_delivery_logs: [
        {
          id: "reminder-log-1",
          owner_type: "PRODUCT",
          owner_id: "product-1",
          field: "",
          channel: "local",
          threshold_days: 30,
          status: "SCHEDULED",
          sent_at: "2099-02-13T00:00:00.000Z",
        },
      ],
    };

    function rowsFor(statement: string, values: unknown[] = []) {
      const match = statement.match(/FROM\s+([a-z_]+)/i);
      if (!match) return [];
      const table = match[1];
      const rows = rowsByTable[table] ?? [];
      if (table === "holdings" && /portfolio_id\s*=\s*\?/i.test(statement) && /ticker\s*=\s*\?/i.test(statement)) {
        const [portfolioId, ticker] = values;
        return rows.filter((row) => {
          const holding = row as { portfolio_id?: string; ticker?: string };
          return holding.portfolio_id === portfolioId && holding.ticker === ticker;
        });
      }
      if (table === "trades" && /holding_id\s*=\s*\?/i.test(statement) && /trade_date\s*=\s*\?/i.test(statement)) {
        const [holdingId, tradeDate, type, units, pricePerUnit] = values;
        return rows.filter((row) => {
          const trade = row as { holding_id?: string; trade_date?: string; type?: string; units?: number; price_per_unit?: number };
          return trade.holding_id === holdingId && trade.trade_date === tradeDate && trade.type === type && trade.units === units && trade.price_per_unit === pricePerUnit;
        });
      }
      return rows;
    }

    (window as Window & { Capacitor?: unknown; __hearthStandaloneTest?: unknown }).__hearthStandaloneTest = { sqliteRuns, scheduledNotifications, fileWrites };
    (window as Window & { Capacitor?: unknown; __hearthStandaloneTest?: unknown }).Capacitor = {
      Plugins: {
        CapacitorSQLite: {
          createConnection: async () => ({}),
          open: async () => ({}),
          execute: async () => ({ changes: { changes: 0 } }),
          run: async ({ statement, values = [] }: { statement: string; values?: unknown[] }) => {
            sqliteRuns.push({ statement, values });
            if (/INSERT OR REPLACE INTO local_profile/i.test(statement)) {
              rowsByTable.local_profile = [
                {
                  id: String(values[0] ?? "local"),
                  display_name: String(values[1] ?? "Hearth standalone"),
                  default_currency: String(values[2] ?? "AUD"),
                  created_at: "2099-01-01T00:00:00.000Z",
                  updated_at: "2099-01-02T00:00:00.000Z",
                  version: 2,
                },
              ];
            }
            return { changes: { changes: 1 } };
          },
          query: async ({ statement, values = [] }: { statement: string; values?: unknown[] }) => ({ values: rowsFor(statement, values) }),
          isSecretStored: async () => ({ result: true }),
          setEncryptionSecret: async () => ({}),
          isDatabase: async () => ({ result: true }),
          isDatabaseEncrypted: async () => ({ result: true }),
        },
        Preferences: {
          get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
          set: async ({ key, value }: { key: string; value: string }) => {
            preferences.set(key, value);
          },
          remove: async ({ key }: { key: string }) => {
            preferences.delete(key);
          },
        },
        Filesystem: {
          writeFile: async (args: { directory?: string; path?: string; data?: string }) => {
            fileWrites.push(args);
            return {};
          },
          readFile: async () => ({ data: "JVBERi0=" }),
          deleteFile: async () => ({}),
        },
        LocalNotifications: {
          checkPermissions: async () => ({ display: "granted" }),
          requestPermissions: async () => ({ display: "granted" }),
          createChannel: async () => ({}),
          schedule: async ({ notifications = [] }: { notifications?: unknown[] }) => {
            scheduledNotifications.push(...notifications);
            return {};
          },
          cancel: async () => ({}),
          getPending: async () => ({ notifications: [] }),
        },
        ServerConfig: {
          getServerUrl: async () => ({ url: "" }),
          importClientCertificate: async () => ({ label: "Test certificate" }),
        },
      },
    };
  });

  await page.goto(shellUrl);
  await expect(page.getByRole("button", { name: "Use on this device" })).toBeVisible();
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#standalone-screen")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("standalone shell follows the 0.16 mobile navigation shape", async ({ page }) => {
  await expect(page.locator(".bottom-nav .nav-item")).toHaveCount(5);
  await expect(page.locator(".bottom-nav .nav-item")).toHaveText([
    "Dashboard",
    "Contracts",
    "Warranties",
    "Documents",
    "More",
  ]);

  await expect(page.locator("#view-title")).toHaveText("Dashboard");
  await expect(page.locator(".bottom-nav").getByRole("button", { name: "Contracts", exact: true })).toBeVisible();
  await expect(page.locator(".bottom-nav").getByRole("button", { name: "Warranties", exact: true })).toBeVisible();
  await expect(page.locator(".bottom-nav").getByRole("button", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true })).toBeVisible();
});

test("standalone dashboard header and stats remain readable on mobile", async ({ page }) => {
  const titleBox = await page.locator("#view-title").boundingBox();
  const switchBox = await page.locator("#switch-mode-button").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(switchBox).not.toBeNull();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(switchBox!.x);

  await expect(page.locator("#back-button")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("#back-button")).toHaveAttribute("aria-hidden", "true");

  const statValueColor = await page.locator(".stat-card strong").first().evaluate((node) => {
    return window.getComputedStyle(node).color;
  });
  expect(statValueColor).not.toBe("rgb(255, 255, 255)");
  expect(statValueColor).not.toBe("rgba(255, 255, 255, 0)");
});

test("standalone shell exposes baseline modules and tools from More", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await expect(page.locator("#view-title")).toHaveText("More");

  for (const recordType of ["vehicles", "properties", "inventoryItems", "trips", "portfolios"]) {
    await expect(page.locator(`#mobile-view button[data-record-type="${recordType}"]`)).toBeVisible();
  }

  for (const nav of ["search", "spend", "calendar", "reminders", "import", "assistant", "settings", "help"]) {
    await expect(page.locator(`#mobile-view button[data-nav="${nav}"]`)).toBeVisible();
  }
});

test("standalone shell routes core records, documents, search, and wealth trade history", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await expect(page.locator("#view-title")).toHaveText("Contracts");
  await expect(page.getByRole("button", { name: /Broadband Plan/ })).toBeVisible();

  await page.locator(".bottom-nav").getByRole("button", { name: "Warranties" }).click();
  await expect(page.locator("#view-title")).toHaveText("Warranties");
  await expect(page.getByRole("button", { name: /Laptop/ })).toBeVisible();

  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.locator("#view-title")).toHaveText("Documents");
  await expect(page.getByText("insurance.pdf")).toBeVisible();
  await expect(page.getByText("receipt.pdf")).toBeVisible();

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="search"]').click();
  await expect(page.locator("#view-title")).toHaveText("Search");
  await page.locator("#global-search").fill("laptop");
  await expect(page.getByRole("button", { name: /Laptop/ })).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator("#view-title")).toHaveText("More");

  await page.getByRole("button", { name: /Wealth/ }).click();
  await expect(page.locator("#view-title")).toHaveText("Wealth");
  await expect(page.getByRole("button", { name: /Family Portfolio/ })).toBeVisible();
  await page.getByRole("button", { name: /Family Portfolio/ }).click();
  await expect(page.getByRole("heading", { name: "Trade history" })).toBeVisible();
  await expect(page.getByRole("button", { name: /BUY VAS/ })).toBeVisible();
});

test("standalone home screens expose 0.16 rental agreements and statements", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Home/ }).click();
  await expect(page.locator("#view-title")).toHaveText("Home");
  await page.getByRole("button", { name: /Home.*1 Hearth Street/ }).click();

  await expect(page.getByRole("heading", { name: "Rental overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental agreements" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Lease · Alex Tenant/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental statements" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Statement · 2099-02-01/ })).toBeVisible();

  await page.getByRole("button", { name: /Lease · Alex Tenant/ }).click();
  await expect(page.getByText("Weekly rent")).toBeVisible();
  await expect(page.getByText("AUD 650", { exact: true })).toBeVisible();
  await page.locator("#back-button").click();

  await page.locator('button[data-form-type="rentalStatements"]').click();
  await expect(page.locator("#view-title")).toHaveText("Add record");
  await page.locator('input[name="statementDate"]').fill("2099-03-01");
  await page.locator('input[name="grossRent"]').fill("2600");
  await page.locator('input[name="managementFee"]').fill("195");
  await page.locator('input[name="otherDeductions"]').fill("30");
  await page.locator('form[data-save-type="rentalStatements"]').getByRole("button", { name: "Save" }).click();

  await expect(page.locator("#standalone-status")).toContainText("Saved");
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("INSERT INTO rental_statements") && run.values.includes("property-1") && run.values.includes(2375))).toBe(true);
});

test("standalone shell exposes 0.16 document parity actions", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.locator(".record-card").filter({ hasText: "receipt.pdf" }).getByText("Possible duplicate")).toBeVisible();
  await expect(page.getByText(/Likely duplicate/)).toBeVisible();

  await page.getByRole("button", { name: "Mark important" }).click();
  let runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("UPDATE documents SET important = ?") && run.values.includes(1) && run.values.includes("document-1"))).toBe(true);

  await page.locator('form[data-file-inbox-id="inbox-1"] select[name="target"]').selectOption("vehicle|vehicle-1");
  await page.locator('form[data-file-inbox-id="inbox-1"]').getByRole("button", { name: "File document" }).click();
  runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("UPDATE documents SET is_head = 0") && run.values.includes("document-1"))).toBe(true);
  expect(runs.some((run) => run.statement.includes("INSERT INTO documents") && run.values.includes("document-1"))).toBe(true);
});

test("standalone detail screens expose copyable baseline identifiers", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await page.getByRole("button", { name: /Broadband Plan/ }).click();
  await expect(page.getByText("Confirm details before reminders run")).toBeVisible();
  await expect(page.getByText("Details need review; reminders are held until confirmed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Contract number" })).toBeVisible();
  await page.getByRole("button", { name: "Copy Contract number" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Copied");
  await page.getByRole("button", { name: "Confirm details" }).click();
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("UPDATE contracts SET extraction_pending = 0") && run.values.includes("contract-1"))).toBe(true);
});

test("standalone reminders hold unconfirmed records and record local schedule history", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();
  await expect(page.getByText("Last scheduled 2099-02-13 (30d)")).toBeVisible();
  await page.getByRole("button", { name: "Enable reminders" }).click();

  const snapshot = await page.evaluate(() => {
    return (window as Window & {
      __hearthStandaloneTest?: {
        sqliteRuns: { statement: string; values: unknown[] }[];
        scheduledNotifications: { extra?: { recordId?: string } }[];
      };
    }).__hearthStandaloneTest;
  });
  expect(snapshot?.scheduledNotifications.some((notification) => notification.extra?.recordId === "contract-1")).toBe(false);
  expect(snapshot?.sqliteRuns.some((run) => run.statement.includes("INSERT INTO reminder_delivery_logs") && run.values.includes("SCHEDULED"))).toBe(true);
});

test("standalone settings exports and imports local backups", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="settings"]').click();
  await expect(page.getByRole("heading", { name: "Standalone backup" })).toBeVisible();

  await page.getByRole("button", { name: "Export backup" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Backup exported");
  let snapshot = await page.evaluate(() => {
    return (window as Window & {
      __hearthStandaloneTest?: {
        fileWrites: { directory?: string; path?: string; data?: string }[];
        sqliteRuns: { statement: string; values: unknown[] }[];
      };
    }).__hearthStandaloneTest;
  });
  const backupWrite = snapshot?.fileWrites.find((write) => write.path?.startsWith("hearth-backups/hearth-standalone-"));
  expect(backupWrite?.directory).toBe("DOCUMENTS");
  expect(backupWrite?.data).toContain('"kind": "hearth-standalone-backup"');
  expect(backupWrite?.data).toContain('"contracts"');
  expect(backupWrite?.data).toContain('"rentalAgreements"');

  const backup = {
    kind: "hearth-standalone-backup",
    version: 1,
    schemaVersion: 7,
    exportedAt: "2099-01-01T00:00:00.000Z",
    tables: {
      contracts: [
        {
          id: "contract-imported",
          title: "Imported Contract",
          category: "OTHER",
          provider: "Backup Provider",
          status: "ACTIVE",
          currency: "AUD",
          reminder_days_before: "30,14,7,1",
          extraction_pending: 0,
          is_tax_deductible: 0,
          created_at: "2099-01-01T00:00:00.000Z",
          updated_at: "2099-01-01T00:00:00.000Z",
          version: 1,
        },
      ],
    },
  };
  await page.locator('form[data-import-standalone-backup-form] input[type="file"]').setInputFiles({
    name: "hearth-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator("form[data-import-standalone-backup-form]").getByRole("button", { name: "Import backup" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Imported");
  snapshot = await page.evaluate(() => {
    return (window as Window & {
      __hearthStandaloneTest?: {
        fileWrites: { directory?: string; path?: string; data?: string }[];
        sqliteRuns: { statement: string; values: unknown[] }[];
      };
    }).__hearthStandaloneTest;
  });
  expect(snapshot?.sqliteRuns.some((run) => run.statement.includes("INSERT OR REPLACE INTO contracts") && run.values.includes("contract-imported"))).toBe(true);
});

test("standalone help and local module settings mirror baseline settings/help surfaces", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="help"]').click();
  await expect(page.locator("#view-title")).toHaveText("Help");
  await expect(page.getByRole("heading", { name: "Using Hearth on mobile" })).toBeVisible();
  await expect(page.getByText("Standalone vs connected")).toBeVisible();
  await page.locator("#back-button").click();

  await page.locator('#mobile-view button[data-nav="settings"]').click();
  await expect(page.getByRole("heading", { name: "Local profile" })).toBeVisible();
  await page.locator('form[data-save-local-profile] input[name="displayName"]').fill("Travel Hearth");
  await page.locator('form[data-save-local-profile] input[name="defaultCurrency"]').fill("usd");
  await page.locator("form[data-save-local-profile]").getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Local profile saved");
  await expect(page.locator('form[data-save-local-profile] input[name="defaultCurrency"]')).toHaveValue("USD");

  await expect(page.getByRole("heading", { name: "Modules on this phone" })).toBeVisible();
  await page.locator(".module-setting-card").filter({ has: page.getByRole("heading", { name: "Wealth" }) }).getByRole("button", { name: "Hide module" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Wealth hidden");

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("button", { name: /Wealth/ })).toHaveCount(0);
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await expect(page.locator(".tabs")).not.toContainText("Wealth");
  await page.locator(".search-row").getByRole("button", { name: "Add" }).click();
  await page.locator('input[name="title"]').fill("USD Contract");
  await page.locator('input[name="provider"]').fill("Provider");
  await page.locator('form[data-save-type="contracts"]').getByRole("button", { name: "Save" }).click();

  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("INSERT OR REPLACE INTO local_profile") && run.values.includes("USD"))).toBe(true);
  expect(runs.some((run) => run.statement.includes("INSERT INTO contracts") && run.values.includes("USD"))).toBe(true);
});

test("standalone wealth portfolio imports generic CSV trades locally", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Wealth/ }).click();
  await page.getByRole("button", { name: /Family Portfolio/ }).click();

  await page.locator('form[data-import-trades-portfolio-id="portfolio-1"] input[type="file"]').setInputFiles({
    name: "trades.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Ticker,Type,Units,Price,Fees,Currency\n2099-02-01,BHP.AX,BUY,5,42.50,9.5,AUD\n"),
  });
  await page.locator('form[data-import-trades-portfolio-id="portfolio-1"]').getByRole("button", { name: "Import CSV trades" }).click();

  await expect(page.locator("#standalone-status")).toContainText("Imported 1 trade");
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("INSERT INTO holdings") && run.values.includes("BHP.AX"))).toBe(true);
  expect(runs.some((run) => run.statement.includes("INSERT INTO trades") && run.values.includes("BHP.AX") && run.values.includes(5) && run.values.includes(42.5))).toBe(true);
});

test("standalone document import accepts content-sniffed files with blank mobile MIME labels", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await page.locator('form[data-import-inbox-form] input[type="file"]').setInputFiles({
    name: "blank-type.pdf",
    mimeType: "",
    buffer: Buffer.from("%PDF-1.7\n% mobile picker omitted MIME\n"),
  });
  await page.locator("form[data-import-inbox-form]").getByRole("button", { name: "Upload document" }).click();

  await expect(page.locator("#standalone-status")).toContainText("Document imported");
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("INSERT INTO inbox_documents") && run.values.includes("blank-type.pdf") && run.values.includes("application/pdf"))).toBe(true);
});

test("standalone document import accepts content-sniffed files with generic mobile MIME labels", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await page.locator('form[data-import-inbox-form] input[type="file"]').setInputFiles({
    name: "octet-stream.pdf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("%PDF-1.7\n% mobile picker used a generic MIME label\n"),
  });
  await page.locator("form[data-import-inbox-form]").getByRole("button", { name: "Upload document" }).click();

  await expect(page.locator("#standalone-status")).toContainText("Document imported");
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(runs.some((run) => run.statement.includes("INSERT INTO inbox_documents") && run.values.includes("octet-stream.pdf") && run.values.includes("application/pdf"))).toBe(true);
});
