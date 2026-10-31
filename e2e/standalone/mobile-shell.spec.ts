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
    const sqliteRuns: { statement: string; values: unknown[]; transaction?: boolean }[] = [];
    const scheduledNotifications: unknown[] = [];
    const fileWrites: { directory?: string; path?: string; data?: string }[] = [];
    const fileDeletes: { directory?: string; path?: string }[] = [];
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
      // #353 — Broadband Plan's previous Term.
      contract_terms: [
        {
          id: "term-1",
          contract_id: "contract-1",
          start_date: "2097-07-01",
          end_date: "2098-06-30",
          cost: 80,
          currency: "AUD",
          billing_frequency: "MONTHLY",
          document_id: "document-contract-2097",
          created_at: "2098-06-20T00:00:00.000Z",
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
          next_service_due: "2099-06-01",
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
          // Rental tracking on, so its current Tenancy's lease end gets Reminders (#388).
          is_rented: 1,
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
          warranty_product_id: "product-1",
          warranty_registered: 1,
          warranty_extended: 0,
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
        // #455 — Documents for the Trash tests, picked by
        // localStorage "hearth-test-doc-versions" (see docVersionRows).
        ...docVersionRows(localStorage.getItem("hearth-test-doc-versions") ?? ""),
        // #353 — Broadband Plan's paperwork: the prior Term's (linked to
        // term-1), the current policy, and a newer receipt. Only for the
        // tests that ask (withContractDocuments), since the document tests
        // count what's listed.
        ...(localStorage.getItem("hearth-test-contract-documents") !== "1" ? [] : [
          ["document-contract-2097", "broadband-2097.pdf", "POLICY", "2097-07-01T00:00:00.000Z"],
          ["document-contract-2098", "broadband-2098.pdf", "POLICY", "2098-07-01T00:00:00.000Z"],
          ["document-contract-receipt", "broadband-receipt.pdf", "RECEIPT", "2099-01-02T00:00:00.000Z"],
        ].map(([id, filename, kind, uploadedAt]) => ({
          id,
          owner_type: "contract",
          owner_id: "contract-1",
          filename,
          storage_key: filename,
          mime_type: "application/pdf",
          size: 1024,
          kind,
          important: 0,
          is_head: 1,
          uploaded_at: uploadedAt,
        }))),
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

    // #455 — Broadband Plan's three-version Document (v1 <- v2 <- v3), and
    // variations on it. "1": all live. "middle": v2 in Trash. "expired":
    // v1 <- v2 <- v3 <- v4 with v2 and v3 both past retention in Trash and a
    // fresh Trash entry. "many": 25 expired Trash entries. "cycle": two live
    // versions that each supersede the other. "tip": a trashed newer version
    // on the vehicle's document.
    function docVersionRows(mode: string) {
      const base = { owner_type: "contract", owner_id: "contract-1", mime_type: "application/pdf", size: 1024, important: 0, deleted_at: null as string | null };
      const version = (id: string, supersedesId: string | null, uploadedAt: string, extra: Record<string, unknown> = {}) => ({
        ...base,
        id,
        filename: `${id.replace("version-", "lease-v")}.pdf`,
        storage_key: `${id.replace("version-", "lease-v")}.pdf`,
        supersedes_id: supersedesId,
        is_head: 0,
        uploaded_at: uploadedAt,
        ...extra,
      });
      if (mode === "1" || mode === "middle") {
        return [
          version("version-1", null, "2099-01-01T00:00:00.000Z"),
          version("version-2", "version-1", "2099-01-02T00:00:00.000Z", { deleted_at: mode === "middle" ? "2099-01-04T00:00:00.000Z" : null }),
          version("version-3", "version-2", "2099-01-03T00:00:00.000Z", { is_head: 1 }),
        ];
      }
      if (mode === "expired") {
        return [
          version("version-1", null, "2099-01-01T00:00:00.000Z"),
          version("version-2", "version-1", "2099-01-02T00:00:00.000Z", { deleted_at: "2099-01-10T00:00:00.000Z" }),
          version("version-3", "version-2", "2099-01-03T00:00:00.000Z", { deleted_at: "2099-01-10T12:00:00.000Z" }),
          version("version-4", "version-3", "2099-01-20T00:00:00.000Z", { is_head: 1 }),
          // Trashed at the newest moment in the database: never past retention.
          { ...base, id: "fresh-trash", filename: "fresh-trash.pdf", storage_key: "fresh-trash.pdf", supersedes_id: null, is_head: 1, uploaded_at: "2099-01-05T00:00:00.000Z", deleted_at: "2099-01-20T00:00:00.000Z" },
        ];
      }
      if (mode === "many") {
        return [
          version("version-live", null, "2099-02-20T00:00:00.000Z", { is_head: 1 }),
          ...Array.from({ length: 25 }, (_, index) => ({
            ...base,
            id: `trash-${String(index).padStart(2, "0")}`,
            filename: `trash-${index}.pdf`,
            storage_key: `trash-${index}.pdf`,
            supersedes_id: null,
            is_head: 1,
            uploaded_at: `2099-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            deleted_at: `2099-01-${String(index + 1).padStart(2, "0")}T06:00:00.000Z`,
          })),
        ];
      }
      if (mode === "cycle") {
        return [
          version("version-1", "version-2", "2099-01-01T00:00:00.000Z"),
          version("version-2", "version-1", "2099-01-02T00:00:00.000Z"),
        ];
      }
      if (mode === "tip") {
        return [{
          ...base,
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          id: "document-1b",
          filename: "insurance-2.pdf",
          storage_key: "insurance-2.pdf",
          sha256: "other-hash",
          supersedes_id: "document-1",
          is_head: 0,
          uploaded_at: "2099-01-02T00:00:00.000Z",
          deleted_at: "2099-01-03T00:00:00.000Z",
        }];
      }
      return [];
    }

    function rowsFor(statement: string, values: unknown[] = []) {
      const match = statement.match(/FROM\s+([a-z_]+)/i);
      if (!match) return [];
      const table = match[1];
      const rows = rowsByTable[table] ?? [];
      if (table === "documents") {
        // Each clause narrows the rows, like the WHERE it mirrors.
        let documents = rows as { id?: string; deleted_at?: string | null; storage_key?: string; uploaded_at?: string }[];
        let next = 0;
        if (/WHERE id = \?/i.test(statement)) {
          const wanted = values[next++];
          documents = documents.filter((row) => row.id === wanted);
        }
        if (/storage_key = \?/i.test(statement)) {
          const key = values[next++];
          documents = documents.filter((row) => row.storage_key === key);
        }
        if (/AND id <> \?/i.test(statement)) {
          const id = values[next++];
          documents = documents.filter((row) => row.id !== id);
        }
        if (/deleted_at IS NOT NULL/i.test(statement)) documents = documents.filter((row) => row.deleted_at);
        else if (/deleted_at IS NULL/i.test(statement)) documents = documents.filter((row) => !row.deleted_at);
        if (/deleted_at < \?/i.test(statement)) {
          const cutoff = String(values[next++]);
          documents = documents.filter((row) => (row.deleted_at ?? "") < cutoff);
        }
        if (/ORDER BY uploaded_at DESC/i.test(statement)) documents = [...documents].sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
        if (/LIMIT \?/i.test(statement)) documents = documents.slice(0, Number(values[next++]));
        return documents;
      }
      if (table === "inbox_documents" && /storage_key = \?/i.test(statement)) {
        return (rows as { storage_key?: string; deleted_at?: string | null }[]).filter((row) => row.storage_key === values[0] && (!/deleted_at IS NULL/i.test(statement) || !row.deleted_at));
      }
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

    // Applies the statements the tests follow across renders to the rows. A
    // Document statement that matches none of the patterns throws, so a new
    // statement shape can't silently do nothing (#455).
    function applyStatement(statement: string, values: unknown[]) {
      const sql = statement.trim();
      // Tenancy edits and deletes land in the rows, so a resync of local
      // Reminders sees them (#388); a deleted contract goes too (#455), and
      // so does archiving a Vehicle or Property (#355).
      const rowUpdate = /^UPDATE (rental_agreements|contracts|vehicles|properties) SET (.+) WHERE id = \?$/i.exec(sql);
      if (rowUpdate && (rowUpdate[1] !== "contracts" || /deleted_at = \?/.test(rowUpdate[2]))) {
        const table = rowUpdate[1];
        const id = values[values.length - 1];
        const columns = [...rowUpdate[2].matchAll(/(\w+) = \?/g)].map((m) => m[1]);
        const rows = (rowsByTable[table] ?? []) as Record<string, unknown>[];
        const row = rows.find((candidate) => candidate.id === id);
        if (row) {
          columns.forEach((column, index) => {
            row[column] = values[index];
          });
          if (row.deleted_at) rowsByTable[table] = rows.filter((candidate) => candidate !== row);
        }
      }
      if (/^(UPDATE|DELETE FROM|INSERT( OR REPLACE)? INTO) documents\b/i.test(sql)) applyDocumentStatement(sql, values);
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
    }

    function applyDocumentStatement(sql: string, values: unknown[]) {
      const documents = (rowsByTable.documents ?? []) as Record<string, unknown>[];
      const update = /^UPDATE documents SET (.+) WHERE (id|supersedes_id) = \?$/i.exec(sql);
      if (update) {
        let next = 0;
        const assignments = update[1].split(", ").map((part) => {
          const [column, expression] = part.split(" = ");
          if (expression === "?") return [column, values[next++]] as const;
          if (expression === "NULL") return [column, null] as const;
          if (/^\d+$/.test(expression)) return [column, Number(expression)] as const;
          if (expression === "version + 1") return null;
          throw new Error(`Mock: unsupported assignment in: ${sql}`);
        });
        const whereValue = values[next];
        for (const row of documents.filter((candidate) => candidate[update[2]] === whereValue)) {
          for (const assignment of assignments) if (assignment) row[assignment[0]] = assignment[1];
        }
        return;
      }
      if (/^DELETE FROM documents WHERE id = \?$/i.test(sql)) {
        rowsByTable.documents = documents.filter((row) => row.id !== values[0]);
        return;
      }
      const insert = /^INSERT( OR REPLACE)? INTO documents \(([^)]+)\) VALUES \((.+)\)$/i.exec(sql);
      if (insert) {
        const columns = insert[2].split(",").map((column) => column.trim());
        const placeholders = insert[3].split(",").map((part) => part.trim());
        let next = 0;
        const row: Record<string, unknown> = { deleted_at: null };
        columns.forEach((column, index) => {
          row[column] = placeholders[index] === "?" ? values[next++] : Number(placeholders[index]);
        });
        rowsByTable.documents = [...documents.filter((candidate) => candidate.id !== row.id), row];
        return;
      }
      throw new Error(`Mock: unhandled documents statement: ${sql}`);
    }

    (window as Window & { Capacitor?: unknown; __hearthStandaloneTest?: unknown }).__hearthStandaloneTest = { sqliteRuns, scheduledNotifications, fileWrites, fileDeletes };
    (window as Window & { Capacitor?: unknown; __hearthStandaloneTest?: unknown }).Capacitor = {
      getPlatform: () => "ios",
      Plugins: {
        CapacitorSQLite: {
          createConnection: async () => ({}),
          open: async () => ({}),
          execute: async () => ({ changes: { changes: 0 } }),
          run: async ({ statement, values = [] }: { statement: string; values?: unknown[] }) => {
            sqliteRuns.push({ statement, values });
            applyStatement(statement, values);
            return { changes: { changes: 1 } };
          },
          query: async ({ statement, values = [] }: { statement: string; values?: unknown[] }) => ({ values: rowsFor(statement, values) }),
          // Recorded like run(), one entry per statement, tagged so a test
          // can tell the statements went in together.
          executeSet: async ({ set, transaction }: { set: { statement: string; values?: unknown[] }[]; transaction?: boolean }) => {
            for (const item of set) {
              sqliteRuns.push({ statement: item.statement, values: item.values ?? [], transaction });
              applyStatement(item.statement, item.values ?? []);
            }
            return { changes: { changes: set.length } };
          },
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
          deleteFile: async (args: { directory?: string; path?: string }) => {
            const failure = localStorage.getItem("hearth-test-delete-file-error");
            if (failure === "missing") throw new Error("File does not exist");
            if (failure === "other") throw new Error("Disk error");
            fileDeletes.push(args);
            return {};
          },
        },
        LocalNotifications: {
          checkPermissions: async () => ({ display: "granted" }),
          requestPermissions: async () => ({ display: "granted" }),
          createChannel: async () => ({}),
          schedule: async ({ notifications = [] }: { notifications?: unknown[] }) => {
            scheduledNotifications.push(...notifications);
            return {};
          },
          cancel: async ({ notifications = [] }: { notifications?: { id: unknown }[] }) => {
            const cancelled = new Set(notifications.map((notification) => notification.id));
            const kept = scheduledNotifications.filter((notification) => !cancelled.has((notification as { id?: unknown }).id));
            scheduledNotifications.splice(0, scheduledNotifications.length, ...kept);
            return {};
          },
          getPending: async () => ({ notifications: [] }),
        },
        ServerConfig: {
          getServerUrl: async () => ({ url: "" }),
          importClientCertificate: async () => ({ label: "Test certificate" }),
        },
        // This suite exercises standalone mode's data/UI, not the purchase
        // gate itself (see paywall.spec.ts) — always entitled here so the
        // existing "Use on this device" flow below reaches standalone mode.
        Purchases: {
          configure: async () => ({}),
          getCustomerInfo: async () => ({ customerInfo: { entitlements: { active: { standalone_mode: { identifier: "standalone_mode", isActive: true } } } } }),
          getOfferings: async () => ({ current: null, all: {} }),
          purchasePackage: async () => ({ productIdentifier: "standalone_unlock", customerInfo: { entitlements: { active: { standalone_mode: { identifier: "standalone_mode", isActive: true } } } } }),
          restorePurchases: async () => ({ customerInfo: { entitlements: { active: { standalone_mode: { identifier: "standalone_mode", isActive: true } } } } }),
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
  // #332's terminology rename applies to the view title (typeLabel); the
  // space-constrained bottom nav keeps the original short labels.
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

test("standalone property screens expose 0.16 tenancies and statements", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Properties/ }).click();
  await expect(page.locator("#view-title")).toHaveText("Properties");
  await page.getByRole("button", { name: /Home.*1 Hearth Street/ }).click();

  await expect(page.getByRole("heading", { name: "Tenancy", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tenancies" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tenancy · Alex Tenant/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental statements" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Statement · 2099-02-01/ })).toBeVisible();

  await page.getByRole("button", { name: /Tenancy · Alex Tenant/ }).click();
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

test("standalone reminder setup states are neutral and counted once (#412)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();

  // The Broadband Plan is held for review: it can't run, so it is Missing
  // setup only, not also Due soon, and its badge is neutral.
  const miniCard = (title: string) => page.locator(".mini-card").filter({ hasText: title }).locator("strong");
  await expect(miniCard("Due soon / overdue")).toHaveText("0");
  await expect(miniCard("Missing setup")).toHaveText("1");

  const held = page.locator(".record-card").filter({ hasText: "Broadband Plan" });
  await expect(held).not.toHaveClass(/warning-card|danger-card/);
  const badge = held.locator(".badge").filter({ hasText: "Held" });
  await expect(badge).not.toHaveClass(/warning|danger/);
  const colours = await badge.evaluate((el) => {
    const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    const probe = document.createElement("span");
    probe.style.color = muted;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(el).color, expected };
  });
  expect(colours.actual).toBe(colours.expected);
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
      // A backup from before #355 has no archived_at: the Vehicle imports as not Archived.
      vehicles: [
        {
          id: "vehicle-imported",
          label: "Old Backup Car",
          created_at: "2099-01-01T00:00:00.000Z",
          updated_at: "2099-01-01T00:00:00.000Z",
          version: 1,
        },
      ],
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
  const importedVehicle = snapshot?.sqliteRuns.find((run) => run.statement.includes("INSERT OR REPLACE INTO vehicles") && run.values.includes("vehicle-imported"));
  expect(importedVehicle?.statement).toContain("archived_at");
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

test("standalone dashboard lists net-worth parts separately and they sum to the total (#440)", async ({ page }) => {
  const cards = page.locator(".mini-card");
  // Fixture: property 900,000 + items 1,800 + holdings (10 × 100) = 902,800.
  await expect(cards.filter({ hasText: "Net worth" }).locator("strong")).toHaveText("AUD 902,800");
  await expect(cards.filter({ hasText: "Shares, ETFs and crypto" }).locator("strong")).toHaveText("AUD 1,000");
  await expect(cards.filter({ hasText: "Property" }).locator("strong")).toHaveText("AUD 900,000");
  await expect(cards.filter({ hasText: "Items" }).locator("strong")).toHaveText("AUD 1,800");
  // The old combined tile is gone, and the listed parts add up to the total.
  await expect(cards.filter({ hasText: "Home + inventory" })).toHaveCount(0);
  const parts = await cards.filter({ hasText: /Shares, ETFs and crypto|Property|Items/ }).locator("strong").allTextContents();
  const total = parts.reduce((sum, text) => sum + Number(text.replace(/[^0-9.]/g, "")), 0);
  expect(total).toBe(902800);
});

test("standalone CSV import infers CRYPTO from the Asset Class or Exchange column (#440)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Wealth/ }).click();
  await page.getByRole("button", { name: /Family Portfolio/ }).click();

  await page.locator('form[data-import-trades-portfolio-id="portfolio-1"] input[type="file"]').setInputFiles({
    name: "crypto.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Ticker,Type,Units,Price,Fees,Currency,Asset Class,Exchange\n" +
      "2099-02-01,BTC,BUY,0.5,90000,1,AUD,Crypto,\n" +
      "2099-02-02,ETH,BUY,4,5000,1,AUD,,CRYPTO\n" +
      "2099-02-03,XYZ,BUY,10,42.50,1,AUD,,\n",
    ),
  });
  await page.locator('form[data-import-trades-portfolio-id="portfolio-1"]').getByRole("button", { name: "Import CSV trades" }).click();

  await expect(page.locator("#standalone-status")).toContainText("Imported 3 trades");
  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  const holdingInsert = (ticker: string) =>
    runs.find((run) => run.statement.includes("INSERT INTO holdings") && run.values.includes(ticker));
  // Asset Class says Crypto → CRYPTO; Exchange says CRYPTO → CRYPTO;
  // neither → SHARE, never guessed from the ticker.
  expect(holdingInsert("BTC")?.values).toContain("CRYPTO");
  expect(holdingInsert("ETH")?.values).toContain("CRYPTO");
  expect(holdingInsert("XYZ")?.values).toContain("SHARE");
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

test("standalone records view uses the policies/warranties terminology", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: "Contracts" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: "Warranties" })).toBeVisible();
});

test("standalone warranty form links a warranty to a property", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Warranties" }).click();
  await page.getByRole("button", { name: /Laptop/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator('select[name="propertyId"]')).toBeVisible();
  await page.locator('select[name="propertyId"]').selectOption("property-1");
  await page.locator('form[data-save-type="products"]').getByRole("button", { name: "Save" }).click();

  const runs = await page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
  expect(
    runs.some(
      (run) => run.statement.includes("UPDATE products SET") && run.statement.includes("property_id = ?") && run.values.includes("property-1"),
    ),
  ).toBe(true);
});

test("standalone inventory item links to a warranty, and the warranty lists it back", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-record-type="inventoryItems"]').click();
  await page.getByRole("button", { name: /Camera/ }).click();
  await expect(page.getByText("Warranty registered")).toBeVisible();

  await page.locator(".bottom-nav").getByRole("button", { name: "Warranties" }).click();
  await page.getByRole("button", { name: /Laptop/ }).click();
  await expect(page.getByRole("heading", { name: "Linked inventory" })).toBeVisible();
  await expect(page.locator(".list").getByRole("button", { name: /Camera/ })).toBeVisible();
});

test("standalone vehicle service-due date feeds the detail page, calendar and reminders", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-record-type="vehicles"]').click();
  await page.getByRole("button", { name: /Family Car/ }).click();
  await expect(page.getByText("Next service due")).toBeVisible();

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();
  await expect(
    page.locator(".record-card").filter({ hasText: "Family Car" }).filter({ hasText: "Service" }),
  ).toHaveCount(1);
});

test("standalone schedules a local Reminder for a tenancy's lease end (#388)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();
  const card = page.locator(".record-card").filter({ hasText: "Lease" }).filter({ hasText: "Home" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2099-12-31");

  await page.getByRole("button", { name: "Enable reminders" }).click();
  const scheduled = await page.evaluate(() => {
    return (window as Window & {
      __hearthStandaloneTest?: {
        scheduledNotifications: { body?: string; extra?: { recordId?: string; ownerType?: string; field?: string; threshold?: number } }[];
      };
    }).__hearthStandaloneTest?.scheduledNotifications ?? [];
  });
  const lease = scheduled.filter((notification) => notification.extra?.recordId === "rental-agreement-1");
  expect(lease.map((notification) => notification.extra?.threshold).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 7, 14, 30]);
  expect(lease.every((notification) => notification.extra?.ownerType === "TENANCY" && notification.extra?.field === "leaseEnd")).toBe(true);
  expect(lease[0].body).toContain("Lease for Home ends 2099-12-31");

  // A Tenancy has no page of its own: the card opens its Property.
  await card.click();
  await expect(page.getByRole("heading", { name: "Tenancies" })).toBeVisible();

  const leaseBodies = () =>
    page.evaluate(() => {
      const scheduled = (window as Window & {
        __hearthStandaloneTest?: { scheduledNotifications: { body?: string; extra?: { recordId?: string } }[] };
      }).__hearthStandaloneTest?.scheduledNotifications ?? [];
      return scheduled.filter((n) => n.extra?.recordId === "rental-agreement-1").map((n) => n.body ?? "");
    });

  // Moving the lease end reschedules its Reminders.
  await page.getByRole("button", { name: /Tenancy · Alex Tenant/ }).click();
  await page.locator('button[data-form-type="rentalAgreements"][data-id="rental-agreement-1"]').click();
  await page.locator('input[name="reminderDaysBefore"]').fill("soon");
  await page.locator('form[data-save-type="rentalAgreements"]').getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Reminder thresholds must be whole days");
  await page.locator('input[name="reminderDaysBefore"]').fill("");
  await page.locator('input[name="leaseEnd"]').fill("2099-11-30");
  await page.locator('form[data-save-type="rentalAgreements"]').getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Saved");
  await expect.poll(leaseBodies).toHaveLength(4);
  expect((await leaseBodies()).every((body) => body.includes("ends 2099-11-30"))).toBe(true);

  // Deleting the Tenancy cancels them.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Tenancy · Alex Tenant/ }).click();
  await page.locator('button[data-delete-record="rentalAgreements"][data-id="rental-agreement-1"]').click();
  await expect.poll(leaseBodies).toEqual([]);
});

test("standalone Archive takes a Vehicle out of Upcoming and Reminders, and Restore brings it back (#355)", async ({ page }) => {
  const reminderCards = () =>
    page.locator(".record-card").filter({ hasText: "Family Car" }).filter({ hasText: /Rego|Insurance|Service/ });
  const open = async (nav: string) => {
    await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
    await page.locator(`#mobile-view button[data-nav="${nav}"]`).click();
  };

  await open("reminders");
  await expect(reminderCards()).toHaveCount(3);

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-record-type="vehicles"]').click();
  await page.getByRole("button", { name: /Family Car/ }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#standalone-status")).toContainText("Archived");
  await expect(page.getByText(/Archived on/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reminder health" })).toHaveCount(0);

  await open("reminders");
  await expect(reminderCards()).toHaveCount(0);
  await open("calendar");
  await expect(page.locator(".record-card").filter({ hasText: "Family Car" })).toHaveCount(0);

  // Still listed, with its history, under the Archived filter only.
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-record-type="vehicles"]').click();
  await expect(page.getByRole("button", { name: /Family Car/ })).toHaveCount(0);
  await page.locator('.chip[data-record-filter="archived"]').click();
  await expect(page.getByRole("button", { name: /Family Car/ })).toContainText("Archived");
  await page.getByRole("button", { name: /Family Car/ }).click();
  await expect(page.getByRole("button", { name: /Annual service/ })).toBeVisible();

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator("#standalone-status")).toContainText("Restored");
  await open("reminders");
  await expect(reminderCards()).toHaveCount(3);
});

test("standalone Archiving a Property stops its lease-end Reminder (#355)", async ({ page }) => {
  const leaseCard = () => page.locator(".record-card").filter({ hasText: "Lease" }).filter({ hasText: "Home" });
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();
  await expect(leaseCard()).toHaveCount(1);

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-record-type="properties"]').click();
  await page.getByRole("button", { name: /Home/ }).first().click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#standalone-status")).toContainText("Archived");

  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="reminders"]').click();
  await expect(leaseCard()).toHaveCount(0);
});

test("standalone dashboard's missing-info stat card deep-links into a pre-filtered warranty list", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Warranties missing key details/ })).toBeVisible();
  await page.getByRole("button", { name: /Warranties missing key details/ }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: "Warranties" })).toHaveClass(/active/);
  await expect(page.locator(".chip.active")).toHaveText("Missing key details");
  await expect(page.locator(".list").getByRole("button", { name: /Laptop/ })).toBeVisible();
});

type SqliteRun = { statement: string; values: unknown[]; transaction?: boolean };

async function sqliteRuns(page: import("@playwright/test").Page): Promise<SqliteRun[]> {
  return page.evaluate(() => {
    return (window as Window & { __hearthStandaloneTest?: { sqliteRuns: SqliteRun[] } }).__hearthStandaloneTest?.sqliteRuns ?? [];
  });
}

// Reloads the shell with Broadband Plan's documents seeded (see the mock).
async function withContractDocuments(page: import("@playwright/test").Page) {
  await page.evaluate(() => localStorage.setItem("hearth-test-contract-documents", "1"));
  await page.reload();
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#standalone-screen")).toBeVisible();
}

async function openBroadbandRenewal(page: import("@playwright/test").Page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await page.getByRole("button", { name: /Broadband Plan/ }).click();
  await page.getByRole("button", { name: "Renew" }).click();
  await expect(page.locator("#view-title")).toHaveText("Renew contract");
}

test("standalone Renew keeps the current Term as history and pre-fills the next one (#353)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await page.getByRole("button", { name: /Broadband Plan/ }).click();
  await expect(page.getByRole("heading", { name: "Previous terms" })).toBeVisible();
  await expect(page.getByText("2097-07-01 – 2098-06-30")).toBeVisible();
  // $89 a month now against $80 the Term before.
  await expect(page.getByText(/AUD 89 · \+11% vs prior term/)).toBeVisible();

  await page.getByRole("button", { name: "Renew" }).click();
  await expect(page.locator("#view-title")).toHaveText("Renew contract");
  // No start date to measure from, so a year from the day after the end date.
  await expect(page.locator('input[name="startDate"]')).toHaveValue("2099-07-01");
  await expect(page.locator('input[name="endDate"]')).toHaveValue("2100-06-30");
  await expect(page.locator('input[name="cost"]')).toHaveValue("89");
  await page.locator('input[name="cost"]').fill("95");
  await page.locator('form[data-save-type="contractRenewal"]').getByRole("button", { name: "Renew" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Saved");

  const runs = await sqliteRuns(page);
  const term = runs.find((run) => run.statement.includes("INSERT INTO contract_terms"));
  expect(term?.values.slice(1, 7)).toEqual(["contract-1", null, "2099-06-30", 89, "AUD", "MONTHLY"]);
  const update = runs.find((run) => run.statement.startsWith("UPDATE contracts SET start_date = ?, end_date = ?, cost = ?"));
  expect(update?.values.slice(0, 3)).toEqual(["2099-07-01", "2100-06-30", 95]);
  expect(update?.values.at(-1)).toBe("contract-1");
  // Both statements went in as one transaction.
  expect(term?.transaction).toBe(true);
  expect(update?.transaction).toBe(true);
});

test("standalone Renew refuses a new end date that isn't after the current one (#353)", async ({ page }) => {
  await openBroadbandRenewal(page);
  await page.locator('input[name="startDate"]').fill("");
  await page.locator('input[name="endDate"]').fill("2099-06-30");
  await page.locator('form[data-save-type="contractRenewal"]').getByRole("button", { name: "Renew" }).click();
  await expect(page.locator("#standalone-status")).toContainText("The new end date must be after the current one.");
  const runs = await sqliteRuns(page);
  expect(runs.some((run) => run.statement.includes("INSERT INTO contract_terms"))).toBe(false);
});

test("standalone Renew asks which paperwork goes with the Term being kept, preferring the policy (#353)", async ({ page }) => {
  await withContractDocuments(page);
  await openBroadbandRenewal(page);
  // The 2097 policy is already the prior Term's, so the choice is between
  // the current policy and a newer receipt; the policy is picked.
  const paperwork = page.locator('select[name="termDocumentId"]');
  await expect(paperwork.locator("option")).toHaveText(["broadband-receipt.pdf", "broadband-2098.pdf", "None"]);
  await expect(paperwork).toHaveValue("document-contract-2098");
  await page.locator('form[data-save-type="contractRenewal"]').getByRole("button", { name: "Renew" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Saved");
  const term = (await sqliteRuns(page)).find((run) => run.statement.includes("INSERT INTO contract_terms"));
  expect(term?.values[7]).toBe("document-contract-2098");
});

test("standalone Renew warns about an end date that has already passed (#353)", async ({ page }) => {
  await openBroadbandRenewal(page);
  const warning = page.getByText("This date has already passed");
  await expect(warning).toBeHidden();
  await page.locator('input[name="endDate"]').fill("2001-01-01");
  await expect(warning).toBeVisible();
  await page.locator('input[name="endDate"]').fill("2100-06-30");
  await expect(warning).toBeHidden();
});

test("standalone Renew adds one Term however many times it's tapped (#353)", async ({ page }) => {
  await openBroadbandRenewal(page);
  const submit = page.locator('form[data-save-type="contractRenewal"]').getByRole("button", { name: "Renew" });
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('form[data-save-type="contractRenewal"] button[type="submit"]');
    button?.click();
    button?.click();
  });
  await expect(page.locator("#standalone-status")).toContainText("Saved");
  await expect(submit).toHaveCount(0);
  const inserts = (await sqliteRuns(page)).filter((run) => run.statement.includes("INSERT INTO contract_terms"));
  expect(inserts).toHaveLength(1);
});

test("standalone Previous terms opens the prior Term's document (#353)", async ({ page }) => {
  await withContractDocuments(page);
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await page.getByRole("button", { name: /Broadband Plan/ }).click();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open broadband-2097.pdf" }).click();
  await popup;
});

// #455 — Document delete moves to Trash with an Undo, the file goes only when
// the Trash entry is purged, and the chain survives a trashed version.
type ShellPage = import("@playwright/test").Page;

async function reloadStandalone(page: ShellPage) {
  await page.reload();
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page.locator("#standalone-screen")).toBeVisible();
}

// `now` fixes the device clock before the reload, for the purge tests (the
// fixtures are dated 2099, so with the real clock nothing is ever purged).
async function withDocumentVersions(page: ShellPage, mode: string, options: { now?: string; deleteFileError?: string } = {}) {
  await page.evaluate(([value, error]) => {
    localStorage.setItem("hearth-test-doc-versions", value);
    if (error) localStorage.setItem("hearth-test-delete-file-error", error);
  }, [mode, options.deleteFileError ?? ""] as const);
  if (options.now) await page.clock.setFixedTime(new Date(options.now));
  await reloadStandalone(page);
}

async function openBroadbandPlan(page: ShellPage) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Contracts" }).click();
  await page.getByRole("button", { name: /Broadband Plan/ }).click();
}

function documentCard(page: ShellPage, filename: string) {
  return page.locator(".record-card").filter({ has: page.getByRole("heading", { name: filename }) });
}

async function shellTestState(page: ShellPage) {
  return page.evaluate(() => {
    const hook = (window as Window & { __hearthStandaloneTest?: { sqliteRuns: { statement: string; values: unknown[] }[]; fileDeletes: { path?: string }[] } }).__hearthStandaloneTest;
    return { runs: hook?.sqliteRuns ?? [], fileDeletes: hook?.fileDeletes ?? [] };
  });
}

type Run = { statement: string; values: unknown[] };
const deletedDocuments = (runs: Run[]) => runs.filter((run) => run.statement === "DELETE FROM documents WHERE id = ?").map((run) => String(run.values[0]));

// The saved Document rows, as the mock holds them after the statements.
async function savedDocuments(page: ShellPage) {
  return page.evaluate(async () => {
    const sqlite = (window as unknown as { Capacitor: { Plugins: { CapacitorSQLite: { query: (args: { statement: string }) => Promise<{ values: Record<string, unknown>[] }> } } } }).Capacitor.Plugins.CapacitorSQLite;
    return (await sqlite.query({ statement: "SELECT * FROM documents" })).values;
  });
}

test("standalone Delete moves a Document to Trash with an Undo and keeps its file (#455)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  const card = page.locator(".record-card").filter({ hasText: "insurance.pdf" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Delete" }).click();

  const status = page.locator("#standalone-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText('"insurance.pdf" moved to Recently deleted.');
  await expect(card).toHaveCount(0);
  let state = await shellTestState(page);
  expect(state.runs.some((run) => run.statement.startsWith("UPDATE documents SET deleted_at = ?") && run.values.includes("document-1"))).toBe(true);
  expect(state.fileDeletes).toEqual([]);

  await status.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".record-card").filter({ hasText: "insurance.pdf" })).toBeVisible();
  state = await shellTestState(page);
  expect(state.runs.some((run) => run.statement.includes("deleted_at = NULL") && run.values.includes("document-1"))).toBe(true);
  expect(state.fileDeletes).toEqual([]);
});

test("standalone deleting the latest version makes the previous one the latest again (#455)", async ({ page }) => {
  await withDocumentVersions(page, "1");
  await openBroadbandPlan(page);
  await expect(documentCard(page, "lease-v3.pdf").getByText("3 versions")).toBeVisible();
  await documentCard(page, "lease-v3.pdf").getByRole("button", { name: "Delete" }).click();

  // v2 is the latest now, with v1 under it; the Document isn't hidden.
  await expect(documentCard(page, "lease-v2.pdf").getByText("2 versions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "lease-v3.pdf" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "lease-v1.pdf" })).toHaveCount(0);
  let state = await shellTestState(page);
  expect(state.fileDeletes).toEqual([]);
  // is_head follows for older builds: v2 is the head now.
  expect(state.runs.some((run) => run.statement === "UPDATE documents SET is_head = ? WHERE id = ?" && run.values[0] === 1 && run.values[1] === "version-2")).toBe(true);

  await page.locator("#standalone-status").getByRole("button", { name: "Undo" }).click();
  await expect(documentCard(page, "lease-v3.pdf").getByText("3 versions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "lease-v2.pdf" })).toHaveCount(0);
  state = await shellTestState(page);
  expect(state.runs.some((run) => run.statement === "UPDATE documents SET is_head = ? WHERE id = ?" && run.values[0] === 0 && run.values[1] === "version-2")).toBe(true);
});

test("standalone a second delete keeps the first Undo; Undo steps back through them (#455)", async ({ page }) => {
  await withDocumentVersions(page, "1");
  await openBroadbandPlan(page);
  const status = page.locator("#standalone-status");
  await documentCard(page, "lease-v3.pdf").getByRole("button", { name: "Delete" }).click();
  await expect(status.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await documentCard(page, "lease-v2.pdf").getByRole("button", { name: "Delete" }).click();
  await expect(documentCard(page, "lease-v1.pdf")).toBeVisible();
  await expect(status.getByRole("button", { name: "Undo (2)" })).toBeVisible();

  // The latest delete is undone first, and the earlier Undo is still there.
  await status.getByRole("button", { name: "Undo (2)" }).click();
  await expect(documentCard(page, "lease-v2.pdf").getByText("2 versions")).toBeVisible();
  await expect(status).toContainText("Document restored.");
  await status.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(documentCard(page, "lease-v3.pdf").getByText("3 versions")).toBeVisible();
  await expect(status.getByRole("button")).toHaveCount(0);
});

test("standalone another status message doesn't drop a pending Undo (#455)", async ({ page }) => {
  await withDocumentVersions(page, "1");
  await openBroadbandPlan(page);
  await documentCard(page, "lease-v3.pdf").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#standalone-status").getByRole("button", { name: "Undo" })).toBeVisible();
  await documentCard(page, "lease-v2.pdf").getByRole("button", { name: "Mark important" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Marked important.");
  await expect(page.locator("#standalone-status").getByRole("button", { name: "Undo" })).toBeVisible();
});

test("standalone trashed middle version doesn't split the Document (#455)", async ({ page }) => {
  await withDocumentVersions(page, "middle");
  await openBroadbandPlan(page);
  // v1 <- v2 (Trash) <- v3: one Document, v3 latest with v1 under it.
  await expect(documentCard(page, "lease-v3.pdf").getByText("2 versions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "lease-v1.pdf" })).toHaveCount(0);

  // Deleting v3 leaves v1 the latest (v2 stays in Trash), not hidden.
  await documentCard(page, "lease-v3.pdf").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "lease-v1.pdf" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "lease-v3.pdf" })).toHaveCount(0);
});

test("standalone a cycle of live versions never hides a Document (#455)", async ({ page }) => {
  await withDocumentVersions(page, "cycle");
  await openBroadbandPlan(page);
  await expect(page.getByRole("heading", { name: "lease-v1.pdf" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "lease-v2.pdf" })).toBeVisible();
});

test("standalone deleting a record puts its Documents in Trash and says so (#455)", async ({ page }) => {
  await withDocumentVersions(page, "1");
  await openBroadbandPlan(page);
  let message = "";
  page.once("dialog", (dialog) => {
    message = dialog.message();
    void dialog.accept();
  });
  await page.locator('button[data-delete-record="contracts"][data-id="contract-1"]').click();
  await expect(page.locator("#standalone-status")).toContainText("Deleted.");
  expect(message).toContain("Recently deleted for 30 days");
  const state = await shellTestState(page);
  const trashed = state.runs.filter((run) => run.statement.startsWith("UPDATE documents SET deleted_at = ?")).map((run) => run.values[1]);
  expect(trashed.sort()).toEqual(["version-1", "version-2", "version-3"]);
  expect(state.fileDeletes).toEqual([]);
});

test("standalone Undo refuses to restore a Document under a deleted record (#455)", async ({ page }) => {
  await withDocumentVersions(page, "1");
  await openBroadbandPlan(page);
  await documentCard(page, "lease-v3.pdf").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#standalone-status")).toContainText("moved to Recently deleted");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('button[data-delete-record="contracts"][data-id="contract-1"]').click();
  await expect(page.locator("#standalone-status")).toContainText("Deleted.");

  await page.locator("#standalone-status").getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator("#standalone-status")).toContainText("the record it belonged to was deleted");
  const state = await shellTestState(page);
  expect(state.runs.some((run) => run.statement.includes("deleted_at = NULL"))).toBe(false);
});

test("standalone filing a new version goes on top of a trashed one (#455)", async ({ page }) => {
  await withDocumentVersions(page, "tip");
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await page.locator('form[data-file-inbox-id="inbox-1"] select[name="target"]').selectOption("vehicle|vehicle-1");
  await page.locator('form[data-file-inbox-id="inbox-1"]').getByRole("button", { name: "File document" }).click();
  // document-1's newer version is in Trash; the new one goes on top of that,
  // so it never shares a place with it.
  await expect.poll(async () => (await savedDocuments(page)).find((row) => row.filename === "receipt.pdf")?.supersedes_id).toBe("document-1b");
});

test("standalone imports an older backup whose latest version was deleted (#455)", async ({ page }) => {
  await page.locator(".bottom-nav").getByRole("button", { name: "More" }).click();
  await page.locator('#mobile-view button[data-nav="settings"]').click();
  const row = (id: string, supersedesId: string | null, extra: Record<string, unknown>) => ({
    id,
    owner_type: "contract",
    owner_id: "contract-1",
    filename: `${id}.pdf`,
    storage_key: `${id}.pdf`,
    mime_type: "application/pdf",
    size: 1,
    important: 0,
    supersedes_id: supersedesId,
    uploaded_at: "2099-01-01T00:00:00.000Z",
    version: 1,
    ...extra,
  });
  // As the old build left it: every older version is_head = 0, the latest deleted.
  const backup = {
    kind: "hearth-standalone-backup",
    version: 1,
    schemaVersion: 9,
    exportedAt: "2099-01-01T00:00:00.000Z",
    tables: { documents: [row("old-1", null, { is_head: 0 }), row("old-2", "old-1", { is_head: 0, deleted_at: "2099-01-02T00:00:00.000Z" })] },
  };
  await page.locator('form[data-import-standalone-backup-form] input[type="file"]').setInputFiles({
    name: "hearth-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator("form[data-import-standalone-backup-form]").getByRole("button", { name: "Import backup" }).click();
  await expect(page.locator("#standalone-status")).toContainText("Imported");
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "old-1.pdf" })).toBeVisible();
  expect((await shellTestState(page)).fileDeletes).toEqual([]);
});

test("standalone purge deletes expired Trash entries newest-first and relinks the chain (#455)", async ({ page }) => {
  // v1 <- v2 (Trash, expired) <- v3 (Trash, expired) <- v4 live.
  await withDocumentVersions(page, "expired", { now: "2099-03-01T00:00:00.000Z" });
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "lease-v4.pdf" })).toBeVisible();
  const state = await shellTestState(page);
  expect(deletedDocuments(state.runs)).toEqual(["version-3", "version-2"]);
  expect(state.fileDeletes.map((call) => call.path?.split("/").pop())).toEqual(["lease-v3.pdf", "lease-v2.pdf"]);
  // v4 follows v1 directly, not a deleted row, and the fresh entry stays.
  const saved = await savedDocuments(page);
  expect(saved.find((row) => row.id === "version-4")?.supersedes_id).toBe("version-1");
  expect(saved.map((row) => row.id)).toContain("fresh-trash");
  await expect(documentCard(page, "lease-v4.pdf").getByText("2 versions")).toBeVisible();
});

test("standalone purge does not trust a clock jumped far ahead (#455)", async ({ page }) => {
  await withDocumentVersions(page, "expired", { now: "2199-01-01T00:00:00.000Z" });
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "lease-v4.pdf" })).toBeVisible();
  const saved = await savedDocuments(page);
  // Past the newest timestamp in the database nothing counts as expired: the
  // entry trashed then stays, though the clock says 100 years have passed.
  expect(saved.map((row) => row.id)).toContain("fresh-trash");
  expect(deletedDocuments((await shellTestState(page)).runs)).not.toContain("fresh-trash");
});

test("standalone purge does nothing when the clock is behind the saved data (#455)", async ({ page }) => {
  await withDocumentVersions(page, "expired", { now: "2098-01-01T00:00:00.000Z" });
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "lease-v4.pdf" })).toBeVisible();
  const state = await shellTestState(page);
  expect(deletedDocuments(state.runs)).toEqual([]);
  expect(state.fileDeletes).toEqual([]);
});

test("standalone purge deletes at most 20 entries a launch (#455)", async ({ page }) => {
  await withDocumentVersions(page, "many", { now: "2099-06-01T00:00:00.000Z" });
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "lease-vlive.pdf" })).toBeVisible();
  expect(deletedDocuments((await shellTestState(page)).runs)).toHaveLength(20);
});

test("standalone purge keeps the row when the file can't be deleted, and retries (#455)", async ({ page }) => {
  await withDocumentVersions(page, "expired", { now: "2099-03-01T00:00:00.000Z", deleteFileError: "other" });
  await page.locator(".bottom-nav").getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "lease-v4.pdf" })).toBeVisible();
  expect(deletedDocuments((await shellTestState(page)).runs)).toEqual([]);
  expect((await savedDocuments(page)).map((row) => row.id)).toEqual(expect.arrayContaining(["version-2", "version-3"]));

  // A file that is already gone is fine: the rows go.
  await page.evaluate(() => localStorage.setItem("hearth-test-delete-file-error", "missing"));
  await reloadStandalone(page);
  await expect.poll(async () => deletedDocuments((await shellTestState(page)).runs)).toEqual(["version-3", "version-2"]);
});
