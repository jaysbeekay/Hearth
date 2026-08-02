// Shipped Capacitor shell for iOS and Android.
//
// Connected mode still hands off to the user's self-hosted Hearth server.
// Standalone mode is a native-device local app backed by encrypted SQLite and
// app-private file storage. Keep the standalone UI/data behavior in this live
// entrypoint until the mobile shell is generated from shared app components.
const { Capacitor } = window;
const Plugins = Capacitor?.Plugins ?? {};
const ServerConfig = Plugins.ServerConfig;
const SQLite = Plugins.CapacitorSQLite;
const Filesystem = Plugins.Filesystem;
const Preferences = Plugins.Preferences;
const LocalNotifications = Plugins.LocalNotifications;

const DB = "hearth_standalone";
const ENCRYPTED_MODE = "secret";
const ENCRYPT_EXISTING_MODE = "encryption";
const MODE_KEY = "hearth.mobile.runtimeMode";
const LAST_ATTEMPT_KEY = "lastConnectAttempt";
const LOCAL_REMINDERS_KEY = "hearth.mobile.localRemindersEnabled";
const SCHEDULED_REMINDERS_KEY = "hearth.mobile.scheduledReminderIds";
const STANDALONE_MODULES_KEY = "hearth.mobile.enabledStandaloneModules";
const RETRY_DEBOUNCE_MS = 5000;
const CLEARTEXT_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const CLEARTEXT_SUFFIXES = [".local", ".home.arpa"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const FILE_DIRECTORY = "DATA";
const BACKUP_DIRECTORY = "DOCUMENTS";
const FILE_ROOT = "standalone-documents";
const BACKUP_ROOT = "hearth-backups";
const REMINDER_CHANNEL_ID = "hearth-standalone-reminders";
const REMINDER_HOUR = 9;
const MAX_IMPORTED_TRADES = 5000;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"];
const CONTAINER_EQUIVALENTS = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};
const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const OPTIONAL_MODULES = [
  { key: "vehicles", title: "Vehicles", copy: "Cars, registration, insurance and service history.", recordType: "vehicles", countKey: "vehicles" },
  { key: "properties", title: "Home", copy: "Properties, rental records, household costs, repairs and improvements.", recordType: "properties", countKey: "properties" },
  { key: "inventoryItems", title: "Inventory", copy: "Household items, serial numbers, locations and value.", recordType: "inventoryItems", countKey: "inventoryItems" },
  { key: "trips", title: "Travel", copy: "Trips, bookings, confirmations and travel documents.", recordType: "trips", countKey: "trips" },
  { key: "portfolios", title: "Wealth", copy: "Portfolios, holdings and local trade history.", recordType: "portfolios", countKey: "portfolios" },
];
const DEFAULT_STANDALONE_MODULE_KEYS = OPTIONAL_MODULES.map((module) => module.key);
const RECORD_MODULE_ROOTS = {
  vehicles: "vehicles",
  vehicleItems: "vehicles",
  properties: "properties",
  homeItems: "properties",
  rentalAgreements: "properties",
  rentalStatements: "properties",
  inventoryItems: "inventoryItems",
  trips: "trips",
  tripSegments: "trips",
  portfolios: "portfolios",
  holdings: "portfolios",
  trades: "portfolios",
};

const schema = `
CREATE TABLE IF NOT EXISTS local_profile (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'AUD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  contract_number TEXT,
  start_date TEXT,
  end_date TEXT,
  renewal_type TEXT NOT NULL DEFAULT 'MANUAL_RENEWAL',
  notice_period_days INTEGER,
  cost REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  billing_frequency TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  notes TEXT,
  reminder_days_before TEXT DEFAULT '30,14,7,1',
  is_tax_deductible INTEGER NOT NULL DEFAULT 0,
  extraction_pending INTEGER NOT NULL DEFAULT 0,
  extraction_confirmed_at TEXT,
  property_id TEXT,
  vehicle_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  vendor TEXT,
  serial_number TEXT,
  barcode TEXT,
  purchase_date TEXT,
  warranty_end_date TEXT,
  price REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  reminder_days_before TEXT DEFAULT '30,14,7,1',
  extraction_pending INTEGER NOT NULL DEFAULT 0,
  extraction_confirmed_at TEXT,
  property_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  colour TEXT,
  license_plate TEXT,
  vin TEXT,
  rego_expiry TEXT,
  insurance_expiry TEXT,
  reminder_days_before TEXT DEFAULT '30,14,7,1',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS vehicle_items (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  date TEXT,
  cost REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  street TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  country TEXT,
  notes TEXT,
  is_rented INTEGER NOT NULL DEFAULT 0,
  occupancy_status TEXT NOT NULL DEFAULT 'OWNER_OCCUPIED',
  estimated_value REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS home_items (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  date TEXT,
  cost REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  is_tax_deductible INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rental_agreements (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  contract_id TEXT,
  tenant_name TEXT,
  weekly_rent REAL NOT NULL DEFAULT 0,
  management_fee_percent REAL,
  lease_start TEXT,
  lease_end TEXT,
  bond_amount REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rental_statements (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  statement_date TEXT,
  gross_rent REAL,
  management_fee REAL,
  other_deductions REAL,
  net_amount REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'OTHER',
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  purchase_date TEXT,
  purchase_price REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  destination TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS trip_segments (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  confirmation_code TEXT,
  start_date TEXT,
  end_date TEXT,
  location TEXT,
  cost REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'AUD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  asset_class TEXT NOT NULL DEFAULT 'SHARE',
  exchange TEXT,
  units REAL,
  average_price REAL,
  market_price REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  holding_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'BUY',
  trade_date TEXT NOT NULL,
  units REAL NOT NULL DEFAULT 0,
  price_per_unit REAL NOT NULL DEFAULT 0,
  fees REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inbox_documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  target_type TEXT,
  extracted_text TEXT,
  sha256 TEXT,
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT,
  extracted_text TEXT,
  sha256 TEXT,
  important INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT,
  is_head INTEGER NOT NULL DEFAULT 1,
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS reminder_delivery_logs (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  threshold_days INTEGER,
  status TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('standalone_schema_version', '7');
`;

const $ = (id) => document.getElementById(id);
const modeScreen = $("mode-screen");
const connectedScreen = $("connected-screen");
const standaloneScreen = $("standalone-screen");
const connectedStatus = $("connected-status");
const standaloneStatus = $("standalone-status");
const mobileView = $("mobile-view");
const viewTitle = $("view-title");
const viewKicker = $("view-kicker");
const backButton = $("back-button");
const switchModeButton = $("switch-mode-button");

const state = {
  route: "dashboard",
  recordType: "contracts",
  recordFilter: "all",
  recordQuery: "",
  documentFilter: "all",
  searchQuery: "",
  assistantQuery: "",
  localRemindersEnabled: false,
  pendingNotificationCount: null,
  enabledStandaloneModules: [...DEFAULT_STANDALONE_MODULE_KEYS],
  detail: null,
  detailBack: null,
  form: null,
  backTo: null,
};

let cache = emptyCache();

const BACKUP_TABLES = [
  { key: "profile", table: "local_profile", columns: ["id", "display_name", "default_currency", "created_at", "updated_at", "version"] },
  { key: "contracts", table: "contracts", columns: ["id", "title", "category", "provider", "contract_number", "start_date", "end_date", "renewal_type", "notice_period_days", "cost", "currency", "billing_frequency", "status", "contact_name", "contact_phone", "contact_email", "notes", "reminder_days_before", "is_tax_deductible", "extraction_pending", "extraction_confirmed_at", "property_id", "vehicle_id", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "products", table: "products", columns: ["id", "description", "manufacturer", "model", "vendor", "serial_number", "barcode", "purchase_date", "warranty_end_date", "price", "currency", "notes", "reminder_days_before", "extraction_pending", "extraction_confirmed_at", "property_id", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "vehicles", table: "vehicles", columns: ["id", "label", "make", "model", "year", "colour", "license_plate", "vin", "rego_expiry", "insurance_expiry", "reminder_days_before", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "vehicleItems", table: "vehicle_items", columns: ["id", "vehicle_id", "type", "title", "provider", "date", "cost", "currency", "notes", "deleted_at", "created_at", "updated_at", "version"] },
  { key: "properties", table: "properties", columns: ["id", "label", "street", "suburb", "state", "postcode", "country", "notes", "is_rented", "occupancy_status", "estimated_value", "currency", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "homeItems", table: "home_items", columns: ["id", "property_id", "type", "title", "provider", "date", "cost", "currency", "is_tax_deductible", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "rentalAgreements", table: "rental_agreements", columns: ["id", "property_id", "contract_id", "tenant_name", "weekly_rent", "management_fee_percent", "lease_start", "lease_end", "bond_amount", "currency", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "rentalStatements", table: "rental_statements", columns: ["id", "property_id", "period_start", "period_end", "statement_date", "gross_rent", "management_fee", "other_deductions", "net_amount", "currency", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "inventoryItems", table: "inventory_items", columns: ["id", "label", "category", "brand", "model", "serial_number", "purchase_date", "purchase_price", "currency", "location", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "trips", table: "trips", columns: ["id", "title", "destination", "start_date", "end_date", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "tripSegments", table: "trip_segments", columns: ["id", "trip_id", "type", "title", "provider", "confirmation_code", "start_date", "end_date", "location", "cost", "currency", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "portfolios", table: "portfolios", columns: ["id", "name", "description", "currency", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "holdings", table: "holdings", columns: ["id", "portfolio_id", "ticker", "name", "asset_class", "exchange", "units", "average_price", "market_price", "currency", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "trades", table: "trades", columns: ["id", "portfolio_id", "holding_id", "ticker", "type", "trade_date", "units", "price_per_unit", "fees", "currency", "notes", "created_at", "updated_at", "deleted_at", "version"] },
  { key: "documents", table: "documents", columns: ["id", "owner_type", "owner_id", "filename", "storage_key", "mime_type", "size", "kind", "extracted_text", "sha256", "important", "supersedes_id", "is_head", "uploaded_at", "deleted_at", "version"] },
  { key: "inboxDocuments", table: "inbox_documents", columns: ["id", "filename", "storage_key", "mime_type", "size", "status", "target_type", "extracted_text", "sha256", "uploaded_at", "deleted_at", "version"] },
  { key: "reminderLogs", table: "reminder_delivery_logs", columns: ["id", "owner_type", "owner_id", "field", "channel", "threshold_days", "status", "sent_at", "error"] },
];

function isSecondaryRoute(route) {
  return ["more", "search", "spend", "calendar", "reminders", "import", "assistant", "settings", "help"].includes(route);
}

function emptyCache() {
  return {
    profile: null,
    contracts: [],
    products: [],
    vehicles: [],
    vehicleItems: [],
    properties: [],
    homeItems: [],
    rentalAgreements: [],
    rentalStatements: [],
    inventoryItems: [],
    trips: [],
    tripSegments: [],
    portfolios: [],
    holdings: [],
    trades: [],
    documents: [],
    inboxDocuments: [],
    reminderLogs: [],
  };
}

function showStatus(node, message, ok = false) {
  node.textContent = message;
  node.hidden = false;
  node.classList.toggle("ok", ok);
}

function showStandaloneStatus(message, ok = false) {
  showStatus(standaloneStatus, message, ok);
  window.setTimeout(() => {
    standaloneStatus.hidden = true;
    standaloneStatus.textContent = "";
    standaloneStatus.classList.remove("ok");
  }, 3600);
}

function show(screen) {
  modeScreen.hidden = screen !== "mode";
  connectedScreen.hidden = screen !== "connected";
  standaloneScreen.hidden = screen !== "standalone";
}

async function prefGet(key) {
  if (Preferences) return (await Preferences.get({ key })).value;
  return localStorage.getItem(key);
}

async function prefSet(key, value) {
  if (Preferences) await Preferences.set({ key, value });
  localStorage.setItem(key, value);
}

async function prefRemove(key) {
  if (Preferences) await Preferences.remove({ key });
  localStorage.removeItem(key);
}

function allowsCleartext(hostname) {
  const host = hostname.toLowerCase();
  return CLEARTEXT_HOSTS.includes(host) || CLEARTEXT_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function normalizeUrl(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Address must start with http:// or https://");
  const parsed = new URL(trimmed);
  if (parsed.protocol === "http:" && !allowsCleartext(parsed.hostname)) {
    throw new Error(`Plain HTTP is not allowed for ${parsed.hostname}. Use https:// or a trusted local hostname.`);
  }
  return trimmed;
}

function recordAttempt(url) {
  localStorage.setItem(LAST_ATTEMPT_KEY, JSON.stringify({ url, ts: Date.now() }));
}

function navigateToConnectedServer(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const destination = new URL(url);
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    throw new Error("Address must start with http:// or https://");
  }
  const testHook = window.__hearthStandaloneTest?.onConnectedNavigate;
  if (typeof testHook === "function") {
    testHook(destination.href.replace(/\/+$/, ""));
    return;
  }
  window.location.replace(destination.href.replace(/\/+$/, ""));
}

function recentFailedAttempt() {
  try {
    const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (!raw) return null;
    const { url, ts } = JSON.parse(raw);
    if (url && Date.now() - ts < RETRY_DEBOUNCE_MS) return url;
  } catch {
    // Ignore malformed entries.
  }
  return null;
}

async function initDb() {
  if (!SQLite) throw new Error("Native SQLite bridge unavailable.");
  await ensureEncryptionSecret();
  const mode = await sqliteConnectionMode();
  await SQLite.createConnection({
    database: DB,
    encrypted: true,
    mode,
    version: 1,
    readonly: false,
  }).catch(() => undefined);
  await SQLite.open({ database: DB, readonly: false });
  await SQLite.execute({ database: DB, statements: schema, transaction: true });
  await ensureStandaloneSchema();
  const now = new Date().toISOString();
  await run(
    "INSERT OR IGNORE INTO local_profile (id, display_name, default_currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)",
    ["local", "Hearth standalone", "AUD", now, now],
  );
}

async function ensureStandaloneSchema() {
  await ensureColumn("documents", "sha256", "TEXT");
  await ensureColumn("documents", "important", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("documents", "supersedes_id", "TEXT");
  await ensureColumn("documents", "is_head", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("inbox_documents", "sha256", "TEXT");
  await ensureColumn("contracts", "extraction_pending", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("contracts", "extraction_confirmed_at", "TEXT");
  await ensureColumn("products", "extraction_pending", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("products", "extraction_confirmed_at", "TEXT");
  await run("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('standalone_schema_version', '7')");
}

async function ensureColumn(table, column, definition) {
  const rows = await query(`PRAGMA table_info(${table})`).catch(() => []);
  if (rows.some((row) => row.name === column)) return;
  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureEncryptionSecret() {
  const stored = await SQLite.isSecretStored().catch(() => ({ result: false }));
  if (stored.result) return;
  await SQLite.setEncryptionSecret({ passphrase: generatePassphrase() });
}

async function sqliteConnectionMode() {
  const exists = await SQLite.isDatabase({ database: DB }).catch(() => ({ result: false }));
  if (!exists.result) return ENCRYPTED_MODE;
  const encrypted = await SQLite.isDatabaseEncrypted({ database: DB }).catch(() => ({ result: false }));
  return encrypted.result ? ENCRYPTED_MODE : ENCRYPT_EXISTING_MODE;
}

function generatePassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function run(statement, values = []) {
  await SQLite.run({ database: DB, statement, values, transaction: true });
}

async function query(statement, values = []) {
  const result = await SQLite.query({ database: DB, statement, values });
  return (result.values ?? []).filter((row) => Object.keys(row).length > 0);
}

async function loadData() {
  const [
    profileRows,
    contracts,
    products,
    vehicles,
    vehicleItems,
    properties,
    homeItems,
    rentalAgreements,
    rentalStatements,
    inventoryItems,
    trips,
    tripSegments,
    portfolios,
    holdings,
    trades,
    documents,
    inboxDocuments,
    reminderLogs,
  ] = await Promise.all([
    query("SELECT * FROM local_profile WHERE id = 'local' LIMIT 1"),
    query("SELECT * FROM contracts WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM products WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM vehicle_items WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM properties WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM home_items WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM rental_agreements WHERE deleted_at IS NULL ORDER BY lease_end ASC, updated_at DESC"),
    query("SELECT * FROM rental_statements WHERE deleted_at IS NULL ORDER BY statement_date DESC, updated_at DESC"),
    query("SELECT * FROM inventory_items WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM trips WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM trip_segments WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM portfolios WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM holdings WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM trades WHERE deleted_at IS NULL ORDER BY trade_date DESC, updated_at DESC"),
    query("SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"),
    query("SELECT * FROM inbox_documents WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"),
    query("SELECT * FROM reminder_delivery_logs ORDER BY sent_at DESC LIMIT 200"),
  ]);
  cache = {
    profile: profileRows[0] ?? { id: "local", display_name: "Hearth standalone", default_currency: "AUD" },
    contracts,
    products,
    vehicles,
    vehicleItems,
    properties,
    homeItems,
    rentalAgreements,
    rentalStatements,
    inventoryItems,
    trips,
    tripSegments,
    portfolios,
    holdings,
    trades,
    documents,
    inboxDocuments,
    reminderLogs,
  };
}

async function loadReminderDeliveryState() {
  state.localRemindersEnabled = (await prefGet(LOCAL_REMINDERS_KEY)) === "true";
  if (!LocalNotifications || !state.localRemindersEnabled) {
    state.pendingNotificationCount = null;
    return;
  }
  state.pendingNotificationCount = await pendingStandaloneReminderCount();
}

async function loadStandaloneModuleSettings() {
  const raw = await prefGet(STANDALONE_MODULES_KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      state.enabledStandaloneModules = parsed.filter((key) => DEFAULT_STANDALONE_MODULE_KEYS.includes(key));
      return;
    }
  } catch {
    // Ignore malformed preferences and fall back to all optional modules.
  }
  state.enabledStandaloneModules = [...DEFAULT_STANDALONE_MODULE_KEYS];
}

async function saveStandaloneModuleSettings() {
  await prefSet(STANDALONE_MODULES_KEY, JSON.stringify(state.enabledStandaloneModules));
}

function moduleEnabled(moduleKey) {
  return state.enabledStandaloneModules.includes(moduleKey);
}

function recordTypeEnabled(type) {
  const root = RECORD_MODULE_ROOTS[type];
  return !root || moduleEnabled(root);
}

function visibleOptionalModules() {
  return OPTIONAL_MODULES.filter((module) => moduleEnabled(module.key));
}

function localId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function valueOrNull(value) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function reminderDaysOrDefault(value) {
  const days = parseReminderDays(value);
  if (days.length === 0) return "30,14,7,1";
  return days.join(",");
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function daysUntil(value) {
  if (!value) return null;
  const target = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86400000);
}

function money(amount, currency = "AUD") {
  if (amount == null || amount === "") return null;
  return `${currency} ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function defaultCurrency() {
  return String(cache.profile?.default_currency || "AUD").trim().toUpperCase() || "AUD";
}

function defaultDisplayName() {
  return String(cache.profile?.display_name || "Hearth standalone").trim() || "Hearth standalone";
}

function currencyOrDefault(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || defaultCurrency();
}

function readableDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function bytesLabel(size) {
  const number = Number(size);
  if (!Number.isFinite(number)) return "";
  if (number < 1024 * 1024) return `${Math.max(1, Math.round(number / 1024))} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function getRecord(type, id) {
  return (cache[type] ?? []).find((row) => row.id === id) ?? null;
}

function docsFor(ownerType, ownerId) {
  return cache.documents.filter((doc) => doc.owner_type === ownerType && doc.owner_id === ownerId);
}

function ownerTypeForRecordType(type) {
  if (type === "contracts") return "contract";
  if (type === "products") return "product";
  if (type === "vehicles") return "vehicle";
  if (type === "vehicleItems") return "vehicle_item";
  if (type === "properties") return "property";
  if (type === "homeItems") return "home_item";
  if (type === "rentalAgreements") return "rental_agreement";
  if (type === "rentalStatements") return "rental_statement";
  if (type === "inventoryItems") return "inventory_item";
  if (type === "trips") return "trip";
  if (type === "tripSegments") return "trip_segment";
  if (type === "portfolios") return "portfolio";
  if (type === "holdings") return "holding";
  if (type === "trades") return "trade";
  return type;
}

function typeLabel(type) {
  return {
    contracts: "Contracts",
    products: "Warranties",
    vehicles: "Vehicles",
    vehicleItems: "Vehicle items",
    properties: "Home",
    homeItems: "Home items",
    rentalAgreements: "Rental agreements",
    rentalStatements: "Rental statements",
    inventoryItems: "Inventory",
    trips: "Travel",
    tripSegments: "Trip segments",
    portfolios: "Wealth",
    holdings: "Holdings",
    trades: "Trades",
    contract: "Contract",
    product: "Warranty",
    vehicle: "Vehicle",
    vehicle_item: "Vehicle item",
    property: "Property",
    home_item: "Home item",
    rental_agreement: "Rental agreement",
    rental_statement: "Rental statement",
    inventory_item: "Inventory item",
    trip: "Trip",
    trip_segment: "Trip segment",
    portfolio: "Portfolio",
    holding: "Holding",
    trade: "Trade",
    inbox: "Inbox",
  }[type] ?? type;
}

function recordTitle(type, row) {
  if (!row) return "Record";
  if (type === "contracts") return row.title;
  if (type === "products") return row.description;
  if (type === "vehicles") return row.label;
  if (type === "vehicleItems") return row.title;
  if (type === "properties") return row.label;
  if (type === "homeItems") return row.title;
  if (type === "rentalAgreements") return row.tenant_name ? `Lease · ${row.tenant_name}` : "Rental agreement";
  if (type === "rentalStatements") return row.statement_date ? `Statement · ${readableDate(row.statement_date)}` : "Rental statement";
  if (type === "inventoryItems") return row.label;
  if (type === "trips") return row.title;
  if (type === "tripSegments") return row.title;
  if (type === "portfolios") return row.name;
  if (type === "holdings") return row.ticker;
  if (type === "trades") return `${row.type} ${row.ticker}`;
  return row.title ?? row.description ?? row.label ?? "Record";
}

function ownerLabel(doc) {
  const map = {
    contract: ["contracts", doc.owner_id],
    product: ["products", doc.owner_id],
    vehicle: ["vehicles", doc.owner_id],
    vehicle_item: ["vehicleItems", doc.owner_id],
    property: ["properties", doc.owner_id],
    home_item: ["homeItems", doc.owner_id],
    rental_agreement: ["rentalAgreements", doc.owner_id],
    rental_statement: ["rentalStatements", doc.owner_id],
    inventory_item: ["inventoryItems", doc.owner_id],
    trip: ["trips", doc.owner_id],
    trip_segment: ["tripSegments", doc.owner_id],
    portfolio: ["portfolios", doc.owner_id],
    holding: ["holdings", doc.owner_id],
    trade: ["trades", doc.owner_id],
  };
  const target = map[doc.owner_type];
  if (!target) return typeLabel(doc.owner_type);
  const record = getRecord(target[0], target[1]);
  return `${typeLabel(doc.owner_type)} · ${recordTitle(target[0], record)}`;
}

function hasDocument(type, id) {
  return docsFor(ownerTypeForRecordType(type), id).length > 0;
}

function attentionForRecord(type, row) {
  if (["contracts", "products"].includes(type) && Number(row.extraction_pending ?? 0) === 1) {
    return { tone: "warning", label: "Needs review", meta: "Confirm details before reminders run" };
  }
  if (type === "contracts") {
    const days = daysUntil(row.end_date);
    if (days == null || row.status !== "ACTIVE") return null;
    if (days < 0) return { tone: "danger", label: "Expired", meta: `Ended ${Math.abs(days)} days ago` };
    if (days <= 30) return { tone: "warning", label: "Expiring", meta: `Ends in ${days} days` };
  }
  if (type === "products") {
    const days = daysUntil(row.warranty_end_date);
    if (days == null) return null;
    if (days < 0) return { tone: "danger", label: "Warranty expired", meta: `${Math.abs(days)} days ago` };
    if (days <= 30) return { tone: "warning", label: "Warranty", meta: `Ends in ${days} days` };
  }
  if (type === "vehicles") {
    const rego = daysUntil(row.rego_expiry);
    const insurance = daysUntil(row.insurance_expiry);
    const urgent = [
      rego != null && rego <= 30 ? ["Rego", rego] : null,
      insurance != null && insurance <= 30 ? ["Insurance", insurance] : null,
    ].filter(Boolean);
    if (urgent.length === 0) return null;
    const expired = urgent.some((entry) => entry[1] < 0);
    return {
      tone: expired ? "danger" : "warning",
      label: expired ? "Vehicle overdue" : "Vehicle due",
      meta: urgent.map(([label, days]) => `${label} ${days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`}`).join(" · "),
    };
  }
  if (type === "rentalAgreements") {
    const days = daysUntil(row.lease_end);
    if (days == null) return null;
    if (days < 0) return { tone: "danger", label: "Lease ended", meta: `${Math.abs(days)} days ago` };
    if (days <= 45) return { tone: "warning", label: "Lease ending", meta: `Ends in ${days} days` };
  }
  return null;
}

function buildAttentionItems() {
  const rows = [
    ...cache.contracts.map((row) => ({ type: "contracts", row })),
    ...cache.products.map((row) => ({ type: "products", row })),
    ...(moduleEnabled("vehicles") ? cache.vehicles.map((row) => ({ type: "vehicles", row })) : []),
    ...(moduleEnabled("properties") ? cache.rentalAgreements.map((row) => ({ type: "rentalAgreements", row })) : []),
    ...(moduleEnabled("trips") ? cache.trips.map((row) => ({ type: "trips", row })) : []),
  ];
  return rows
    .map((item) => ({ ...item, attention: attentionForRecord(item.type, item.row) }))
    .filter((item) => item.attention)
    .sort((a, b) => {
      const aDanger = a.attention.tone === "danger" ? 0 : 1;
      const bDanger = b.attention.tone === "danger" ? 0 : 1;
      return aDanger - bDanger || String(a.attention.meta).localeCompare(String(b.attention.meta));
    });
}

async function storeFile(ownerType, ownerId, file) {
  if (!file || file.size === 0) return null;
  if (!Filesystem) throw new Error("Native file storage bridge unavailable.");
  const { bytes, mimeType } = await validateFile(file);
  const sha256 = await sha256Hex(bytes);
  const extension = (file.name.toLowerCase().match(/\.[a-z0-9]{1,10}$/) ?? [""])[0];
  const storageKey = `${ownerType}/${ownerId}/${crypto.randomUUID()}${extension}`;
  const data = bytesToBase64(bytes);
  await Filesystem.writeFile({
    directory: FILE_DIRECTORY,
    path: `${FILE_ROOT}/${storageKey}`,
    data,
    recursive: true,
  });
  try {
    await run(
      "INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, mime_type, size, sha256, uploaded_at, version, important, is_head) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1)",
      [localId("document"), ownerType, ownerId, file.name.slice(0, 255), storageKey, mimeType, file.size, sha256, nowIso()],
    );
  } catch (error) {
    await Filesystem.deleteFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${storageKey}` }).catch(() => undefined);
    throw error;
  }
  return storageKey;
}

async function storeInboxFile(file) {
  if (!file || file.size === 0) return null;
  if (!Filesystem) throw new Error("Native file storage bridge unavailable.");
  const { bytes, mimeType } = await validateFile(file);
  const sha256 = await sha256Hex(bytes);
  const extension = (file.name.toLowerCase().match(/\.[a-z0-9]{1,10}$/) ?? [""])[0];
  const storageKey = `inbox/${crypto.randomUUID()}${extension}`;
  await Filesystem.writeFile({
    directory: FILE_DIRECTORY,
    path: `${FILE_ROOT}/${storageKey}`,
    data: bytesToBase64(bytes),
    recursive: true,
  });
  try {
    await run(
      "INSERT INTO inbox_documents (id, filename, storage_key, mime_type, size, status, sha256, uploaded_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [localId("inbox"), file.name.slice(0, 255), storageKey, mimeType, file.size, inboxStatusForHash(sha256), sha256, nowIso()],
    );
  } catch (error) {
    await Filesystem.deleteFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${storageKey}` }).catch(() => undefined);
    throw error;
  }
  return storageKey;
}

function inboxStatusForHash(sha256) {
  if (!sha256) return "NEEDS_REVIEW";
  return cache.documents.some((doc) => doc.sha256 === sha256) ? "POSSIBLE_DUPLICATE" : "NEEDS_REVIEW";
}

async function validateFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is too large (15MB max).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) throw new Error("That file's contents don't match a supported format.");
  const labelled = GENERIC_MIME_TYPES.has(file.type) ? sniffed : file.type;
  if (!ALLOWED_MIME_TYPES.has(labelled)) throw new Error("Unsupported file type. Use PDF, Word, or image files.");
  const acceptable = CONTAINER_EQUIVALENTS[sniffed] ?? [sniffed];
  if (!acceptable.includes(labelled)) throw new Error(`That file is labelled ${labelled} but its contents are ${sniffed}.`);
  return { bytes, mimeType: labelled };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function startsWith(bytes, expected, offset = 0) {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function sniffMimeType(bytes) {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && HEIC_BRANDS.includes(ascii(bytes, 8, 12))) return "image/heic";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "application/msword";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

async function openStandalone() {
  show("standalone");
  await prefSet(MODE_KEY, "standalone");
  await initDb();
  await loadStandaloneModuleSettings();
  await loadReminderDeliveryState();
  await render();
}

async function openConnected() {
  show("connected");
  await prefSet(MODE_KEY, "connected");
  if (!ServerConfig) {
    showStatus(connectedStatus, "Native bridge unavailable. Open this build on a device or simulator.");
    return;
  }
  const { url } = await ServerConfig.getServerUrl();
  if (url) $("server-url").value = url;
}

async function autoConnectIfSaved() {
  if (!ServerConfig) return;
  const { url } = await ServerConfig.getServerUrl();
  if (!url) return;
  const normalizedUrl = normalizeUrl(url);
  $("server-url").value = normalizedUrl;
  const failedUrl = recentFailedAttempt();
  if (failedUrl === normalizedUrl) {
    localStorage.removeItem(LAST_ATTEMPT_KEY);
    showStatus(connectedStatus, `Could not reach ${normalizedUrl}. Check the address and try again.`);
    return;
  }
  showStatus(connectedStatus, `Connecting to ${normalizedUrl}...`, true);
  recordAttempt(normalizedUrl);
  navigateToConnectedServer(normalizedUrl);
}

async function render() {
  await loadData();
  if (!recordTypeEnabled(state.recordType)) {
    state.recordType = "contracts";
    state.recordFilter = "all";
  }
  const route = state.route;
  const titleMap = {
    dashboard: "Dashboard",
    records: typeLabel(state.recordType),
    documents: "Documents",
    search: "Search",
    more: "More",
    spend: "Spend",
    calendar: "Calendar",
    reminders: "Reminders",
    import: "Import",
    assistant: "Assistant",
    settings: "Settings",
    help: "Help",
    detail: "Details",
    form: state.form?.id ? "Edit record" : "Add record",
  };
  viewTitle.textContent = titleMap[route] ?? "Hearth";
  viewKicker.textContent = route === "dashboard" ? "Standalone" : "Private local records";
  const canGoBack = ["detail", "form", "search", "more", "spend", "calendar", "reminders", "import", "assistant", "settings", "help"].includes(route);
  backButton.classList.toggle("is-hidden", !canGoBack);
  backButton.toggleAttribute("aria-hidden", !canGoBack);
  backButton.disabled = !canGoBack;
  document.querySelectorAll(".nav-item").forEach((button) => {
    const nav = button.dataset.nav;
    const navRecordType = button.dataset.recordType;
    const activeRecordType = navRecordType ? state.recordType === navRecordType : true;
    const active =
      (route === nav && activeRecordType) ||
      (["detail", "form"].includes(route) && nav === "records" && activeRecordType) ||
      (isSecondaryRoute(route) && nav === "more");
    button.classList.toggle("active", active);
  });

  if (route === "dashboard") mobileView.innerHTML = renderDashboard();
  if (route === "records") mobileView.innerHTML = renderRecords();
  if (route === "documents") mobileView.innerHTML = renderDocuments();
  if (route === "search") mobileView.innerHTML = renderSearch();
  if (route === "more") mobileView.innerHTML = renderMore();
  if (route === "spend") mobileView.innerHTML = renderSpend();
  if (route === "calendar") mobileView.innerHTML = renderCalendar();
  if (route === "reminders") mobileView.innerHTML = renderReminders();
  if (route === "import") mobileView.innerHTML = renderImport();
  if (route === "assistant") mobileView.innerHTML = renderAssistant();
  if (route === "settings") mobileView.innerHTML = renderSettings();
  if (route === "help") mobileView.innerHTML = renderHelp();
  if (route === "detail") mobileView.innerHTML = renderDetail();
  if (route === "form") mobileView.innerHTML = renderForm();
  mobileView.focus({ preventScroll: true });
}

function renderDashboard() {
  const activeContracts = cache.contracts.filter((row) => row.status === "ACTIVE");
  const docsNeedingReview = [
    ...cache.documents.filter((doc) => !doc.kind && !doc.extracted_text),
    ...cache.inboxDocuments.filter((doc) => doc.status === "NEEDS_REVIEW"),
  ];
  const attention = buildAttentionItems();
  const monthlySpend = activeContracts.reduce((sum, row) => sum + monthlyEquivalent(Number(row.cost), row.billing_frequency), 0);
  const inventoryValue = moduleEnabled("inventoryItems") ? cache.inventoryItems.reduce((sum, row) => sum + (Number(row.purchase_price) || 0), 0) : 0;
  const propertyValue = moduleEnabled("properties") ? cache.properties.reduce((sum, row) => sum + (Number(row.estimated_value) || 0), 0) : 0;
  const holdingsValue = moduleEnabled("portfolios") ? cache.holdings.reduce((sum, row) => sum + holdingValue(row), 0) : 0;
  return `
    <section class="hero-card">
      <p class="kicker">Today</p>
      <h2>What needs attention</h2>
      <p>${attention.length > 0 ? `${attention.length} item${attention.length === 1 ? "" : "s"} need a look.` : "Everything tracked locally looks calm."}</p>
    </section>

    <section class="grid-2">
      ${statCard("Active contracts", activeContracts.length, "records", "contracts")}
      ${statCard("Products tracked", cache.products.length, "records", "products")}
      ${moduleEnabled("vehicles") ? statCard("Vehicles", cache.vehicles.length, "records", "vehicles") : ""}
      ${statCard("Documents", cache.documents.length + cache.inboxDocuments.length, "documents")}
      ${moduleEnabled("properties") ? statCard("Properties", cache.properties.length, "records", "properties") : ""}
      ${moduleEnabled("inventoryItems") ? statCard("Inventory", cache.inventoryItems.length, "records", "inventoryItems") : ""}
      ${moduleEnabled("trips") ? statCard("Trips", cache.trips.length, "records", "trips") : ""}
      ${moduleEnabled("portfolios") ? statCard("Portfolios", cache.portfolios.length, "records", "portfolios") : ""}
    </section>

    <section class="grid-2">
      ${miniCard("Est. monthly spend", money(monthlySpend, defaultCurrency()) ?? `${defaultCurrency()} 0`, "Private local estimate")}
      ${miniCard("Needs review", String(docsNeedingReview.length), "Documents without extracted text")}
      ${moduleEnabled("properties") || moduleEnabled("inventoryItems") ? miniCard("Home + inventory", money(propertyValue + inventoryValue, defaultCurrency()) ?? `${defaultCurrency()} 0`, "Local asset estimate") : ""}
      ${moduleEnabled("portfolios") ? miniCard("Portfolio value", money(holdingsValue, defaultCurrency()) ?? `${defaultCurrency()} 0`, "Trade-derived holdings") : ""}
    </section>

    <section>
      <div class="section-title">
        <h2>Needs attention</h2>
        <button class="subtle-button" data-nav="records">View records</button>
      </div>
      <div class="list">
        ${attention.length === 0 ? empty("No urgent records", "Expiring contracts, warranties, rego and insurance will appear here.") : attention.slice(0, 6).map(renderAttentionCard).join("")}
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>Quick add</h2>
      </div>
      <div class="grid-3">
        <button data-form-type="contracts">Contract</button>
        <button data-form-type="products">Product</button>
        ${moduleEnabled("vehicles") ? '<button data-form-type="vehicles">Vehicle</button>' : ""}
        ${moduleEnabled("properties") ? '<button data-form-type="properties">Home</button>' : ""}
        ${moduleEnabled("inventoryItems") ? '<button data-form-type="inventoryItems">Inventory</button>' : ""}
        ${moduleEnabled("trips") ? '<button data-form-type="trips">Trip</button>' : ""}
        ${moduleEnabled("portfolios") ? '<button data-form-type="portfolios">Portfolio</button>' : ""}
        <button data-nav="import">Import</button>
        <button data-nav="reminders">Reminders</button>
        <button data-nav="more">More</button>
      </div>
    </section>
  `;
}

function renderMore() {
  const modules = visibleOptionalModules().map((module) => ({ ...module, nav: "records", recordType: module.recordType }));
  const tools = [
    { title: "Search", copy: "Find records and documents stored on this phone.", nav: "search" },
    { title: "Spend", copy: "Monthly and yearly household cost view.", nav: "spend" },
    { title: "Calendar", copy: "Upcoming renewals, warranties, trips and vehicle dates.", nav: "calendar" },
    { title: "Reminders", copy: "Thresholds and reminder health for expiry-based records.", nav: "reminders" },
    { title: "Import", copy: "Upload documents into the standalone inbox.", nav: "import" },
    { title: "Assistant", copy: "Search-style local assistant for records on this phone.", nav: "assistant" },
    { title: "Settings", copy: "Mode, storage, modules and standalone limitations.", nav: "settings" },
    { title: "Help", copy: "Mobile guidance, privacy model, import limits and connected-mode notes.", nav: "help" },
  ];
  return `
    <section class="hero-card">
      <p class="kicker">0.16 baseline tools</p>
      <h2>More Hearth</h2>
      <p>Standalone keeps these workflows private on this phone. Connected mode still opens the full self-hosted web app.</p>
    </section>
    <section>
      <div class="section-title">
        <h2>Modules</h2>
      </div>
      <div class="list">
        ${modules.length === 0 ? empty("No optional modules enabled", "Turn modules back on from Settings. Contracts, warranties and documents stay available.") : modules.map(renderMoreDestination).join("")}
      </div>
    </section>
    <section>
      <div class="section-title">
        <h2>Tools</h2>
      </div>
      <div class="list">
        ${tools.map(renderMoreDestination).join("")}
      </div>
    </section>
  `;
}

function renderMoreDestination(destination) {
  return `
    <button class="record-card" data-nav="${escapeAttr(destination.nav)}"${destination.recordType ? ` data-record-type="${escapeAttr(destination.recordType)}"` : ""}>
      <h3>${escapeHtml(destination.title)}</h3>
      <p class="card-meta">${escapeHtml(destination.copy)}</p>
    </button>
  `;
}

function renderSpend() {
  const currency = defaultCurrency();
  const activeContracts = cache.contracts.filter((row) => row.status === "ACTIVE");
  const monthly = activeContracts.reduce((sum, row) => sum + monthlyEquivalent(Number(row.cost), row.billing_frequency), 0);
  const oneOffProducts = cache.products.reduce((sum, row) => sum + (Number(row.price) || 0), 0);
  const homeCosts = cache.homeItems.reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const vehicleCosts = cache.vehicleItems.reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const tripCosts = cache.tripSegments.reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const rows = spendRows(activeContracts);
  return `
    <section class="hero-card">
      <p class="kicker">Standalone spend</p>
      <h2>${escapeHtml(money(monthly, currency) ?? `${currency} 0`)} / month</h2>
      <p>Estimated from active contract billing frequencies saved on this phone. Amounts are summarized in your standalone default currency label; Hearth does not perform FX conversion offline.</p>
    </section>
    <section class="grid-2">
      ${miniCard("Annualised contracts", money(monthly * 12, currency) ?? `${currency} 0`, "Recurring estimate")}
      ${miniCard("Products purchased", money(oneOffProducts, currency) ?? `${currency} 0`, "One-off tracked value")}
      ${miniCard("Home records", money(homeCosts, currency) ?? `${currency} 0`, "Logged costs")}
      ${miniCard("Vehicle records", money(vehicleCosts, currency) ?? `${currency} 0`, "Logged costs")}
      ${miniCard("Travel segments", money(tripCosts, currency) ?? `${currency} 0`, "Logged bookings")}
      ${miniCard("Active contracts", String(activeContracts.length), "Included in recurring spend")}
    </section>
    <section class="card form-card">
      <div class="section-title">
        <h2>By category</h2>
        <button class="subtle-button" data-record-type="contracts" data-nav="records">Contracts</button>
      </div>
      <div class="detail-grid">
        ${rows.length === 0 ? empty("No spend yet", "Add contracts with cost and billing frequency to build this view.") : rows.map(([category, amount]) => `
          <div class="detail-row"><span class="detail-label">${escapeHtml(category)}</span><span class="detail-value">${escapeHtml(money(amount, currency) ?? `${currency} 0`)}</span></div>
        `).join("")}
      </div>
    </section>
  `;
}

function spendRows(contracts) {
  const categories = new Map();
  for (const row of contracts) {
    const category = row.category || "OTHER";
    categories.set(category, (categories.get(category) ?? 0) + monthlyEquivalent(Number(row.cost), row.billing_frequency));
  }
  return [...categories.entries()].sort((a, b) => b[1] - a[1]);
}

function renderCalendar() {
  const events = calendarEvents();
  return `
    <section class="hero-card">
      <p class="kicker">Upcoming</p>
      <h2>${events.length} date${events.length === 1 ? "" : "s"} on the radar</h2>
      <p>Renewals, warranties, rego, insurance, trips and bookings from local records.</p>
    </section>
    <section class="list">
      ${events.length === 0 ? empty("No upcoming dates", "Add end dates, warranty dates, trip dates or vehicle expiry dates to populate the calendar.") : events.map(renderCalendarEvent).join("")}
    </section>
  `;
}

function calendarEvents() {
  const events = [];
  const add = (date, label, title, type, id, tone = "neutral") => {
    if (!date) return;
    const days = daysUntil(date);
    if (days == null || days < -30) return;
    events.push({ date: String(date).slice(0, 10), label, title, type, id, days, tone });
  };
  for (const row of cache.contracts) add(row.end_date, "Contract ends", recordTitle("contracts", row), "contracts", row.id);
  for (const row of cache.products) add(row.warranty_end_date, "Warranty ends", recordTitle("products", row), "products", row.id);
  for (const row of cache.vehicles) {
    add(row.rego_expiry, "Rego expiry", recordTitle("vehicles", row), "vehicles", row.id);
    add(row.insurance_expiry, "Insurance expiry", recordTitle("vehicles", row), "vehicles", row.id);
  }
  for (const row of cache.trips) add(row.start_date, "Trip starts", recordTitle("trips", row), "trips", row.id);
  for (const row of cache.tripSegments) add(row.start_date, typeLabel(row.type), recordTitle("tripSegments", row), "tripSegments", row.id);
  return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 80);
}

function renderCalendarEvent(event) {
  const badgeTone = event.days < 0 ? "danger" : event.days <= 30 ? "warning" : "";
  const relative = event.days < 0 ? `${Math.abs(event.days)}d overdue` : event.days === 0 ? "Today" : `In ${event.days}d`;
  return `
    <button class="record-card ${badgeTone === "danger" ? "danger-card" : badgeTone === "warning" ? "warning-card" : ""}" data-open-record="${escapeAttr(event.type)}" data-id="${escapeAttr(event.id)}">
      <div class="badge-row">
        <span class="badge ${escapeAttr(badgeTone)}">${escapeHtml(relative)}</span>
        <span class="badge">${escapeHtml(event.label)}</span>
      </div>
      <h3>${escapeHtml(event.title)}</h3>
      <p class="card-meta">${escapeHtml(readableDate(event.date))}</p>
    </button>
  `;
}

function renderReminders() {
  const targets = reminderTargets();
  const ready = targets.filter((target) => target.health.enabled && target.health.nextReminderDate);
  const dueSoon = targets.filter((target) => ["danger", "warning"].includes(target.health.tone));
  const missing = targets.filter((target) => !target.health.enabled);
  const scheduleable = reminderNotifications().length;
  return `
    <section class="hero-card">
      <p class="kicker">Reminder health</p>
      <h2>${ready.length} reminder${ready.length === 1 ? "" : "s"} ready</h2>
      <p>${LocalNotifications ? "Standalone can schedule private device reminders locally." : "This build can show reminder dates, but the native notifications plugin is unavailable."}</p>
    </section>
    <section class="card form-card">
      <div class="section-title">
        <h2>Device reminders</h2>
        <span class="badge ${state.localRemindersEnabled ? "" : "warning"}">${state.localRemindersEnabled ? "On" : "Off"}</span>
      </div>
      <div class="detail-grid">
        ${detailLine("Pending notifications", state.pendingNotificationCount == null ? "—" : String(state.pendingNotificationCount))}
        ${detailLine("Ready to schedule", String(scheduleable))}
        ${detailLine("Delivery", LocalNotifications ? "Local device notifications" : "Unavailable in this build")}
      </div>
      <div class="actions">
        <button data-enable-local-reminders ${LocalNotifications ? "" : "disabled"}>${state.localRemindersEnabled ? "Resync reminders" : "Enable reminders"}</button>
        <button class="secondary" data-disable-local-reminders ${state.localRemindersEnabled ? "" : "disabled"}>Turn off</button>
      </div>
    </section>
    <section class="grid-2">
      ${miniCard("Due soon / overdue", String(dueSoon.length), "Needs attention")}
      ${miniCard("Missing setup", String(missing.length), "Date or thresholds missing")}
      ${miniCard("Default thresholds", "30,14,7,1", "Days before due date")}
      ${miniCard("Delivery", "Local view only", "No server sharing")}
    </section>
    <section class="list">
      ${targets.length === 0 ? empty("No reminder-capable records", "Add contracts, products, or vehicles with expiry dates to build this view.") : targets.map(renderReminderCard).join("")}
    </section>
  `;
}

function renderReminderCard(target) {
  const { health } = target;
  return `
    <button class="record-card ${health.tone === "danger" ? "danger-card" : health.tone === "warning" ? "warning-card" : ""}" data-open-record="${escapeAttr(target.type)}" data-id="${escapeAttr(target.row.id)}">
      <div class="badge-row">
        <span class="badge ${escapeAttr(health.tone === "neutral" ? "" : health.tone)}">${escapeHtml(health.label)}</span>
        <span class="badge">${escapeHtml(target.kind)}</span>
      </div>
      <h3>${escapeHtml(recordTitle(target.type, target.row))}</h3>
      <p class="card-meta">${escapeHtml(health.summary)}</p>
      <p class="card-meta">${escapeHtml(reminderDeliverySummary(health))}</p>
    </button>
  `;
}

function reminderTargets() {
  return [
    ...cache.contracts.map((row) => reminderTarget("contracts", row, "Contract", row.end_date, row.reminder_days_before)),
    ...cache.products.map((row) => reminderTarget("products", row, "Warranty", row.warranty_end_date, row.reminder_days_before)),
    ...cache.vehicles.flatMap((row) => [
      reminderTarget("vehicles", row, "Rego", row.rego_expiry, row.reminder_days_before),
      reminderTarget("vehicles", row, "Insurance", row.insurance_expiry, row.reminder_days_before),
    ]),
  ].sort((a, b) => {
    const aDate = a.health.sortDate ?? "9999-12-31";
    const bDate = b.health.sortDate ?? "9999-12-31";
    return aDate.localeCompare(bDate);
  });
}

function reminderTarget(type, row, kind, dueDate, thresholds) {
  const field = reminderFieldForKind(kind);
  const heldForReview = ["contracts", "products"].includes(type) && Number(row.extraction_pending ?? 0) === 1;
  const health = heldForReview
    ? {
        enabled: false,
        tone: "warning",
        label: "Held",
        summary: "Details need review; reminders are held until confirmed.",
        nextReminderDate: null,
        sortDate: String(dueDate ?? "9999-12-31").slice(0, 10),
      }
    : reminderHealth(dueDate, thresholds);
  const logs = reminderLogsFor(type, row.id, field);
  return {
    type,
    row,
    kind,
    field,
    dueDate,
    health: {
      ...health,
      lastScheduled: latestReminderLog(logs, "SCHEDULED"),
      lastFailure: latestReminderLog(logs, "FAILED"),
    },
  };
}

function reminderFieldForKind(kind) {
  if (kind === "Rego") return "regoExpiry";
  if (kind === "Insurance") return "insuranceExpiry";
  return "";
}

function reminderLogsFor(type, id, field) {
  return cache.reminderLogs.filter((log) => log.owner_type === ownerTypeForReminderType(type) && log.owner_id === id && (log.field ?? "") === field);
}

function ownerTypeForReminderType(type) {
  if (type === "contracts") return "CONTRACT";
  if (type === "products") return "PRODUCT";
  if (type === "vehicles") return "VEHICLE";
  return type.toUpperCase();
}

function latestReminderLog(logs, status) {
  return logs.find((log) => log.status === status) ?? null;
}

function reminderDeliverySummary(health) {
  const parts = [];
  if (health.lastScheduled) {
    parts.push(`Last scheduled ${readableDate(health.lastScheduled.sent_at)} (${health.lastScheduled.threshold_days ?? "?"}d)`);
  }
  if (health.lastFailure) {
    parts.push(`Last failure ${readableDate(health.lastFailure.sent_at)}${health.lastFailure.error ? ` — ${health.lastFailure.error}` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No local delivery history yet.";
}

function reminderHealth(dueDate, thresholdsText) {
  const thresholds = parseReminderDays(thresholdsText);
  if (!dueDate) return { enabled: false, tone: "warning", label: "No date", summary: "Add a target date before reminders can be planned.", nextReminderDate: null, sortDate: null };
  if (thresholds.length === 0) return { enabled: false, tone: "warning", label: "No thresholds", summary: "Add comma-separated reminder days, for example 30,14,7,1.", nextReminderDate: null, sortDate: String(dueDate).slice(0, 10) };
  const days = daysUntil(dueDate);
  if (days == null) return { enabled: false, tone: "warning", label: "Invalid date", summary: "The saved date could not be read.", nextReminderDate: null, sortDate: null };
  const dueLabel = readableDate(dueDate);
  if (days < 0) return { enabled: true, tone: "danger", label: "Overdue", summary: `Due ${dueLabel}; thresholds ${thresholds.join(", ")} days.`, nextReminderDate: null, sortDate: dueLabel };
  const nextThreshold = thresholds.find((threshold) => threshold <= days);
  const nextReminderDate = nextThreshold == null ? readableDate(nowIso()) : addDaysIso(dueDate, -nextThreshold);
  const label = days <= 30 ? "Due soon" : "Planned";
  const tone = days <= 30 ? "warning" : "neutral";
  return {
    enabled: true,
    tone,
    label,
    summary: nextThreshold == null ? `Due ${dueLabel}; all configured reminder thresholds have passed.` : `Due ${dueLabel}; next reminder ${nextReminderDate} (${nextThreshold} days before).`,
    nextReminderDate,
    sortDate: nextReminderDate,
  };
}

function parseReminderDays(value) {
  return String(value || "30,14,7,1")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isInteger(number) && number >= 0 && number <= 3650)
    .sort((a, b) => b - a);
}

function addDaysIso(value, offset) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function reminderNotifications() {
  return reminderTargets()
    .flatMap((target) => reminderNotificationPlans(target))
    .filter(Boolean);
}

function reminderNotificationPlans(target) {
  if (!target.health.enabled || !target.dueDate) return [];
  return parseReminderDays(target.row.reminder_days_before)
    .map((threshold) => {
      const reminderDate = addDaysIso(target.dueDate, -threshold);
      const at = notificationDate(reminderDate);
      if (!at) return null;
      return {
        id: notificationId(`${target.type}:${target.row.id}:${target.kind}:${reminderDate}:${threshold}`),
        title: `Hearth reminder: ${recordTitle(target.type, target.row)}`,
        body: `${target.kind} is due ${readableDate(target.dueDate)} (${threshold} days to go).`,
        schedule: { at },
        channelId: REMINDER_CHANNEL_ID,
        extra: {
          source: "hearth-standalone",
          recordType: target.type,
          recordId: target.row.id,
          ownerType: ownerTypeForReminderType(target.type),
          field: target.field,
          reminderKind: target.kind,
          threshold,
        },
      };
    })
    .filter(Boolean);
}

function notificationDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T${String(REMINDER_HOUR).padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const soon = new Date(Date.now() + 60000);
  return date > soon ? date : null;
}

function notificationId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 2000000000) + 1000;
}

async function ensureLocalNotificationPermission() {
  if (!LocalNotifications) throw new Error("Native local notifications bridge unavailable.");
  const checked = await LocalNotifications.checkPermissions();
  if (checked.display === "granted") return;
  const requested = await LocalNotifications.requestPermissions();
  if (requested.display !== "granted") throw new Error("Notifications are not allowed for Hearth.");
}

async function ensureReminderChannel() {
  if (!LocalNotifications?.createChannel) return;
  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: "Hearth reminders",
    description: "Standalone reminders for contracts, warranties, registration and insurance.",
    importance: 4,
    visibility: 1,
  }).catch(() => undefined);
}

async function readScheduledReminderIds() {
  try {
    const raw = await prefGet(SCHEDULED_REMINDERS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

async function writeScheduledReminderIds(ids) {
  await prefSet(SCHEDULED_REMINDERS_KEY, JSON.stringify(ids));
}

async function cancelStoredLocalReminders() {
  if (!LocalNotifications) return;
  const ids = await readScheduledReminderIds();
  if (ids.length > 0) {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => undefined);
  }
  await writeScheduledReminderIds([]);
  state.pendingNotificationCount = 0;
}

async function syncLocalReminders(showToast = true) {
  if (!LocalNotifications) throw new Error("Native local notifications bridge unavailable.");
  await loadData();
  await ensureLocalNotificationPermission();
  await ensureReminderChannel();
  await cancelStoredLocalReminders();
  const notifications = reminderNotifications();
  try {
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (error) {
    await recordReminderScheduleAttempt(notifications, "FAILED", error?.message || "Could not schedule local notification.");
    throw error;
  }
  if (notifications.length > 0) {
    await recordReminderScheduleAttempt(notifications, "SCHEDULED", null);
  }
  const ids = notifications.map((notification) => notification.id);
  await writeScheduledReminderIds(ids);
  await prefSet(LOCAL_REMINDERS_KEY, "true");
  state.localRemindersEnabled = true;
  state.pendingNotificationCount = ids.length;
  if (showToast) showStandaloneStatus(`${ids.length} reminder${ids.length === 1 ? "" : "s"} scheduled.`, true);
}

async function recordReminderScheduleAttempt(notifications, status, error) {
  const sentAt = nowIso();
  for (const notification of notifications) {
    await run(
      "INSERT INTO reminder_delivery_logs (id, owner_type, owner_id, field, channel, threshold_days, status, sent_at, error) VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?)",
      [
        localId("reminder_log"),
        notification.extra?.ownerType ?? ownerTypeForReminderType(notification.extra?.recordType ?? ""),
        notification.extra?.recordId ?? "",
        notification.extra?.field ?? "",
        notification.extra?.threshold ?? null,
        status,
        sentAt,
        error,
      ],
    );
  }
}

async function disableLocalReminders() {
  await cancelStoredLocalReminders();
  await prefSet(LOCAL_REMINDERS_KEY, "false");
  state.localRemindersEnabled = false;
  showStandaloneStatus("Device reminders turned off.", true);
}

async function pendingStandaloneReminderCount() {
  if (!LocalNotifications) return null;
  const ids = await readScheduledReminderIds();
  if (ids.length === 0) return 0;
  const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
  const pendingIds = new Set((pending.notifications ?? []).map((notification) => notification.id));
  return ids.filter((id) => pendingIds.has(id)).length;
}

function renderImport() {
  return `
    <section class="hero-card">
      <p class="kicker">Import</p>
      <h2>Bring records into Hearth</h2>
      <p>Standalone stores imports privately on this device. Import documents to the inbox, or open a Wealth portfolio to import broker CSV trades.</p>
    </section>
    ${renderInboxImportSection()}
    <section class="card form-card">
      <h2>Standalone import limits</h2>
      <div class="detail-grid">
        ${detailLine("Document extraction", "Connected mode only until a local AI/OCR engine is added.")}
        ${detailLine("Broker CSV trades", "Supported locally for CommSec, SelfWealth, Stake and generic trade CSV files.")}
        ${detailLine("Email inbox polling", "Connected server only; this phone can import files selected locally.")}
      </div>
    </section>
    <section class="list">
      ${cache.inboxDocuments.length === 0 ? empty("Inbox is empty", "Imported files that need review will appear here.") : cache.inboxDocuments.map(renderInboxCard).join("")}
    </section>
  `;
}

function renderInboxImportSection() {
  return `
    <section class="form-card">
      <h2>Import to inbox</h2>
      <p class="muted">Store a document privately on this phone, then file it to a record later.</p>
      <form data-import-inbox-form class="field-grid">
        <input name="file" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic" required />
        <button type="submit">Upload document</button>
      </form>
    </section>
  `;
}

function renderAssistant() {
  const results = assistantResults();
  return `
    <section class="hero-card">
      <p class="kicker">Private local assistant</p>
      <h2>Ask about records on this phone</h2>
      <p>This standalone assistant does local lookup only. Streaming AI chat and proposed actions remain connected-mode features.</p>
    </section>
    <section class="search-row">
      <input id="assistant-query" value="${escapeAttr(state.assistantQuery)}" placeholder="Try “warranty”, “rego”, “portfolio”, or a provider…" />
      <button data-clear-assistant>Clear</button>
    </section>
    <section id="assistant-results" class="list">
      ${state.assistantQuery.trim() === "" ? renderAssistantHints() : results.length === 0 ? empty("No local answer", "Try searching a title, provider, serial number, plate, ticker, booking code, or filename.") : results.map(renderSearchResult).join("")}
    </section>
  `;
}

function renderAssistantHints() {
  const hints = [
    ["What is expiring soon?", "Use Calendar or search for warranty, rego, insurance, or contract dates."],
    ["What documents need review?", `${cache.inboxDocuments.length} inbox document${cache.inboxDocuments.length === 1 ? "" : "s"} currently need review.`],
    ["What is my portfolio value?", `${money(cache.holdings.reduce((sum, row) => sum + holdingValue(row), 0), defaultCurrency()) ?? `${defaultCurrency()} 0`} from local holdings and trade history.`],
  ];
  return hints.map(([title, copy]) => `<article class="record-card"><h3>${escapeHtml(title)}</h3><p class="card-meta">${escapeHtml(copy)}</p></article>`).join("");
}

function renderHelp() {
  const helpItems = [
    ["Standalone vs connected", "Use standalone for private records on this device only. Use connected mode when you want the full self-hosted household app, users, integrations and server automation."],
    ["Adding records", "Use Dashboard quick add for common entries, Records for module lists, or Documents to import a file first and file it later."],
    ["Documents", "Standalone stores PDF, Word and image files in app-protected storage and keeps document metadata in encrypted SQLite."],
    ["Reminders", "Standalone can schedule local device reminders for contracts, warranties, vehicles and leases. Server email/ntfy reminders stay connected-only."],
    ["Backups", "Use Settings to export a Hearth standalone JSON backup. Backups are manual and are not uploaded by Hearth."],
    ["Privacy", "No standalone record is shared with a server or another person unless you switch modes or manually export/share a backup or file."],
  ];
  return `
    <section class="hero-card">
      <p class="kicker">Help</p>
      <h2>Using Hearth on mobile</h2>
      <p>This phone-first shell mirrors the 0.16 household workflows where they make sense locally, and points you to connected mode for server-only features.</p>
    </section>
    <section class="list">
      ${helpItems.map(([title, copy]) => `<article class="record-card"><h3>${escapeHtml(title)}</h3><p class="card-meta">${escapeHtml(copy)}</p></article>`).join("")}
    </section>
    <section class="card form-card">
      <h2>Need the full web app?</h2>
      <p class="muted">Connected mode opens your self-hosted Hearth server with users, passkeys, household settings, integrations and AI-backed extraction.</p>
      <div class="actions">
        <button data-switch-runtime-mode>Switch mode</button>
      </div>
    </section>
  `;
}

function assistantResults() {
  const priorSearch = state.searchQuery;
  state.searchQuery = state.assistantQuery;
  const results = searchResults();
  state.searchQuery = priorSearch;
  return results;
}

function renderSettings() {
  const moduleRows = [
    ["Contracts", cache.contracts.length],
    ["Products", cache.products.length],
  ];
  return `
    <section class="hero-card">
      <p class="kicker">Standalone settings</p>
      <h2>Private on this device</h2>
      <p>Standalone mode uses encrypted native SQLite and app-protected file storage. Nothing is shared unless you switch to a self-hosted server.</p>
    </section>
    <section class="card form-card">
      <h2>Mode</h2>
      <div class="detail-grid">
        ${detailLine("Current mode", "Standalone")}
        ${detailLine("Profile", defaultDisplayName())}
        ${detailLine("Default currency", defaultCurrency())}
        ${detailLine("Sharing", "Off — records stay on this device")}
        ${detailLine("Storage", "Encrypted SQLite plus protected document files")}
        ${detailLine("Device reminders", LocalNotifications ? `${state.localRemindersEnabled ? "On" : "Off"}${state.pendingNotificationCount == null ? "" : ` · ${state.pendingNotificationCount} pending`}` : "Unavailable in this build")}
      </div>
      <div class="actions">
        <button data-switch-runtime-mode>Switch mode</button>
        <button data-enable-local-reminders ${LocalNotifications ? "" : "disabled"}>${state.localRemindersEnabled ? "Resync reminders" : "Enable reminders"}</button>
      </div>
    </section>
    <section class="card form-card">
      <h2>Local profile</h2>
      <p class="muted">Used for standalone display and as the default currency for new local records. Existing records keep their saved currency.</p>
      <form data-save-local-profile class="field-grid">
        <label>Display name<input name="displayName" value="${escapeAttr(defaultDisplayName())}" required /></label>
        <label>Default currency<input name="defaultCurrency" value="${escapeAttr(defaultCurrency())}" maxlength="6" autocapitalize="characters" required /></label>
        <button type="submit">Save profile</button>
      </form>
    </section>
    <section class="card form-card">
      <h2>Modules on this phone</h2>
      <p class="muted">Hide optional modules you do not use. This only changes the standalone mobile screens; existing records stay in encrypted local storage and backups.</p>
      <div class="detail-grid">
        ${moduleRows.map(([label, count]) => detailLine(label, `${count} record${count === 1 ? "" : "s"}`)).join("")}
      </div>
      <div class="list compact-list">
        ${OPTIONAL_MODULES.map(renderModuleSetting).join("")}
      </div>
    </section>
    <section class="card form-card">
      <h2>Standalone backup</h2>
      <p class="muted">Export a standalone JSON snapshot for safekeeping, or merge a previous standalone backup into this phone. The backup includes local records, document metadata and document file contents.</p>
      <div class="detail-grid">
        ${detailLine("Backup format", "Hearth standalone JSON")}
        ${detailLine("Import mode", "Merge by record id — existing records are updated, not wiped")}
        ${detailLine("Sharing", "Manual only; no cloud sync is started by Hearth")}
      </div>
      <div class="actions">
        <button data-export-standalone-backup>Export backup</button>
      </div>
      <form data-import-standalone-backup-form class="field-grid">
        <input name="file" type="file" accept=".json,application/json" required />
        <button type="submit">Import backup</button>
      </form>
    </section>
    <section class="card form-card">
      <h2>Connected-only baseline features</h2>
      <div class="detail-grid">
        ${detailLine("Users, passkeys, 2FA", "Available from the self-hosted web app.")}
        ${detailLine("Server reminder channels", "Email/ntfy scheduling requires a server. Local device reminders are handled on this phone.")}
        ${detailLine("Backups and integrations", "S3, SFTP, IMAP, AI providers and live prices require connected mode.")}
      </div>
      <div class="actions">
        <button data-nav="help">Open help</button>
      </div>
    </section>
  `;
}

function renderModuleSetting(module) {
  const enabled = moduleEnabled(module.key);
  const count = cache[module.countKey]?.length ?? 0;
  return `
    <article class="record-card module-setting-card">
      <div class="badge-row">
        <span class="badge ${enabled ? "" : "warning"}">${enabled ? "Shown" : "Hidden"}</span>
        <span class="badge">${count} record${count === 1 ? "" : "s"}</span>
      </div>
      <h3>${escapeHtml(module.title)}</h3>
      <p class="card-meta">${escapeHtml(module.copy)}</p>
      <div class="actions">
        <button data-toggle-standalone-module="${escapeAttr(module.key)}">${enabled ? "Hide module" : "Show module"}</button>
      </div>
    </article>
  `;
}

function detailLine(label, value) {
  return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`;
}

async function exportStandaloneBackup() {
  if (!Filesystem) throw new Error("Native file storage bridge unavailable.");
  const backup = await buildStandaloneBackup();
  const date = nowIso().slice(0, 10);
  const filename = `hearth-standalone-${date}.json`;
  const path = `${BACKUP_ROOT}/${filename}`;
  await Filesystem.writeFile({
    directory: BACKUP_DIRECTORY,
    path,
    data: JSON.stringify(backup, null, 2),
    recursive: true,
  });
  showStandaloneStatus(`Backup exported to ${filename}.`, true);
}

async function buildStandaloneBackup() {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const rows = await query(`SELECT * FROM ${table.table}`);
    tables[table.key] = await Promise.all(rows.map((row) => enrichBackupRow(table, row)));
  }
  return {
    kind: "hearth-standalone-backup",
    version: 1,
    schemaVersion: 7,
    exportedAt: nowIso(),
    tables,
  };
}

async function enrichBackupRow(table, row) {
  if (!["documents", "inboxDocuments"].includes(table.key)) return row;
  const fileData = await readStoredFileBase64(row.storage_key).catch(() => null);
  return fileData ? { ...row, file_data: fileData } : row;
}

async function readStoredFileBase64(storageKey) {
  if (!Filesystem || !storageKey) return null;
  const result = await Filesystem.readFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${storageKey}` });
  return String(result.data ?? "");
}

async function importStandaloneBackup(file) {
  if (!file) throw new Error("Choose a backup file first.");
  const backup = JSON.parse(await file.text());
  if (backup?.kind !== "hearth-standalone-backup" || typeof backup.tables !== "object") {
    throw new Error("That is not a Hearth standalone backup.");
  }
  let imported = 0;
  for (const table of BACKUP_TABLES) {
    const rows = Array.isArray(backup.tables[table.key]) ? backup.tables[table.key] : [];
    for (const row of rows) {
      await upsertBackupRow(table, row);
      imported += 1;
    }
  }
  await loadData();
  showStandaloneStatus(`Imported ${imported} backup row${imported === 1 ? "" : "s"}.`, true);
}

async function upsertBackupRow(table, row) {
  if (!row || typeof row !== "object") return;
  const values = table.columns.map((column) => row[column] ?? null);
  const placeholders = table.columns.map(() => "?").join(", ");
  await run(`INSERT OR REPLACE INTO ${table.table} (${table.columns.join(", ")}) VALUES (${placeholders})`, values);
  if (["documents", "inboxDocuments"].includes(table.key) && row.storage_key && row.file_data && Filesystem) {
    await Filesystem.writeFile({
      directory: FILE_DIRECTORY,
      path: `${FILE_ROOT}/${row.storage_key}`,
      data: String(row.file_data),
      recursive: true,
    }).catch(() => undefined);
  }
}

function monthlyEquivalent(cost, frequency) {
  if (!Number.isFinite(cost)) return 0;
  const factor = {
    WEEKLY: 52 / 12,
    FORTNIGHTLY: 26 / 12,
    MONTHLY: 1,
    QUARTERLY: 1 / 3,
    ANNUALLY: 1 / 12,
    YEARLY: 1 / 12,
    ONE_OFF: 0,
  }[frequency] ?? 0;
  return cost * factor;
}

function statCard(label, value, nav, recordType = "") {
  return `
    <button class="stat-card" data-nav="${escapeAttr(nav)}" data-record-type="${escapeAttr(recordType)}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function miniCard(title, value, meta) {
  return `
    <article class="mini-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <span>${escapeHtml(meta)}</span>
    </article>
  `;
}

function renderAttentionCard(item) {
  return `
    <button class="record-card ${item.attention.tone === "danger" ? "danger-card" : "warning-card"}" data-open-record="${escapeAttr(item.type)}" data-id="${escapeAttr(item.row.id)}">
      <span class="badge ${escapeAttr(item.attention.tone)}">${escapeHtml(item.attention.label)}</span>
      <h3>${escapeHtml(recordTitle(item.type, item.row))}</h3>
      <p class="card-meta">${escapeHtml(item.attention.meta)}</p>
    </button>
  `;
}

function renderRecords() {
  const rows = filteredRecords();
  const optionalTabs = visibleOptionalModules().map((module) => recordTab(module.recordType, module.title)).join("");
  return `
    <section class="tabs" aria-label="Record types">
      ${recordTab("contracts", "Contracts")}
      ${recordTab("products", "Warranties")}
      ${optionalTabs}
    </section>
    <section class="search-row">
      <input id="record-search" value="${escapeAttr(state.recordQuery)}" placeholder="Search ${escapeAttr(typeLabel(state.recordType).toLowerCase())}…" />
      <button data-form-type="${escapeAttr(state.recordType)}">Add</button>
    </section>
    <section class="chips" aria-label="Filters">
      ${filterChip("all", "All")}
      ${filterChip("attention", "Needs attention")}
      ${filterChip("missing-docs", "Missing document")}
    </section>
    <section id="record-results" class="list">
      ${rows.length === 0 ? empty("No matching records", "Add a record or adjust the search/filter.") : rows.map((row) => renderRecordCard(state.recordType, row)).join("")}
    </section>
  `;
}

function recordTab(type, label) {
  return `<button class="tab ${state.recordType === type ? "active" : ""}" data-record-type="${escapeAttr(type)}">${escapeHtml(label)}</button>`;
}

function filterChip(filter, label) {
  return `<button class="chip ${state.recordFilter === filter ? "active" : ""}" data-record-filter="${escapeAttr(filter)}">${escapeHtml(label)}</button>`;
}

function filteredRecords() {
  const queryText = state.recordQuery.trim().toLowerCase();
  return cache[state.recordType].filter((row) => {
    if (!recordTypeEnabled(state.recordType)) return false;
    if (queryText && !recordSearchText(state.recordType, row).includes(queryText)) return false;
    if (state.recordFilter === "attention" && !attentionForRecord(state.recordType, row)) return false;
    if (state.recordFilter === "missing-docs" && hasDocument(state.recordType, row.id)) return false;
    return true;
  });
}

function recordSearchText(type, row) {
  if (type === "contracts") return [row.title, row.provider, row.contract_number, row.category, row.notes].join(" ").toLowerCase();
  if (type === "products") return [row.description, row.manufacturer, row.model, row.vendor, row.serial_number, row.barcode, row.notes].join(" ").toLowerCase();
  if (type === "vehicles") return [row.label, row.make, row.model, row.license_plate, row.vin, row.notes].join(" ").toLowerCase();
  if (type === "vehicleItems") return [row.title, row.provider, row.type, row.notes].join(" ").toLowerCase();
  if (type === "properties") return [row.label, row.street, row.suburb, row.state, row.postcode, row.country, row.notes].join(" ").toLowerCase();
  if (type === "homeItems") return [row.title, row.provider, row.type, row.notes].join(" ").toLowerCase();
  if (type === "rentalAgreements") return [row.tenant_name, row.lease_start, row.lease_end, row.weekly_rent, row.bond_amount, row.notes].join(" ").toLowerCase();
  if (type === "rentalStatements") return [row.statement_date, row.period_start, row.period_end, row.gross_rent, row.net_amount, row.notes].join(" ").toLowerCase();
  if (type === "inventoryItems") return [row.label, row.category, row.brand, row.model, row.serial_number, row.location, row.notes].join(" ").toLowerCase();
  if (type === "trips") return [row.title, row.destination, row.notes].join(" ").toLowerCase();
  if (type === "tripSegments") return [row.title, row.provider, row.type, row.confirmation_code, row.location, row.notes].join(" ").toLowerCase();
  if (type === "portfolios") return [row.name, row.description, row.currency].join(" ").toLowerCase();
  if (type === "holdings") return [row.ticker, row.name, row.asset_class, row.exchange, row.notes].join(" ").toLowerCase();
  if (type === "trades") return [row.ticker, row.type, row.trade_date, row.currency, row.notes].join(" ").toLowerCase();
  return Object.values(row).join(" ").toLowerCase();
}

function renderRecordCard(type, row) {
  const attention = attentionForRecord(type, row);
  const docCount = docsFor(ownerTypeForRecordType(type), row.id).length;
  const meta = recordMeta(type, row);
  return `
    <button class="record-card" data-open-record="${escapeAttr(type)}" data-id="${escapeAttr(row.id)}">
      <div class="badge-row">
        ${attention ? `<span class="badge ${escapeAttr(attention.tone)}">${escapeHtml(attention.label)}</span>` : ""}
        <span class="badge">${docCount} doc${docCount === 1 ? "" : "s"}</span>
      </div>
      <h3>${escapeHtml(recordTitle(type, row))}</h3>
      <p class="card-meta">${escapeHtml(meta)}</p>
    </button>
  `;
}

function recordMeta(type, row) {
  if (type === "contracts") {
    return [row.provider, row.end_date ? `Ends ${readableDate(row.end_date)}` : null, money(row.cost, row.currency), row.status].filter(Boolean).join(" · ");
  }
  if (type === "products") {
    return [row.manufacturer, row.model, row.warranty_end_date ? `Warranty ${readableDate(row.warranty_end_date)}` : null, money(row.price, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "vehicles") {
    return [[row.make, row.model].filter(Boolean).join(" "), row.license_plate, row.rego_expiry ? `Rego ${readableDate(row.rego_expiry)}` : null].filter(Boolean).join(" · ");
  }
  if (type === "vehicleItems") {
    return [row.type, row.provider, readableDate(row.date), money(row.cost, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "properties") {
    return [[row.street, row.suburb, row.state].filter(Boolean).join(", "), row.is_rented ? "Rented" : row.occupancy_status, money(row.estimated_value, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "homeItems") {
    return [row.type, row.provider, readableDate(row.date), money(row.cost, row.currency), row.is_tax_deductible ? "Tax deductible" : null].filter(Boolean).join(" · ");
  }
  if (type === "rentalAgreements") {
    return [row.tenant_name, money(row.weekly_rent, row.currency) ? `${money(row.weekly_rent, row.currency)} weekly` : null, row.lease_end ? `Lease ends ${readableDate(row.lease_end)}` : null, row.management_fee_percent != null ? `${formatNumber(row.management_fee_percent)}% fee` : null].filter(Boolean).join(" · ");
  }
  if (type === "rentalStatements") {
    return [row.statement_date ? `Statement ${readableDate(row.statement_date)}` : null, [readableDate(row.period_start), row.period_end ? `to ${readableDate(row.period_end)}` : null].filter(Boolean).join(" "), money(row.net_amount, row.currency) ? `Net ${money(row.net_amount, row.currency)}` : null].filter(Boolean).join(" · ");
  }
  if (type === "inventoryItems") {
    return [row.category, [row.brand, row.model].filter(Boolean).join(" "), row.location, money(row.purchase_price, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "trips") {
    return [row.destination, readableDate(row.start_date), row.end_date ? `to ${readableDate(row.end_date)}` : null].filter(Boolean).join(" · ");
  }
  if (type === "tripSegments") {
    return [row.type, row.provider, row.confirmation_code, readableDate(row.start_date), money(row.cost, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "portfolios") {
    const holdings = cache.holdings.filter((holding) => holding.portfolio_id === row.id);
    const trades = cache.trades.filter((trade) => trade.portfolio_id === row.id);
    const value = holdings.reduce((sum, holding) => sum + holdingValue(holding), 0);
    return [row.currency, `${holdings.length} holding${holdings.length === 1 ? "" : "s"}`, `${trades.length} trade${trades.length === 1 ? "" : "s"}`, money(value, row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "holdings") {
    const trades = cache.trades.filter((trade) => trade.holding_id === row.id);
    return [row.name, row.asset_class, row.exchange, `${formatNumber(row.units ?? 0)} units`, `${trades.length} trade${trades.length === 1 ? "" : "s"}`, money(holdingValue(row), row.currency)].filter(Boolean).join(" · ");
  }
  if (type === "trades") {
    const gross = (Number(row.units) || 0) * (Number(row.price_per_unit) || 0);
    return [readableDate(row.trade_date), row.ticker, `${formatNumber(row.units)} @ ${money(row.price_per_unit, row.currency)}`, row.fees ? `Fees ${money(row.fees, row.currency)}` : null, money(gross, row.currency)].filter(Boolean).join(" · ");
  }
  return "";
}

function holdingValue(row) {
  return (Number(row.units) || 0) * (Number(row.market_price || row.average_price) || 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function renderDetail() {
  if (!state.detail) return empty("No detail selected", "Choose a record to inspect.");
  const { type, id } = state.detail;
  const row = getRecord(type, id);
  if (!row) return empty("Record not found", "It may have been removed.");
  const ownerType = ownerTypeForRecordType(type);
  const docs = docsFor(ownerType, id).filter((doc) => Number(doc.is_head ?? 1) !== 0);
  return `
    <section class="hero-card">
      <p class="kicker">${escapeHtml(typeLabel(type))}</p>
      <h2>${escapeHtml(recordTitle(type, row))}</h2>
      <p>${escapeHtml(recordMeta(type, row) || "Private standalone record")}</p>
    </section>
    ${renderNeedsReviewBanner(type, row)}
    <section class="card form-card">
      <div class="actions">
        <button data-form-type="${escapeAttr(type)}" data-id="${escapeAttr(id)}">Edit</button>
        <button class="danger" data-delete-record="${escapeAttr(type)}" data-id="${escapeAttr(id)}">Delete</button>
      </div>
      <div class="detail-grid">${renderDetailRows(type, row)}</div>
      ${renderRecordReminderHealth(type, row)}
    </section>
    ${type === "vehicles" ? renderChildRecords("Vehicle records", "vehicleItems", cache.vehicleItems.filter((item) => item.vehicle_id === row.id), row.id, "No vehicle records", "Track services, registration, insurance and repairs here.") : ""}
    ${type === "properties" ? renderPropertyRentalSummary(row.id) : ""}
    ${type === "properties" ? renderChildRecords("Rental agreements", "rentalAgreements", cache.rentalAgreements.filter((item) => item.property_id === row.id), row.id, "No rental agreements", "Track leases, rent, bond and tenancy notes for this property.") : ""}
    ${type === "properties" ? renderChildRecords("Rental statements", "rentalStatements", cache.rentalStatements.filter((item) => item.property_id === row.id), row.id, "No rental statements", "Track rental income, fees, deductions and attached statements.") : ""}
    ${type === "properties" ? renderChildRecords("Home records", "homeItems", cache.homeItems.filter((item) => item.property_id === row.id), row.id, "No home records", "Track rates, insurance, repairs and improvements here.") : ""}
    ${type === "trips" ? renderChildRecords("Trip segments", "tripSegments", cache.tripSegments.filter((item) => item.trip_id === row.id), row.id, "No trip segments", "Track flights, accommodation, transport and activities here.") : ""}
    ${type === "portfolios" ? renderTradeCsvImportSection(row.id) : ""}
    ${type === "portfolios" ? renderChildRecords("Holdings", "holdings", cache.holdings.filter((item) => item.portfolio_id === row.id), row.id, "No holdings", "Track shares, ETFs, funds and crypto here.") : ""}
    ${type === "portfolios" ? renderChildRecords("Trade history", "trades", cache.trades.filter((item) => item.portfolio_id === row.id), row.id, "No trades", "Add buys, sells and transfers to build holdings from a ledger.") : ""}
    ${type === "holdings" ? renderChildRecords("Trade history", "trades", cache.trades.filter((item) => item.holding_id === row.id), row.portfolio_id, "No trades", "Add buys, sells and transfers for this holding.") : ""}
    <section class="card form-card">
      <div class="section-title">
        <h2>Documents</h2>
      </div>
      <form data-attach-owner-type="${escapeAttr(ownerType)}" data-owner-id="${escapeAttr(id)}" class="field-grid">
        <input name="file" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic" required />
        <button type="submit">Attach document</button>
      </form>
      <div class="list">
        ${docs.length === 0 ? empty("No documents attached", "Attach invoices, policies, photos or certificates.") : docs.map(renderDocumentCard).join("")}
      </div>
    </section>
  `;
}

function renderPropertyRentalSummary(propertyId) {
  const agreements = cache.rentalAgreements.filter((item) => item.property_id === propertyId);
  const statements = cache.rentalStatements.filter((item) => item.property_id === propertyId);
  const activeAgreement = agreements.find((item) => {
    const end = daysUntil(item.lease_end);
    return end == null || end >= 0;
  }) ?? agreements[0];
  const annualRent = activeAgreement ? Number(activeAgreement.weekly_rent || 0) * 52 : 0;
  const netIncome = statements.reduce((sum, item) => sum + (Number(item.net_amount) || 0), 0);
  return `
    <section class="card form-card">
      <div class="section-title">
        <h2>Rental overview</h2>
      </div>
      <div class="detail-grid">
        ${detailLine("Current lease", activeAgreement ? recordMeta("rentalAgreements", activeAgreement) : "No lease captured")}
        ${detailLine("Annualised rent", money(annualRent, activeAgreement?.currency ?? defaultCurrency()) ?? `${defaultCurrency()} 0`)}
        ${detailLine("Statements", `${statements.length} statement${statements.length === 1 ? "" : "s"}`)}
        ${detailLine("Tracked net income", money(netIncome, statements[0]?.currency ?? defaultCurrency()) ?? `${defaultCurrency()} 0`)}
      </div>
    </section>
  `;
}

function renderNeedsReviewBanner(type, row) {
  if (!["contracts", "products"].includes(type) || Number(row.extraction_pending ?? 0) !== 1) return "";
  return `
    <section class="record-card warning-card">
      <div class="badge-row">
        <span class="badge warning">Needs review</span>
        <span class="badge">Reminders held</span>
      </div>
      <h3>Confirm details before reminders run</h3>
      <p class="card-meta">This mirrors the connected app's extraction confirmation gate. Review the critical fields, then confirm them here.</p>
      <div class="actions">
        <button data-confirm-details="${escapeAttr(type)}" data-id="${escapeAttr(row.id)}">Confirm details</button>
        <button data-form-type="${escapeAttr(type)}" data-id="${escapeAttr(row.id)}">Edit</button>
      </div>
    </section>
  `;
}

function renderTradeCsvImportSection(portfolioId) {
  return `
    <section class="card form-card">
      <div class="section-title">
        <h2>Import trades</h2>
      </div>
      <p class="muted">Import CommSec, SelfWealth, Stake or generic CSV files with Date, Ticker, Type, Units, Price, Fees and Currency columns.</p>
      <form data-import-trades-portfolio-id="${escapeAttr(portfolioId)}" class="field-grid">
        <input name="file" type="file" accept=".csv,text/csv" required />
        <button type="submit">Import CSV trades</button>
      </form>
    </section>
  `;
}

function renderDetailRows(type, row) {
  const rows = {
    contracts: [
      ["Review status", Number(row.extraction_pending ?? 0) === 1 ? "Needs review" : row.extraction_confirmed_at ? `Confirmed ${readableDate(row.extraction_confirmed_at)}` : null],
      ["Provider", row.provider],
      ["Contract number", row.contract_number],
      ["Category", row.category],
      ["Status", row.status],
      ["Start", readableDate(row.start_date)],
      ["End", readableDate(row.end_date)],
      ["Reminder days", row.reminder_days_before || "30,14,7,1"],
      ["Cost", money(row.cost, row.currency)],
      ["Billing", row.billing_frequency],
      ["Contact", [row.contact_name, row.contact_email, row.contact_phone].filter(Boolean).join(" · ")],
      ["Notes", row.notes],
    ],
    products: [
      ["Review status", Number(row.extraction_pending ?? 0) === 1 ? "Needs review" : row.extraction_confirmed_at ? `Confirmed ${readableDate(row.extraction_confirmed_at)}` : null],
      ["Manufacturer", row.manufacturer],
      ["Model", row.model],
      ["Vendor", row.vendor],
      ["Serial", row.serial_number],
      ["Barcode", row.barcode],
      ["Purchase", readableDate(row.purchase_date)],
      ["Warranty", readableDate(row.warranty_end_date)],
      ["Reminder days", row.reminder_days_before || "30,14,7,1"],
      ["Price", money(row.price, row.currency)],
      ["Notes", row.notes],
    ],
    vehicles: [
      ["Make", row.make],
      ["Model", row.model],
      ["Year", row.year],
      ["Colour", row.colour],
      ["Plate", row.license_plate],
      ["VIN", row.vin],
      ["Rego expiry", readableDate(row.rego_expiry)],
      ["Insurance", readableDate(row.insurance_expiry)],
      ["Reminder days", row.reminder_days_before || "30,14,7,1"],
      ["Notes", row.notes],
    ],
    vehicleItems: [
      ["Type", row.type],
      ["Provider", row.provider],
      ["Date", readableDate(row.date)],
      ["Cost", money(row.cost, row.currency)],
      ["Notes", row.notes],
    ],
    properties: [
      ["Address", [row.street, row.suburb, row.state, row.postcode, row.country].filter(Boolean).join(", ")],
      ["Occupancy", row.occupancy_status],
      ["Rented", row.is_rented ? "Yes" : "No"],
      ["Estimated value", money(row.estimated_value, row.currency)],
      ["Notes", row.notes],
    ],
    homeItems: [
      ["Type", row.type],
      ["Provider", row.provider],
      ["Date", readableDate(row.date)],
      ["Cost", money(row.cost, row.currency)],
      ["Tax deductible", row.is_tax_deductible ? "Yes" : "No"],
      ["Notes", row.notes],
    ],
    rentalAgreements: [
      ["Property", recordTitle("properties", getRecord("properties", row.property_id))],
      ["Tenant", row.tenant_name],
      ["Weekly rent", money(row.weekly_rent, row.currency)],
      ["Management fee", row.management_fee_percent != null ? `${formatNumber(row.management_fee_percent)}%` : null],
      ["Lease start", readableDate(row.lease_start)],
      ["Lease end", readableDate(row.lease_end)],
      ["Bond", money(row.bond_amount, row.currency)],
      ["Linked contract", row.contract_id ? recordTitle("contracts", getRecord("contracts", row.contract_id)) : null],
      ["Notes", row.notes],
    ],
    rentalStatements: [
      ["Property", recordTitle("properties", getRecord("properties", row.property_id))],
      ["Period", [readableDate(row.period_start), row.period_end ? `to ${readableDate(row.period_end)}` : null].filter(Boolean).join(" ")],
      ["Statement date", readableDate(row.statement_date)],
      ["Gross rent", money(row.gross_rent, row.currency)],
      ["Management fee", money(row.management_fee, row.currency)],
      ["Other deductions", money(row.other_deductions, row.currency)],
      ["Net amount", money(row.net_amount, row.currency)],
      ["Notes", row.notes],
    ],
    inventoryItems: [
      ["Category", row.category],
      ["Brand", row.brand],
      ["Model", row.model],
      ["Serial", row.serial_number],
      ["Purchase date", readableDate(row.purchase_date)],
      ["Purchase price", money(row.purchase_price, row.currency)],
      ["Location", row.location],
      ["Notes", row.notes],
    ],
    trips: [
      ["Destination", row.destination],
      ["Start", readableDate(row.start_date)],
      ["End", readableDate(row.end_date)],
      ["Notes", row.notes],
    ],
    tripSegments: [
      ["Type", row.type],
      ["Provider", row.provider],
      ["Confirmation", row.confirmation_code],
      ["Start", readableDate(row.start_date)],
      ["End", readableDate(row.end_date)],
      ["Location", row.location],
      ["Cost", money(row.cost, row.currency)],
      ["Notes", row.notes],
    ],
    portfolios: [
      ["Currency", row.currency],
      ["Description", row.description],
    ],
    holdings: [
      ["Name", row.name],
      ["Asset class", row.asset_class],
      ["Exchange", row.exchange],
      ["Units", row.units],
      ["Average price", money(row.average_price, row.currency)],
      ["Market price", money(row.market_price, row.currency)],
      ["Value", money(holdingValue(row), row.currency)],
      ["Notes", row.notes],
    ],
    trades: [
      ["Portfolio", recordTitle("portfolios", getRecord("portfolios", row.portfolio_id))],
      ["Holding", recordTitle("holdings", getRecord("holdings", row.holding_id))],
      ["Ticker", row.ticker],
      ["Type", row.type],
      ["Date", readableDate(row.trade_date)],
      ["Units", formatNumber(row.units)],
      ["Price", money(row.price_per_unit, row.currency)],
      ["Fees", money(row.fees, row.currency)],
      ["Gross", money((Number(row.units) || 0) * (Number(row.price_per_unit) || 0), row.currency)],
      ["Notes", row.notes],
    ],
  }[type] ?? [];
  return rows
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => renderDetailRow(label, value))
    .join("") || `<p class="muted">No extra details saved yet.</p>`;
}

function renderDetailRow(label, value) {
  const copyable = isCopyableDetail(label);
  return `
    <div class="detail-row">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">
        ${escapeHtml(value)}
        ${copyable ? `<button class="inline-copy" data-copy-value="${escapeAttr(value)}" aria-label="Copy ${escapeAttr(label)}">Copy</button>` : ""}
      </span>
    </div>
  `;
}

function isCopyableDetail(label) {
  return ["Contract number", "Serial", "Barcode", "Plate", "VIN", "Confirmation", "Ticker"].includes(label);
}

function renderRecordReminderHealth(type, row) {
  if (!["contracts", "products", "vehicles"].includes(type)) return "";
  const targets =
    type === "contracts"
      ? [reminderTarget(type, row, "Contract", row.end_date, row.reminder_days_before)]
      : type === "products"
        ? [reminderTarget(type, row, "Warranty", row.warranty_end_date, row.reminder_days_before)]
        : [
            reminderTarget(type, row, "Rego", row.rego_expiry, row.reminder_days_before),
            reminderTarget(type, row, "Insurance", row.insurance_expiry, row.reminder_days_before),
          ];
  return `
    <div class="subsection">
      <h3>Reminder health</h3>
      <div class="list compact-list">
        ${targets.map((target) => `
          <article class="record-card ${target.health.tone === "danger" ? "danger-card" : target.health.tone === "warning" ? "warning-card" : ""}">
            <div class="badge-row">
              <span class="badge ${escapeAttr(target.health.tone === "neutral" ? "" : target.health.tone)}">${escapeHtml(target.health.label)}</span>
              <span class="badge">${escapeHtml(target.kind)}</span>
            </div>
            <p class="card-meta">${escapeHtml(target.health.summary)}</p>
            <p class="card-meta">${escapeHtml(reminderDeliverySummary(target.health))}</p>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderChildRecords(title, type, rows, parentId, emptyTitle, emptyCopy) {
  return `
    <section class="card form-card">
      <div class="section-title">
        <h2>${escapeHtml(title)}</h2>
        <button data-form-type="${escapeAttr(type)}" data-parent-id="${escapeAttr(parentId)}">Add</button>
      </div>
      <div class="list">
        ${rows.length === 0 ? empty(emptyTitle, emptyCopy) : rows.map((row) => renderRecordCard(type, row)).join("")}
      </div>
    </section>
  `;
}

function renderDocuments() {
  const docs = filteredDocuments();
  const inboxDocs = filteredInboxDocuments();
  return `
    ${renderInboxImportSection()}
    <section class="chips" aria-label="Document filters">
      ${documentChip("all", "All")}
      ${documentChip("inbox", "Inbox")}
      ${documentChip("inbox:NEEDS_REVIEW", "Needs review")}
      ${documentChip("inbox:POSSIBLE_DUPLICATE", "Possible duplicate")}
      ${documentChip("important", "Important")}
      ${documentChip("contract", "Contracts")}
      ${documentChip("product", "Products")}
      ${documentChip("vehicle", "Vehicles")}
      ${documentChip("vehicle_item", "Vehicle items")}
      ${documentChip("property", "Home")}
      ${documentChip("rental_agreement", "Leases")}
      ${documentChip("rental_statement", "Rental statements")}
      ${documentChip("inventory_item", "Inventory")}
      ${documentChip("trip", "Travel")}
      ${documentChip("portfolio", "Wealth")}
      ${documentChip("holding", "Holdings")}
      ${documentChip("trade", "Trades")}
    </section>
    <section class="list">
      ${inboxDocs.length === 0 && docs.length === 0 ? empty("No documents yet", "Upload to inbox or attach documents from a record detail screen.") : `${inboxDocs.map(renderInboxCard).join("")}${docs.map(renderDocumentCard).join("")}`}
    </section>
  `;
}

function documentChip(filter, label) {
  return `<button class="chip ${state.documentFilter === filter ? "active" : ""}" data-document-filter="${escapeAttr(filter)}">${escapeHtml(label)}</button>`;
}

function filteredDocuments() {
  return cache.documents
    .filter((doc) => Number(doc.is_head ?? 1) !== 0)
    .filter((doc) => recordTypeEnabled(recordTypeForOwnerType(doc.owner_type)))
    .filter((doc) => {
      if (state.documentFilter === "all") return true;
      if (state.documentFilter === "important") return Number(doc.important ?? 0) === 1;
      if (state.documentFilter.startsWith("inbox")) return false;
      return doc.owner_type === state.documentFilter;
    });
}

function recordTypeForOwnerType(ownerType) {
  return {
    contract: "contracts",
    product: "products",
    vehicle: "vehicles",
    vehicle_item: "vehicleItems",
    property: "properties",
    home_item: "homeItems",
    rental_agreement: "rentalAgreements",
    rental_statement: "rentalStatements",
    inventory_item: "inventoryItems",
    trip: "trips",
    trip_segment: "tripSegments",
    portfolio: "portfolios",
    holding: "holdings",
    trade: "trades",
  }[ownerType] ?? ownerType;
}

function filteredInboxDocuments() {
  return cache.inboxDocuments.filter((doc) => {
    if (state.documentFilter === "all" || state.documentFilter === "inbox") return true;
    if (state.documentFilter.startsWith("inbox:")) return doc.status === state.documentFilter.split(":")[1];
    return false;
  });
}

function renderDocumentCard(doc) {
  const versionCount = documentVersionChain(doc).length;
  const important = Number(doc.important ?? 0) === 1;
  return `
    <article class="record-card">
      <div class="badge-row">
        <span class="badge">${escapeHtml(typeLabel(doc.owner_type))}</span>
        <span class="badge">${escapeHtml(bytesLabel(doc.size))}</span>
        ${important ? '<span class="badge warning">Important</span>' : ""}
        ${versionCount > 1 ? `<span class="badge">${versionCount} versions</span>` : ""}
      </div>
      <h3>${escapeHtml(doc.filename)}</h3>
      <p class="card-meta">${escapeHtml(ownerLabel(doc))} · ${escapeHtml(readableDate(doc.uploaded_at))}</p>
      <div class="actions">
        <button data-open-document="${escapeAttr(doc.id)}">Open</button>
        <button data-toggle-important-document="${escapeAttr(doc.id)}">${important ? "Unstar" : "Mark important"}</button>
        <button class="danger" data-delete-document="${escapeAttr(doc.id)}">Delete</button>
      </div>
      ${versionCount > 1 ? renderDocumentVersionHistory(doc) : ""}
    </article>
  `;
}

function renderInboxCard(doc) {
  const targets = filingTargets();
  const duplicateMatches = duplicateMatchesForInbox(doc);
  const status = inboxStatus(doc);
  return `
    <article class="record-card ${status.tone === "danger" ? "danger-card" : "warning-card"}">
      <div class="badge-row">
        <span class="badge ${escapeAttr(status.tone)}">${escapeHtml(status.label)}</span>
        <span class="badge">${escapeHtml(bytesLabel(doc.size))}</span>
      </div>
      <h3>${escapeHtml(doc.filename)}</h3>
      <p class="card-meta">Inbox · ${escapeHtml(readableDate(doc.uploaded_at))}</p>
      ${duplicateMatches.length > 0 ? `<p class="card-meta">Likely duplicate of ${escapeHtml(duplicateMatches.map(ownerLabel).join(", "))}. File it to the same record to attach as a new version.</p>` : ""}
      <div class="actions">
        <button data-open-inbox-document="${escapeAttr(doc.id)}">Open</button>
        ${duplicateMatches.length > 0 ? `<button data-keep-inbox-separate="${escapeAttr(doc.id)}">Keep separate</button>` : ""}
        <button class="danger" data-delete-inbox-document="${escapeAttr(doc.id)}">Delete</button>
      </div>
      <form data-file-inbox-id="${escapeAttr(doc.id)}" class="field-grid">
        <label>File to existing record
          <select name="target" ${targets.length === 0 ? "disabled" : ""}>
            ${targets.length === 0 ? '<option value="">Add a record first</option>' : targets.map((target) => `<option value="${escapeAttr(target.value)}">${escapeHtml(target.label)}</option>`).join("")}
          </select>
        </label>
        <button type="submit" ${targets.length === 0 ? "disabled" : ""}>File document</button>
      </form>
    </article>
  `;
}

function inboxStatus(doc) {
  if (doc.status === "POSSIBLE_DUPLICATE") return { label: "Possible duplicate", tone: "warning" };
  if (doc.status === "EXTRACTION_FAILED") return { label: "Extraction failed", tone: "danger" };
  if (doc.status === "NEEDS_CLASSIFICATION") return { label: "Needs classification", tone: "warning" };
  return { label: "Needs review", tone: "warning" };
}

function duplicateMatchesForInbox(doc) {
  if (!doc.sha256 || doc.status !== "POSSIBLE_DUPLICATE") return [];
  return cache.documents.filter((item) => item.sha256 === doc.sha256 && Number(item.is_head ?? 1) !== 0);
}

function documentVersionChain(doc) {
  const chain = [];
  let current = doc;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.supersedes_id ? cache.documents.find((item) => item.id === current.supersedes_id) : null;
  }
  return chain;
}

function renderDocumentVersionHistory(doc) {
  const chain = documentVersionChain(doc);
  return `
    <details class="version-history">
      <summary>Version history</summary>
      <div class="list compact-list">
        ${chain.map((version, index) => `
          <article class="mini-row">
            <span>${index === 0 ? "Current" : `Previous v${chain.length - index}`}</span>
            <span>${escapeHtml(version.filename)} · ${escapeHtml(readableDate(version.uploaded_at))}</span>
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function filingTargets() {
  return [
    ...cache.contracts.map((row) => filingTarget("contract", row.id, "Contract", recordTitle("contracts", row))),
    ...cache.products.map((row) => filingTarget("product", row.id, "Product", recordTitle("products", row))),
    ...(moduleEnabled("vehicles") ? cache.vehicles.map((row) => filingTarget("vehicle", row.id, "Vehicle", recordTitle("vehicles", row))) : []),
    ...(moduleEnabled("vehicles") ? cache.vehicleItems.map((row) => filingTarget("vehicle_item", row.id, "Vehicle item", recordTitle("vehicleItems", row))) : []),
    ...(moduleEnabled("properties") ? cache.properties.map((row) => filingTarget("property", row.id, "Home", recordTitle("properties", row))) : []),
    ...(moduleEnabled("properties") ? cache.homeItems.map((row) => filingTarget("home_item", row.id, "Home item", recordTitle("homeItems", row))) : []),
    ...(moduleEnabled("properties") ? cache.rentalAgreements.map((row) => filingTarget("rental_agreement", row.id, "Rental agreement", recordTitle("rentalAgreements", row))) : []),
    ...(moduleEnabled("properties") ? cache.rentalStatements.map((row) => filingTarget("rental_statement", row.id, "Rental statement", recordTitle("rentalStatements", row))) : []),
    ...(moduleEnabled("inventoryItems") ? cache.inventoryItems.map((row) => filingTarget("inventory_item", row.id, "Inventory", recordTitle("inventoryItems", row))) : []),
    ...(moduleEnabled("trips") ? cache.trips.map((row) => filingTarget("trip", row.id, "Trip", recordTitle("trips", row))) : []),
    ...(moduleEnabled("trips") ? cache.tripSegments.map((row) => filingTarget("trip_segment", row.id, "Trip segment", recordTitle("tripSegments", row))) : []),
    ...(moduleEnabled("portfolios") ? cache.portfolios.map((row) => filingTarget("portfolio", row.id, "Portfolio", recordTitle("portfolios", row))) : []),
    ...(moduleEnabled("portfolios") ? cache.holdings.map((row) => filingTarget("holding", row.id, "Holding", recordTitle("holdings", row))) : []),
    ...(moduleEnabled("portfolios") ? cache.trades.map((row) => filingTarget("trade", row.id, "Trade", recordTitle("trades", row))) : []),
  ].sort((a, b) => a.label.localeCompare(b.label));
}

function filingTarget(ownerType, ownerId, label, title) {
  return {
    value: `${ownerType}|${ownerId}`,
    label: `${label} — ${title}`,
  };
}

function renderSearch() {
  const results = searchResults();
  return `
    <section class="search-row">
      <input id="global-search" value="${escapeAttr(state.searchQuery)}" placeholder="Search records and documents…" />
      <button data-clear-search>Clear</button>
    </section>
    <section id="search-results" class="list">
      ${state.searchQuery.trim() === "" ? empty("Search Hearth", "Find contracts, products, vehicles, vehicle records and documents stored on this phone.") : results.length === 0 ? empty("Nothing found", "Try another title, provider, serial, plate, filename or note.") : results.map(renderSearchResult).join("")}
    </section>
  `;
}

function searchResults() {
  const text = state.searchQuery.trim().toLowerCase();
  if (!text) return [];
  const records = [
    ...cache.contracts.map((row) => ({ kind: "record", type: "contracts", row })),
    ...cache.products.map((row) => ({ kind: "record", type: "products", row })),
    ...(moduleEnabled("vehicles") ? cache.vehicles.map((row) => ({ kind: "record", type: "vehicles", row })) : []),
    ...(moduleEnabled("vehicles") ? cache.vehicleItems.map((row) => ({ kind: "record", type: "vehicleItems", row })) : []),
    ...(moduleEnabled("properties") ? cache.properties.map((row) => ({ kind: "record", type: "properties", row })) : []),
    ...(moduleEnabled("properties") ? cache.homeItems.map((row) => ({ kind: "record", type: "homeItems", row })) : []),
    ...(moduleEnabled("properties") ? cache.rentalAgreements.map((row) => ({ kind: "record", type: "rentalAgreements", row })) : []),
    ...(moduleEnabled("properties") ? cache.rentalStatements.map((row) => ({ kind: "record", type: "rentalStatements", row })) : []),
    ...(moduleEnabled("inventoryItems") ? cache.inventoryItems.map((row) => ({ kind: "record", type: "inventoryItems", row })) : []),
    ...(moduleEnabled("trips") ? cache.trips.map((row) => ({ kind: "record", type: "trips", row })) : []),
    ...(moduleEnabled("trips") ? cache.tripSegments.map((row) => ({ kind: "record", type: "tripSegments", row })) : []),
    ...(moduleEnabled("portfolios") ? cache.portfolios.map((row) => ({ kind: "record", type: "portfolios", row })) : []),
    ...(moduleEnabled("portfolios") ? cache.holdings.map((row) => ({ kind: "record", type: "holdings", row })) : []),
    ...(moduleEnabled("portfolios") ? cache.trades.map((row) => ({ kind: "record", type: "trades", row })) : []),
  ].filter((item) => recordTypeEnabled(item.type) && recordSearchText(item.type, item.row).includes(text));
  const documents = cache.documents
    .filter((doc) => [doc.filename, ownerLabel(doc), doc.extracted_text].join(" ").toLowerCase().includes(text))
    .map((doc) => ({ kind: "document", doc }));
  const inbox = cache.inboxDocuments
    .filter((doc) => [doc.filename, doc.extracted_text, doc.status].join(" ").toLowerCase().includes(text))
    .map((doc) => ({ kind: "inbox", doc }));
  return [...records, ...documents, ...inbox].slice(0, 60);
}

function renderSearchResult(result) {
  if (result.kind === "document") return renderDocumentCard(result.doc);
  if (result.kind === "inbox") return renderInboxCard(result.doc);
  return renderRecordCard(result.type, result.row);
}

function renderForm() {
  if (!state.form) return empty("No form selected", "Choose something to add.");
  const type = state.form.type;
  const row = state.form.id ? getRecord(type, state.form.id) : null;
  const title = state.form.id ? `Edit ${typeLabel(type).toLowerCase()}` : `Add ${typeLabel(type).toLowerCase()}`;
  const recordTypesWithoutInlineFiles = new Set(["vehicleItems", "homeItems", "tripSegments", "holdings", "trades"]);
  return `
    <form class="form-card" data-save-type="${escapeAttr(type)}" data-id="${escapeAttr(state.form.id ?? "")}" data-parent-id="${escapeAttr(state.form.parentId ?? "")}">
      <h2>${escapeHtml(title)}</h2>
      ${formFields(type, row)}
      ${recordTypesWithoutInlineFiles.has(type) ? "" : '<input name="file" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic" />'}
      <div class="actions">
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-cancel-form>Cancel</button>
      </div>
    </form>
  `;
}

function formFields(type, row) {
  if (type === "contracts") {
    return `
      <div class="field-grid">
        <label>Title<input name="title" value="${escapeAttr(row?.title)}" required /></label>
        <label>Provider<input name="provider" value="${escapeAttr(row?.provider)}" required /></label>
        <label>Contract number<input name="contractNumber" value="${escapeAttr(row?.contract_number)}" /></label>
        <label>Category<input name="category" value="${escapeAttr(row?.category ?? "OTHER")}" /></label>
        <label>Status<select name="status">${options(["ACTIVE", "CANCELLED", "EXPIRED"], row?.status ?? "ACTIVE")}</select></label>
        <label>Start date<input name="startDate" type="date" value="${escapeAttr(dateInputValue(row?.start_date))}" /></label>
        <label>End date<input name="endDate" type="date" value="${escapeAttr(dateInputValue(row?.end_date))}" /></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.01" value="${escapeAttr(row?.cost ?? "")}" /></label>
        <label>Billing<select name="billingFrequency">${options(["", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "ANNUALLY", "ONE_OFF"], row?.billing_frequency ?? "")}</select></label>
        <label>Reminder days before<input name="reminderDaysBefore" inputmode="numeric" value="${escapeAttr(row?.reminder_days_before ?? "30,14,7,1")}" placeholder="30,14,7,1" /></label>
        <label class="checkbox-row"><input name="needsReview" type="checkbox" ${Number(row?.extraction_pending ?? 0) === 1 ? "checked" : ""} /> Needs review — hold reminders until confirmed</label>
        <label>Contact email<input name="contactEmail" type="email" value="${escapeAttr(row?.contact_email)}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "products") {
    return `
      <div class="field-grid">
        <label>Description<input name="description" value="${escapeAttr(row?.description)}" required /></label>
        <label>Manufacturer<input name="manufacturer" value="${escapeAttr(row?.manufacturer)}" /></label>
        <label>Model<input name="model" value="${escapeAttr(row?.model)}" /></label>
        <label>Vendor<input name="vendor" value="${escapeAttr(row?.vendor)}" /></label>
        <label>Serial number<input name="serialNumber" value="${escapeAttr(row?.serial_number)}" /></label>
        <label>Barcode<input name="barcode" value="${escapeAttr(row?.barcode)}" /></label>
        <label>Purchase date<input name="purchaseDate" type="date" value="${escapeAttr(dateInputValue(row?.purchase_date))}" /></label>
        <label>Warranty end<input name="warrantyEndDate" type="date" value="${escapeAttr(dateInputValue(row?.warranty_end_date))}" /></label>
        <label>Price<input name="price" type="number" min="0" step="0.01" value="${escapeAttr(row?.price ?? "")}" /></label>
        <label>Reminder days before<input name="reminderDaysBefore" inputmode="numeric" value="${escapeAttr(row?.reminder_days_before ?? "30,14,7,1")}" placeholder="30,14,7,1" /></label>
        <label class="checkbox-row"><input name="needsReview" type="checkbox" ${Number(row?.extraction_pending ?? 0) === 1 ? "checked" : ""} /> Needs review — hold reminders until confirmed</label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "vehicles") {
    return `
      <div class="field-grid">
        <label>Label<input name="label" value="${escapeAttr(row?.label)}" required /></label>
        <label>Make<input name="make" value="${escapeAttr(row?.make)}" /></label>
        <label>Model<input name="model" value="${escapeAttr(row?.model)}" /></label>
        <label>Year<input name="year" type="number" min="1900" max="2100" value="${escapeAttr(row?.year ?? "")}" /></label>
        <label>Colour<input name="colour" value="${escapeAttr(row?.colour)}" /></label>
        <label>Plate<input name="licensePlate" value="${escapeAttr(row?.license_plate)}" /></label>
        <label>VIN<input name="vin" value="${escapeAttr(row?.vin)}" /></label>
        <label>Rego expiry<input name="regoExpiry" type="date" value="${escapeAttr(dateInputValue(row?.rego_expiry))}" /></label>
        <label>Insurance expiry<input name="insuranceExpiry" type="date" value="${escapeAttr(dateInputValue(row?.insurance_expiry))}" /></label>
        <label>Reminder days before<input name="reminderDaysBefore" inputmode="numeric" value="${escapeAttr(row?.reminder_days_before ?? "30,14,7,1")}" placeholder="30,14,7,1" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "vehicleItems") {
    return `
      <div class="field-grid">
        <label>Type<select name="type">${options(["SERVICE", "REGISTRATION", "INSURANCE", "REPAIR", "OTHER"], row?.type ?? "SERVICE")}</select></label>
        <label>Title<input name="title" value="${escapeAttr(row?.title)}" required /></label>
        <label>Provider<input name="provider" value="${escapeAttr(row?.provider)}" /></label>
        <label>Date<input name="date" type="date" value="${escapeAttr(dateInputValue(row?.date))}" /></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.01" value="${escapeAttr(row?.cost ?? "")}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "properties") {
    return `
      <div class="field-grid">
        <label>Label<input name="label" value="${escapeAttr(row?.label)}" required /></label>
        <label>Street<input name="street" value="${escapeAttr(row?.street)}" /></label>
        <label>Suburb<input name="suburb" value="${escapeAttr(row?.suburb)}" /></label>
        <label>State<input name="state" value="${escapeAttr(row?.state)}" /></label>
        <label>Postcode<input name="postcode" value="${escapeAttr(row?.postcode)}" /></label>
        <label>Country<input name="country" value="${escapeAttr(row?.country ?? "Australia")}" /></label>
        <label>Occupancy<select name="occupancyStatus">${options(["OWNER_OCCUPIED", "RENTED", "VACANT"], row?.occupancy_status ?? "OWNER_OCCUPIED")}</select></label>
        <label>Estimated value<input name="estimatedValue" type="number" min="0" step="0.01" value="${escapeAttr(row?.estimated_value ?? "")}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "homeItems") {
    return `
      <div class="field-grid">
        <label>Type<select name="type">${options(["RATES", "INSURANCE", "MAINTENANCE", "IMPROVEMENT", "UTILITY", "OTHER"], row?.type ?? "OTHER")}</select></label>
        <label>Title<input name="title" value="${escapeAttr(row?.title)}" required /></label>
        <label>Provider<input name="provider" value="${escapeAttr(row?.provider)}" /></label>
        <label>Date<input name="date" type="date" value="${escapeAttr(dateInputValue(row?.date))}" /></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.01" value="${escapeAttr(row?.cost ?? "")}" /></label>
        <label>Tax deductible<select name="isTaxDeductible">${options(["NO", "YES"], row?.is_tax_deductible ? "YES" : "NO")}</select></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "rentalAgreements") {
    const propertyId = row?.property_id ?? state.form?.parentId ?? "";
    return `
      <div class="field-grid">
        <input name="propertyId" type="hidden" value="${escapeAttr(propertyId)}" />
        <label>Tenant name<input name="tenantName" value="${escapeAttr(row?.tenant_name)}" /></label>
        <label>Weekly rent<input name="weeklyRent" type="number" min="0" step="0.01" value="${escapeAttr(row?.weekly_rent ?? "")}" required /></label>
        <label>Management fee %<input name="managementFeePercent" type="number" min="0" step="0.01" value="${escapeAttr(row?.management_fee_percent ?? "")}" /></label>
        <label>Lease start<input name="leaseStart" type="date" value="${escapeAttr(dateInputValue(row?.lease_start))}" /></label>
        <label>Lease end<input name="leaseEnd" type="date" value="${escapeAttr(dateInputValue(row?.lease_end))}" /></label>
        <label>Bond amount<input name="bondAmount" type="number" min="0" step="0.01" value="${escapeAttr(row?.bond_amount ?? "")}" /></label>
        <label>Currency<input name="currency" value="${escapeAttr(row?.currency ?? defaultCurrency())}" /></label>
        <label>Linked contract<select name="contractId">${contractOptions(row?.contract_id)}</select></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "rentalStatements") {
    const propertyId = row?.property_id ?? state.form?.parentId ?? "";
    return `
      <div class="field-grid">
        <input name="propertyId" type="hidden" value="${escapeAttr(propertyId)}" />
        <label>Period start<input name="periodStart" type="date" value="${escapeAttr(dateInputValue(row?.period_start))}" /></label>
        <label>Period end<input name="periodEnd" type="date" value="${escapeAttr(dateInputValue(row?.period_end))}" /></label>
        <label>Statement date<input name="statementDate" type="date" value="${escapeAttr(dateInputValue(row?.statement_date))}" /></label>
        <label>Gross rent<input name="grossRent" type="number" min="0" step="0.01" value="${escapeAttr(row?.gross_rent ?? "")}" /></label>
        <label>Management fee<input name="managementFee" type="number" min="0" step="0.01" value="${escapeAttr(row?.management_fee ?? "")}" /></label>
        <label>Other deductions<input name="otherDeductions" type="number" min="0" step="0.01" value="${escapeAttr(row?.other_deductions ?? "")}" /></label>
        <label>Net amount<input name="netAmount" type="number" step="0.01" value="${escapeAttr(row?.net_amount ?? "")}" /></label>
        <label>Currency<input name="currency" value="${escapeAttr(row?.currency ?? defaultCurrency())}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "inventoryItems") {
    return `
      <div class="field-grid">
        <label>Label<input name="label" value="${escapeAttr(row?.label)}" required /></label>
        <label>Category<input name="category" value="${escapeAttr(row?.category ?? "OTHER")}" /></label>
        <label>Brand<input name="brand" value="${escapeAttr(row?.brand)}" /></label>
        <label>Model<input name="model" value="${escapeAttr(row?.model)}" /></label>
        <label>Serial number<input name="serialNumber" value="${escapeAttr(row?.serial_number)}" /></label>
        <label>Purchase date<input name="purchaseDate" type="date" value="${escapeAttr(dateInputValue(row?.purchase_date))}" /></label>
        <label>Purchase price<input name="purchasePrice" type="number" min="0" step="0.01" value="${escapeAttr(row?.purchase_price ?? "")}" /></label>
        <label>Location<input name="location" value="${escapeAttr(row?.location)}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "trips") {
    return `
      <div class="field-grid">
        <label>Title<input name="title" value="${escapeAttr(row?.title)}" required /></label>
        <label>Destination<input name="destination" value="${escapeAttr(row?.destination)}" /></label>
        <label>Start date<input name="startDate" type="date" value="${escapeAttr(dateInputValue(row?.start_date))}" /></label>
        <label>End date<input name="endDate" type="date" value="${escapeAttr(dateInputValue(row?.end_date))}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "tripSegments") {
    return `
      <div class="field-grid">
        <label>Type<select name="type">${options(["FLIGHT", "ACCOMMODATION", "CAR_RENTAL", "TRAIN", "ACTIVITY", "OTHER"], row?.type ?? "OTHER")}</select></label>
        <label>Title<input name="title" value="${escapeAttr(row?.title)}" required /></label>
        <label>Provider<input name="provider" value="${escapeAttr(row?.provider)}" /></label>
        <label>Confirmation<input name="confirmationCode" value="${escapeAttr(row?.confirmation_code)}" /></label>
        <label>Start<input name="startDate" type="date" value="${escapeAttr(dateInputValue(row?.start_date))}" /></label>
        <label>End<input name="endDate" type="date" value="${escapeAttr(dateInputValue(row?.end_date))}" /></label>
        <label>Location<input name="location" value="${escapeAttr(row?.location)}" /></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.01" value="${escapeAttr(row?.cost ?? "")}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "portfolios") {
    return `
      <div class="field-grid">
        <label>Name<input name="name" value="${escapeAttr(row?.name)}" required /></label>
        <label>Description<textarea name="description">${escapeHtml(row?.description)}</textarea></label>
        <label>Currency<input name="currency" value="${escapeAttr(row?.currency ?? defaultCurrency())}" /></label>
      </div>
    `;
  }
  if (type === "holdings") {
    return `
      <div class="field-grid">
        <label>Ticker<input name="ticker" value="${escapeAttr(row?.ticker)}" required /></label>
        <label>Name<input name="name" value="${escapeAttr(row?.name)}" /></label>
        <label>Asset class<select name="assetClass">${options(["SHARE", "ETF", "FUND", "CRYPTO", "CASH", "OTHER"], row?.asset_class ?? "SHARE")}</select></label>
        <label>Exchange<input name="exchange" value="${escapeAttr(row?.exchange)}" /></label>
        <label>Units<input name="units" type="number" step="0.000001" value="${escapeAttr(row?.units ?? "")}" /></label>
        <label>Average price<input name="averagePrice" type="number" min="0" step="0.000001" value="${escapeAttr(row?.average_price ?? "")}" /></label>
        <label>Market price<input name="marketPrice" type="number" min="0" step="0.000001" value="${escapeAttr(row?.market_price ?? "")}" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  if (type === "trades") {
    const portfolioId = row?.portfolio_id ?? state.form?.parentId ?? "";
    const portfolio = getRecord("portfolios", portfolioId);
    return `
      <div class="field-grid">
        <label>Ticker<input name="ticker" value="${escapeAttr(row?.ticker)}" autocapitalize="characters" required /></label>
        <label>Type<select name="type">${options(["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"], row?.type ?? "BUY")}</select></label>
        <label>Date<input name="tradeDate" type="date" value="${escapeAttr(dateInputValue(row?.trade_date) || dateInputValue(nowIso()))}" required /></label>
        <label>Units<input name="units" type="number" min="0" step="0.000001" value="${escapeAttr(row?.units ?? "")}" required /></label>
        <label>Price per unit<input name="pricePerUnit" type="number" min="0" step="0.000001" value="${escapeAttr(row?.price_per_unit ?? "")}" required /></label>
        <label>Fees<input name="fees" type="number" min="0" step="0.01" value="${escapeAttr(row?.fees ?? "")}" /></label>
        <label>Currency<input name="currency" value="${escapeAttr(row?.currency ?? portfolio?.currency ?? defaultCurrency())}" /></label>
        <label>Holding name<input name="name" value="${escapeAttr(getRecord("holdings", row?.holding_id)?.name)}" /></label>
        <label>Asset class<select name="assetClass">${options(["SHARE", "ETF", "FUND", "CRYPTO", "CASH", "OTHER"], getRecord("holdings", row?.holding_id)?.asset_class ?? "SHARE")}</select></label>
        <label>Exchange<input name="exchange" value="${escapeAttr(getRecord("holdings", row?.holding_id)?.exchange)}" placeholder="XASX, XNYS, CRYPTO…" /></label>
        <label>Notes<textarea name="notes">${escapeHtml(row?.notes)}</textarea></label>
      </div>
    `;
  }
  return "";
}

function options(values, selected) {
  return values.map((value) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value || "Not set")}</option>`).join("");
}

function contractOptions(selected) {
  return [
    `<option value="" ${selected ? "" : "selected"}>Not linked</option>`,
    ...cache.contracts.map((contract) => `<option value="${escapeAttr(contract.id)}" ${contract.id === selected ? "selected" : ""}>${escapeHtml(recordTitle("contracts", contract))}</option>`),
  ].join("");
}

function empty(title, copy) {
  return `<article class="empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></article>`;
}

function fieldValue(form, name) {
  const control = form.elements.namedItem(name);
  if (!control) return "";
  if ("value" in control) return control.value;
  return "";
}

function fieldChecked(form, name) {
  const control = form.elements.namedItem(name);
  return Boolean(control && "checked" in control && control.checked);
}

function formFile(form) {
  const control = form.elements.namedItem("file");
  return control?.files?.[0] ?? null;
}

async function saveForm(form) {
  const type = form.dataset.saveType;
  if (type === "contracts") await saveContract(form);
  if (type === "products") await saveProduct(form);
  if (type === "vehicles") await saveVehicle(form);
  if (type === "vehicleItems") await saveVehicleItem(form);
  if (type === "properties") await saveProperty(form);
  if (type === "homeItems") await saveHomeItem(form);
  if (type === "rentalAgreements") await saveRentalAgreement(form);
  if (type === "rentalStatements") await saveRentalStatement(form);
  if (type === "inventoryItems") await saveInventoryItem(form);
  if (type === "trips") await saveTrip(form);
  if (type === "tripSegments") await saveTripSegment(form);
  if (type === "portfolios") await savePortfolio(form);
  if (type === "holdings") await saveHolding(form);
  if (type === "trades") await saveTrade(form);
  if (state.localRemindersEnabled && ["contracts", "products", "vehicles"].includes(type)) {
    await syncLocalReminders(false).catch((error) => showStandaloneStatus(error.message || "Saved, but reminders could not be rescheduled."));
  }
  state.route = state.backTo ?? (["vehicleItems", "homeItems", "rentalAgreements", "rentalStatements", "tripSegments", "holdings", "trades"].includes(type) ? "detail" : "records");
  state.form = null;
  showStandaloneStatus("Saved.", true);
  await render();
}

async function saveContract(form) {
  const id = form.dataset.id || localId("contract");
  const exists = Boolean(form.dataset.id);
  const existing = getRecord("contracts", id);
  const extractionPending = fieldChecked(form, "needsReview") ? 1 : 0;
  const extractionConfirmedAt = extractionPending ? null : (Number(existing?.extraction_pending ?? 0) === 1 ? nowIso() : existing?.extraction_confirmed_at ?? null);
  const values = [
    valueOrNull(fieldValue(form, "title")),
    valueOrNull(fieldValue(form, "category")) ?? "OTHER",
    valueOrNull(fieldValue(form, "provider")),
    valueOrNull(fieldValue(form, "contractNumber")),
    valueOrNull(fieldValue(form, "startDate")),
    valueOrNull(fieldValue(form, "endDate")),
    numberOrNull(fieldValue(form, "cost")),
    valueOrNull(fieldValue(form, "billingFrequency")),
    valueOrNull(fieldValue(form, "status")) ?? "ACTIVE",
    valueOrNull(fieldValue(form, "contactEmail")),
    valueOrNull(fieldValue(form, "notes")),
    reminderDaysOrDefault(fieldValue(form, "reminderDaysBefore")),
    extractionPending,
    extractionConfirmedAt,
    nowIso(),
  ];
  if (exists) {
    await run(
      "UPDATE contracts SET title = ?, category = ?, provider = ?, contract_number = ?, start_date = ?, end_date = ?, cost = ?, billing_frequency = ?, status = ?, contact_email = ?, notes = ?, reminder_days_before = ?, extraction_pending = ?, extraction_confirmed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [...values, id],
    );
  } else {
    await run(
      "INSERT INTO contracts (id, title, category, provider, contract_number, start_date, end_date, cost, currency, billing_frequency, status, contact_email, notes, reminder_days_before, extraction_pending, extraction_confirmed_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [id, ...values.slice(0, 7), defaultCurrency(), ...values.slice(7, 14), values[14], values[14]],
    );
  }
  await maybeStoreFormFile(form, "contract", id);
}

async function saveProduct(form) {
  const id = form.dataset.id || localId("product");
  const exists = Boolean(form.dataset.id);
  const existing = getRecord("products", id);
  const extractionPending = fieldChecked(form, "needsReview") ? 1 : 0;
  const extractionConfirmedAt = extractionPending ? null : (Number(existing?.extraction_pending ?? 0) === 1 ? nowIso() : existing?.extraction_confirmed_at ?? null);
  const values = [
    valueOrNull(fieldValue(form, "description")),
    valueOrNull(fieldValue(form, "manufacturer")),
    valueOrNull(fieldValue(form, "model")),
    valueOrNull(fieldValue(form, "vendor")),
    valueOrNull(fieldValue(form, "serialNumber")),
    valueOrNull(fieldValue(form, "barcode")),
    valueOrNull(fieldValue(form, "purchaseDate")),
    valueOrNull(fieldValue(form, "warrantyEndDate")),
    numberOrNull(fieldValue(form, "price")),
    valueOrNull(fieldValue(form, "notes")),
    reminderDaysOrDefault(fieldValue(form, "reminderDaysBefore")),
    extractionPending,
    extractionConfirmedAt,
    nowIso(),
  ];
  if (exists) {
    await run(
      "UPDATE products SET description = ?, manufacturer = ?, model = ?, vendor = ?, serial_number = ?, barcode = ?, purchase_date = ?, warranty_end_date = ?, price = ?, notes = ?, reminder_days_before = ?, extraction_pending = ?, extraction_confirmed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [...values, id],
    );
  } else {
    await run(
      "INSERT INTO products (id, description, manufacturer, model, vendor, serial_number, barcode, purchase_date, warranty_end_date, price, currency, notes, reminder_days_before, extraction_pending, extraction_confirmed_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [id, ...values.slice(0, 9), defaultCurrency(), ...values.slice(9, 13), values[13], values[13]],
    );
  }
  await maybeStoreFormFile(form, "product", id);
}

async function saveVehicle(form) {
  const id = form.dataset.id || localId("vehicle");
  const exists = Boolean(form.dataset.id);
  const values = [
    valueOrNull(fieldValue(form, "label")),
    valueOrNull(fieldValue(form, "make")),
    valueOrNull(fieldValue(form, "model")),
    numberOrNull(fieldValue(form, "year")),
    valueOrNull(fieldValue(form, "colour")),
    valueOrNull(fieldValue(form, "licensePlate")),
    valueOrNull(fieldValue(form, "vin")),
    valueOrNull(fieldValue(form, "regoExpiry")),
    valueOrNull(fieldValue(form, "insuranceExpiry")),
    valueOrNull(fieldValue(form, "notes")),
    reminderDaysOrDefault(fieldValue(form, "reminderDaysBefore")),
    nowIso(),
  ];
  if (exists) {
    await run(
      "UPDATE vehicles SET label = ?, make = ?, model = ?, year = ?, colour = ?, license_plate = ?, vin = ?, rego_expiry = ?, insurance_expiry = ?, notes = ?, reminder_days_before = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [...values, id],
    );
  } else {
    await run(
      "INSERT INTO vehicles (id, label, make, model, year, colour, license_plate, vin, rego_expiry, insurance_expiry, notes, reminder_days_before, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [id, ...values.slice(0, 11), values[11], values[11]],
    );
  }
  await maybeStoreFormFile(form, "vehicle", id);
}

async function saveVehicleItem(form) {
  const id = form.dataset.id || localId("vehicle_item");
  const exists = Boolean(form.dataset.id);
  const parentVehicleId = form.dataset.parentId || getRecord("vehicleItems", id)?.vehicle_id;
  if (!parentVehicleId) throw new Error("Vehicle record is missing.");
  const values = [
    parentVehicleId,
    valueOrNull(fieldValue(form, "type")) ?? "OTHER",
    valueOrNull(fieldValue(form, "title")),
    valueOrNull(fieldValue(form, "provider")),
    valueOrNull(fieldValue(form, "date")),
    numberOrNull(fieldValue(form, "cost")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run(
      "UPDATE vehicle_items SET vehicle_id = ?, type = ?, title = ?, provider = ?, date = ?, cost = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [...values, id],
    );
  } else {
    await run(
      "INSERT INTO vehicle_items (id, vehicle_id, type, title, provider, date, cost, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [id, ...values.slice(0, 6), defaultCurrency(), values[6], values[7], values[7]],
    );
  }
  state.detail = { type: "vehicles", id: parentVehicleId };
}

async function saveProperty(form) {
  const id = form.dataset.id || localId("property");
  const exists = Boolean(form.dataset.id);
  const occupancy = valueOrNull(fieldValue(form, "occupancyStatus")) ?? "OWNER_OCCUPIED";
  const values = [
    valueOrNull(fieldValue(form, "label")),
    valueOrNull(fieldValue(form, "street")),
    valueOrNull(fieldValue(form, "suburb")),
    valueOrNull(fieldValue(form, "state")),
    valueOrNull(fieldValue(form, "postcode")),
    valueOrNull(fieldValue(form, "country")),
    valueOrNull(fieldValue(form, "notes")),
    occupancy === "RENTED" ? 1 : 0,
    occupancy,
    numberOrNull(fieldValue(form, "estimatedValue")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE properties SET label = ?, street = ?, suburb = ?, state = ?, postcode = ?, country = ?, notes = ?, is_rented = ?, occupancy_status = ?, estimated_value = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO properties (id, label, street, suburb, state, postcode, country, notes, is_rented, occupancy_status, estimated_value, currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 10), defaultCurrency(), values[10], values[10]]);
  }
  await maybeStoreFormFile(form, "property", id);
}

async function saveHomeItem(form) {
  const id = form.dataset.id || localId("home_item");
  const exists = Boolean(form.dataset.id);
  const parentId = form.dataset.parentId || getRecord("homeItems", id)?.property_id;
  if (!parentId) throw new Error("Property is missing.");
  const values = [
    parentId,
    valueOrNull(fieldValue(form, "type")) ?? "OTHER",
    valueOrNull(fieldValue(form, "title")),
    valueOrNull(fieldValue(form, "provider")),
    valueOrNull(fieldValue(form, "date")),
    numberOrNull(fieldValue(form, "cost")),
    fieldValue(form, "isTaxDeductible") === "YES" ? 1 : 0,
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE home_items SET property_id = ?, type = ?, title = ?, provider = ?, date = ?, cost = ?, is_tax_deductible = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO home_items (id, property_id, type, title, provider, date, cost, currency, is_tax_deductible, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 6), defaultCurrency(), values[6], values[7], values[8], values[8]]);
  }
  state.detail = { type: "properties", id: parentId };
}

async function saveRentalAgreement(form) {
  const id = form.dataset.id || localId("rental_agreement");
  const exists = Boolean(form.dataset.id);
  const parentId = form.dataset.parentId || fieldValue(form, "propertyId") || getRecord("rentalAgreements", id)?.property_id;
  if (!parentId) throw new Error("Property is missing.");
  const values = [
    parentId,
    valueOrNull(fieldValue(form, "contractId")),
    valueOrNull(fieldValue(form, "tenantName")),
    numberOrNull(fieldValue(form, "weeklyRent")) ?? 0,
    numberOrNull(fieldValue(form, "managementFeePercent")),
    valueOrNull(fieldValue(form, "leaseStart")),
    valueOrNull(fieldValue(form, "leaseEnd")),
    numberOrNull(fieldValue(form, "bondAmount")),
    currencyOrDefault(fieldValue(form, "currency")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE rental_agreements SET property_id = ?, contract_id = ?, tenant_name = ?, weekly_rent = ?, management_fee_percent = ?, lease_start = ?, lease_end = ?, bond_amount = ?, currency = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO rental_agreements (id, property_id, contract_id, tenant_name, weekly_rent, management_fee_percent, lease_start, lease_end, bond_amount, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 10), values[10], values[10]]);
  }
  await maybeStoreFormFile(form, "rental_agreement", id);
  state.detail = { type: "properties", id: parentId };
}

async function saveRentalStatement(form) {
  const id = form.dataset.id || localId("rental_statement");
  const exists = Boolean(form.dataset.id);
  const parentId = form.dataset.parentId || fieldValue(form, "propertyId") || getRecord("rentalStatements", id)?.property_id;
  if (!parentId) throw new Error("Property is missing.");
  const grossRent = numberOrNull(fieldValue(form, "grossRent"));
  const managementFee = numberOrNull(fieldValue(form, "managementFee"));
  const otherDeductions = numberOrNull(fieldValue(form, "otherDeductions"));
  const explicitNetAmount = numberOrNull(fieldValue(form, "netAmount"));
  const netAmount = explicitNetAmount ?? (grossRent != null ? grossRent - (managementFee ?? 0) - (otherDeductions ?? 0) : null);
  const values = [
    parentId,
    valueOrNull(fieldValue(form, "periodStart")),
    valueOrNull(fieldValue(form, "periodEnd")),
    valueOrNull(fieldValue(form, "statementDate")),
    grossRent,
    managementFee,
    otherDeductions,
    netAmount,
    currencyOrDefault(fieldValue(form, "currency")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE rental_statements SET property_id = ?, period_start = ?, period_end = ?, statement_date = ?, gross_rent = ?, management_fee = ?, other_deductions = ?, net_amount = ?, currency = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO rental_statements (id, property_id, period_start, period_end, statement_date, gross_rent, management_fee, other_deductions, net_amount, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 10), values[10], values[10]]);
  }
  await maybeStoreFormFile(form, "rental_statement", id);
  state.detail = { type: "properties", id: parentId };
}

async function saveInventoryItem(form) {
  const id = form.dataset.id || localId("inventory_item");
  const exists = Boolean(form.dataset.id);
  const values = [
    valueOrNull(fieldValue(form, "label")),
    valueOrNull(fieldValue(form, "category")) ?? "OTHER",
    valueOrNull(fieldValue(form, "brand")),
    valueOrNull(fieldValue(form, "model")),
    valueOrNull(fieldValue(form, "serialNumber")),
    valueOrNull(fieldValue(form, "purchaseDate")),
    numberOrNull(fieldValue(form, "purchasePrice")),
    valueOrNull(fieldValue(form, "location")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE inventory_items SET label = ?, category = ?, brand = ?, model = ?, serial_number = ?, purchase_date = ?, purchase_price = ?, location = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO inventory_items (id, label, category, brand, model, serial_number, purchase_date, purchase_price, currency, location, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 7), defaultCurrency(), values[7], values[8], values[9], values[9]]);
  }
  await maybeStoreFormFile(form, "inventory_item", id);
}

async function saveTrip(form) {
  const id = form.dataset.id || localId("trip");
  const exists = Boolean(form.dataset.id);
  const values = [
    valueOrNull(fieldValue(form, "title")),
    valueOrNull(fieldValue(form, "destination")),
    valueOrNull(fieldValue(form, "startDate")),
    valueOrNull(fieldValue(form, "endDate")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE trips SET title = ?, destination = ?, start_date = ?, end_date = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO trips (id, title, destination, start_date, end_date, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 5), values[5], values[5]]);
  }
  await maybeStoreFormFile(form, "trip", id);
}

async function saveTripSegment(form) {
  const id = form.dataset.id || localId("trip_segment");
  const exists = Boolean(form.dataset.id);
  const parentId = form.dataset.parentId || getRecord("tripSegments", id)?.trip_id;
  if (!parentId) throw new Error("Trip is missing.");
  const values = [
    parentId,
    valueOrNull(fieldValue(form, "type")) ?? "OTHER",
    valueOrNull(fieldValue(form, "title")),
    valueOrNull(fieldValue(form, "provider")),
    valueOrNull(fieldValue(form, "confirmationCode")),
    valueOrNull(fieldValue(form, "startDate")),
    valueOrNull(fieldValue(form, "endDate")),
    valueOrNull(fieldValue(form, "location")),
    numberOrNull(fieldValue(form, "cost")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE trip_segments SET trip_id = ?, type = ?, title = ?, provider = ?, confirmation_code = ?, start_date = ?, end_date = ?, location = ?, cost = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO trip_segments (id, trip_id, type, title, provider, confirmation_code, start_date, end_date, location, cost, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 9), defaultCurrency(), values[9], values[10], values[10]]);
  }
  state.detail = { type: "trips", id: parentId };
}

async function savePortfolio(form) {
  const id = form.dataset.id || localId("portfolio");
  const exists = Boolean(form.dataset.id);
  const values = [
    valueOrNull(fieldValue(form, "name")),
    valueOrNull(fieldValue(form, "description")),
    currencyOrDefault(fieldValue(form, "currency")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE portfolios SET name = ?, description = ?, currency = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO portfolios (id, name, description, currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 3), values[3], values[3]]);
  }
}

async function saveHolding(form) {
  const id = form.dataset.id || localId("holding");
  const exists = Boolean(form.dataset.id);
  const parentId = form.dataset.parentId || getRecord("holdings", id)?.portfolio_id;
  if (!parentId) throw new Error("Portfolio is missing.");
  const values = [
    parentId,
    valueOrNull(fieldValue(form, "ticker")),
    valueOrNull(fieldValue(form, "name")),
    valueOrNull(fieldValue(form, "assetClass")) ?? "SHARE",
    valueOrNull(fieldValue(form, "exchange")),
    numberOrNull(fieldValue(form, "units")),
    numberOrNull(fieldValue(form, "averagePrice")),
    numberOrNull(fieldValue(form, "marketPrice")),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (exists) {
    await run("UPDATE holdings SET portfolio_id = ?, ticker = ?, name = ?, asset_class = ?, exchange = ?, units = ?, average_price = ?, market_price = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?", [...values, id]);
  } else {
    await run("INSERT INTO holdings (id, portfolio_id, ticker, name, asset_class, exchange, units, average_price, market_price, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [id, ...values.slice(0, 8), getRecord("portfolios", parentId)?.currency ?? defaultCurrency(), values[8], values[9], values[9]]);
  }
  state.detail = { type: "portfolios", id: parentId };
}

async function saveTrade(form) {
  const id = form.dataset.id || localId("trade");
  const existing = form.dataset.id ? getRecord("trades", id) : null;
  const portfolioId = form.dataset.parentId || existing?.portfolio_id;
  if (!portfolioId) throw new Error("Portfolio is missing.");
  const ticker = normalizeTicker(fieldValue(form, "ticker"));
  if (!ticker) throw new Error("Ticker is required.");
  const holding = await findOrCreateHoldingForTrade(portfolioId, {
    ticker,
    name: valueOrNull(fieldValue(form, "name")),
    assetClass: valueOrNull(fieldValue(form, "assetClass")) ?? "SHARE",
    exchange: valueOrNull(fieldValue(form, "exchange")),
    currency: currencyOrDefault(fieldValue(form, "currency") || getRecord("portfolios", portfolioId)?.currency),
  });
  const values = [
    portfolioId,
    holding.id,
    ticker,
    valueOrNull(fieldValue(form, "type")) ?? "BUY",
    valueOrNull(fieldValue(form, "tradeDate")) ?? dateInputValue(nowIso()),
    numberOrNull(fieldValue(form, "units")) ?? 0,
    numberOrNull(fieldValue(form, "pricePerUnit")) ?? 0,
    numberOrNull(fieldValue(form, "fees")),
    currencyOrDefault(fieldValue(form, "currency") || holding.currency),
    valueOrNull(fieldValue(form, "notes")),
    nowIso(),
  ];
  if (existing) {
    await run(
      "UPDATE trades SET portfolio_id = ?, holding_id = ?, ticker = ?, type = ?, trade_date = ?, units = ?, price_per_unit = ?, fees = ?, currency = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [...values, id],
    );
    if (existing.holding_id !== holding.id) await recomputeHoldingFromTrades(existing.holding_id);
  } else {
    await run(
      "INSERT INTO trades (id, portfolio_id, holding_id, ticker, type, trade_date, units, price_per_unit, fees, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [id, ...values.slice(0, 10), values[10], values[10]],
    );
  }
  await recomputeHoldingFromTrades(holding.id);
  state.detail = { type: "portfolios", id: portfolioId };
}

async function importTradesFromCsv(portfolioId, file) {
  if (!file || file.size === 0) throw new Error("Choose a CSV file.");
  if (!file.name.toLowerCase().endsWith(".csv") && file.type && file.type !== "text/csv") throw new Error("Only CSV files are supported.");
  const portfolio = getRecord("portfolios", portfolioId);
  if (!portfolio) throw new Error("Portfolio not found.");
  const text = await file.text();
  const rows = parseTradesCsvText(text);
  if (rows.length === 0) throw new Error("No valid BUY or SELL trades found in the CSV.");
  if (rows.length > MAX_IMPORTED_TRADES) throw new Error(`That file has ${rows.length} trades — import at most ${MAX_IMPORTED_TRADES} at a time.`);

  let imported = 0;
  let skipped = 0;
  const affectedHoldingIds = new Set();
  for (const row of rows) {
    if (!isSupportedImportedTrade(row)) {
      skipped++;
      continue;
    }
    const holding = await findOrCreateHoldingForTrade(portfolioId, {
      ticker: row.ticker,
      name: null,
      assetClass: "SHARE",
      exchange: inferredExchange(row.ticker),
      currency: row.currency || portfolio.currency || defaultCurrency(),
    });
    const duplicate = await query(
      "SELECT id FROM trades WHERE holding_id = ? AND trade_date = ? AND type = ? AND units = ? AND price_per_unit = ? AND deleted_at IS NULL LIMIT 1",
      [holding.id, row.date, row.type, row.units, row.pricePerUnit],
    );
    if (duplicate.length > 0) {
      skipped++;
      affectedHoldingIds.add(holding.id);
      continue;
    }
    const now = nowIso();
    await run(
      "INSERT INTO trades (id, portfolio_id, holding_id, ticker, type, trade_date, units, price_per_unit, fees, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [localId("trade"), portfolioId, holding.id, row.ticker, row.type, row.date, row.units, row.pricePerUnit, row.fees || null, row.currency || portfolio.currency || defaultCurrency(), `Imported from ${file.name.slice(0, 120)}`, now, now],
    );
    imported++;
    affectedHoldingIds.add(holding.id);
  }
  for (const holdingId of affectedHoldingIds) await recomputeHoldingFromTrades(holdingId);
  return { imported, skipped };
}

function parseTradesCsvText(text) {
  const records = parseCsv(text);
  if (records.length < 2) return [];
  const headers = records[0].map((header) => header.trim());
  const format = detectTradeCsvFormat(headers);
  return records.slice(1).flatMap((values) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    const parsed = parseTradeCsvRow(row, format);
    return parsed ? [parsed] : [];
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index++;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function detectTradeCsvFormat(headers) {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  if (normalized.includes("trade date") && normalized.includes("settlement date")) return "commsec";
  if (normalized.includes("transaction date") && normalized.includes("market")) return "selfwealth";
  if (normalized.includes("order_type")) return "stake";
  return "generic";
}

function parseTradeCsvRow(row, format) {
  if (format === "commsec") {
    const type = normalizeImportedTradeType(row["Type"]);
    if (!type) return null;
    return cleanImportedTrade({
      ticker: `${String(row["Symbol"] ?? "").trim().toUpperCase()}.AX`,
      type,
      date: row["Trade Date"],
      units: row["Quantity"],
      pricePerUnit: row["Price ($)"],
      fees: row["Brokerage ($)"],
      currency: "AUD",
    });
  }
  if (format === "selfwealth") {
    const type = normalizeImportedTradeType(row["Transaction Type"] ?? row["Type"]);
    if (!type) return null;
    const market = String(row["Market"] ?? "ASX").trim().toUpperCase();
    const suffix = market === "ASX" ? ".AX" : "";
    return cleanImportedTrade({
      ticker: `${String(row["Code"] ?? "").trim().toUpperCase()}${suffix}`,
      type,
      date: row["Transaction Date"],
      units: row["Quantity"],
      pricePerUnit: row["Price"],
      fees: row["Brokerage"],
      currency: "AUD",
    });
  }
  if (format === "stake") {
    const type = normalizeImportedTradeType(row["order_type"]);
    if (!type) return null;
    return cleanImportedTrade({
      ticker: row["symbol"],
      type,
      date: row["created_at"],
      units: row["quantity"],
      pricePerUnit: row["price"],
      fees: row["commission"],
      currency: "USD",
    });
  }
  const type = normalizeImportedTradeType(row["Type"]);
  if (!type) return null;
  return cleanImportedTrade({
    ticker: row["Ticker"],
    type,
    date: row["Date"],
    units: row["Units"],
    pricePerUnit: row["Price"],
    fees: row["Fees"],
    currency: row["Currency"] || defaultCurrency(),
  });
}

function cleanImportedTrade(row) {
  const ticker = normalizeTicker(row.ticker);
  const date = normalizeImportedDate(row.date);
  const units = parseCsvNumber(row.units);
  const pricePerUnit = parseCsvNumber(row.pricePerUnit);
  const fees = parseCsvNumber(row.fees) || 0;
  const currency = String(row.currency || defaultCurrency()).trim().toUpperCase();
  if (!ticker || !date || !row.type || !Number.isFinite(units) || units <= 0 || !Number.isFinite(pricePerUnit) || pricePerUnit < 0 || !currency) return null;
  return { ticker, type: row.type, date, units, pricePerUnit, fees, currency };
}

function normalizeImportedTradeType(value) {
  const type = String(value ?? "").trim().toUpperCase();
  if (type === "B" || type.includes("BUY")) return "BUY";
  if (type === "S" || type.includes("SELL")) return "SELL";
  return null;
}

function normalizeImportedDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseCsvNumber(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!text) return 0;
  return Number(text);
}

function isSupportedImportedTrade(row) {
  return ["BUY", "SELL"].includes(row.type) && row.units > 0 && row.pricePerUnit >= 0 && Boolean(row.date && row.ticker);
}

function inferredExchange(ticker) {
  if (ticker.endsWith(".AX")) return "XASX";
  return null;
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

async function findOrCreateHoldingForTrade(portfolioId, input) {
  const existing = cache.holdings.find((holding) => holding.portfolio_id === portfolioId && String(holding.ticker).toUpperCase() === input.ticker);
  if (existing) {
    await run(
      "UPDATE holdings SET name = COALESCE(?, name), asset_class = COALESCE(?, asset_class), exchange = COALESCE(?, exchange), currency = COALESCE(?, currency), updated_at = ?, version = version + 1 WHERE id = ?",
      [input.name, input.assetClass, input.exchange, input.currency, nowIso(), existing.id],
    );
    return { ...existing, ...input, id: existing.id };
  }
  const stored = (await query("SELECT * FROM holdings WHERE portfolio_id = ? AND ticker = ? AND deleted_at IS NULL LIMIT 1", [portfolioId, input.ticker]))[0];
  if (stored) {
    await run(
      "UPDATE holdings SET name = COALESCE(?, name), asset_class = COALESCE(?, asset_class), exchange = COALESCE(?, exchange), currency = COALESCE(?, currency), updated_at = ?, version = version + 1 WHERE id = ?",
      [input.name, input.assetClass, input.exchange, input.currency, nowIso(), stored.id],
    );
    return { ...stored, ...input, id: stored.id };
  }
  const id = localId("holding");
  const now = nowIso();
  await run(
    "INSERT INTO holdings (id, portfolio_id, ticker, name, asset_class, exchange, units, average_price, market_price, currency, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL, ?, ?, 1)",
    [id, portfolioId, input.ticker, input.name, input.assetClass, input.exchange, input.currency, now, now],
  );
  return { id, portfolio_id: portfolioId, ticker: input.ticker, name: input.name, asset_class: input.assetClass, exchange: input.exchange, currency: input.currency };
}

async function recomputeHoldingFromTrades(holdingId) {
  if (!holdingId) return;
  const trades = await query("SELECT * FROM trades WHERE holding_id = ? AND deleted_at IS NULL ORDER BY trade_date ASC, created_at ASC", [holdingId]);
  const holding = getRecord("holdings", holdingId) ?? (await query("SELECT * FROM holdings WHERE id = ?", [holdingId]))[0];
  if (!holding) return;
  let units = 0;
  let costBasis = 0;
  let lastPrice = Number(holding.market_price || holding.average_price) || null;
  let currency = holding.currency || defaultCurrency();
  for (const trade of trades) {
    const tradeUnits = Number(trade.units) || 0;
    const price = Number(trade.price_per_unit) || 0;
    const fees = Number(trade.fees) || 0;
    const type = String(trade.type || "BUY");
    currency = trade.currency || currency;
    if (price > 0) lastPrice = price;
    if (type === "BUY" || type === "TRANSFER_IN") {
      units += tradeUnits;
      costBasis += type === "BUY" ? tradeUnits * price + fees : 0;
    } else if (type === "SELL" || type === "TRANSFER_OUT") {
      const averageCost = units > 0 ? costBasis / units : 0;
      const outgoing = Math.min(tradeUnits, Math.max(units, 0));
      units -= tradeUnits;
      costBasis -= outgoing * averageCost;
      if (costBasis < 0 || units <= 0) costBasis = 0;
    }
  }
  const averagePrice = units > 0 && costBasis > 0 ? costBasis / units : null;
  await run(
    "UPDATE holdings SET units = ?, average_price = ?, market_price = COALESCE(market_price, ?), currency = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    [units, averagePrice, lastPrice, currency, nowIso(), holdingId],
  );
}

async function maybeStoreFormFile(form, ownerType, id) {
  const file = formFile(form);
  if (file) await storeFile(ownerType, id, file);
}

async function deleteRecord(type, id) {
  const row = getRecord(type, id);
  if (!row) return;
  const confirmed = window.confirm(`Delete "${recordTitle(type, row)}" and its local documents?`);
  if (!confirmed) return;
  await softDeleteRecord(type, id);
  if (state.localRemindersEnabled && ["contracts", "products", "vehicles"].includes(type)) {
    await syncLocalReminders(false).catch((error) => showStandaloneStatus(error.message || "Deleted, but reminders could not be rescheduled."));
  }
  state.route = "records";
  state.detail = null;
  showStandaloneStatus("Deleted.", true);
  await render();
}

async function softDeleteRecord(type, id) {
  const ownerType = ownerTypeForRecordType(type);
  const docs = docsFor(ownerType, id);
  for (const doc of docs) await deleteDocument(doc.id, false);
  const table = {
    contracts: "contracts",
    products: "products",
    vehicles: "vehicles",
    vehicleItems: "vehicle_items",
    properties: "properties",
    homeItems: "home_items",
    rentalAgreements: "rental_agreements",
    rentalStatements: "rental_statements",
    inventoryItems: "inventory_items",
    trips: "trips",
    tripSegments: "trip_segments",
    portfolios: "portfolios",
    holdings: "holdings",
    trades: "trades",
  }[type];
  if (!table) throw new Error("Unsupported record type.");
  await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`, [nowIso(), nowIso(), id]);
  if (type === "vehicles") {
    const items = cache.vehicleItems.filter((item) => item.vehicle_id === id);
    for (const item of items) await softDeleteRecord("vehicleItems", item.id);
  }
  if (type === "properties") {
    const items = cache.homeItems.filter((item) => item.property_id === id);
    for (const item of items) await softDeleteRecord("homeItems", item.id);
    const agreements = cache.rentalAgreements.filter((item) => item.property_id === id);
    for (const agreement of agreements) await softDeleteRecord("rentalAgreements", agreement.id);
    const statements = cache.rentalStatements.filter((item) => item.property_id === id);
    for (const statement of statements) await softDeleteRecord("rentalStatements", statement.id);
  }
  if (type === "trips") {
    const items = cache.tripSegments.filter((item) => item.trip_id === id);
    for (const item of items) await softDeleteRecord("tripSegments", item.id);
  }
  if (type === "portfolios") {
    const items = cache.holdings.filter((item) => item.portfolio_id === id);
    for (const item of items) await softDeleteRecord("holdings", item.id);
    const trades = cache.trades.filter((item) => item.portfolio_id === id);
    for (const trade of trades) await softDeleteRecord("trades", trade.id);
  }
  if (type === "holdings") {
    const trades = cache.trades.filter((item) => item.holding_id === id);
    for (const trade of trades) await softDeleteRecord("trades", trade.id);
  }
  if (type === "trades" && row.holding_id) {
    await recomputeHoldingFromTrades(row.holding_id);
  }
}

async function deleteDocument(id, rerender = true) {
  const doc = cache.documents.find((item) => item.id === id);
  if (!doc) return;
  const confirmed = !rerender || window.confirm(`Delete "${doc.filename}" from this device?`);
  if (!confirmed) return;
  await Filesystem?.deleteFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${doc.storage_key}` }).catch(() => undefined);
  await run("UPDATE documents SET deleted_at = ?, version = version + 1 WHERE id = ?", [nowIso(), id]);
  if (rerender) {
    showStandaloneStatus("Document deleted.", true);
    await render();
  }
}

async function deleteInboxDocument(id, rerender = true) {
  const doc = cache.inboxDocuments.find((item) => item.id === id);
  if (!doc) return;
  const confirmed = !rerender || window.confirm(`Delete "${doc.filename}" from inbox?`);
  if (!confirmed) return;
  await Filesystem?.deleteFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${doc.storage_key}` }).catch(() => undefined);
  await run("UPDATE inbox_documents SET deleted_at = ?, version = version + 1 WHERE id = ?", [nowIso(), id]);
  if (rerender) {
    showStandaloneStatus("Inbox document deleted.", true);
    await render();
  }
}

async function fileInboxDocument(form) {
  const doc = cache.inboxDocuments.find((item) => item.id === form.dataset.fileInboxId);
  if (!doc) throw new Error("Inbox document not found.");
  const [ownerType, ownerId] = String(fieldValue(form, "target")).split("|");
  if (!ownerType || !ownerId) throw new Error("Choose a record to file this document to.");
  const matchingHead = duplicateMatchesForInbox(doc).find((item) => item.owner_type === ownerType && item.owner_id === ownerId);
  if (matchingHead) {
    await run("UPDATE documents SET is_head = 0, version = version + 1 WHERE id = ?", [matchingHead.id]);
  }
  await run(
    "INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, mime_type, size, kind, extracted_text, sha256, important, supersedes_id, is_head, uploaded_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 1)",
    [localId("document"), ownerType, ownerId, doc.filename, doc.storage_key, doc.mime_type, doc.size, doc.target_type, doc.extracted_text, doc.sha256, matchingHead?.id ?? null, nowIso()],
  );
  await run("UPDATE inbox_documents SET deleted_at = ?, version = version + 1 WHERE id = ?", [nowIso(), doc.id]);
}

async function keepInboxDocumentSeparate(id) {
  const doc = cache.inboxDocuments.find((item) => item.id === id);
  if (!doc) return;
  await run("UPDATE inbox_documents SET status = 'NEEDS_REVIEW', version = version + 1 WHERE id = ?", [id]);
  showStandaloneStatus(`Kept "${doc.filename}" as a separate inbox document.`, true);
  await render();
}

async function toggleImportantDocument(id) {
  const doc = cache.documents.find((item) => item.id === id);
  if (!doc) return;
  const next = Number(doc.important ?? 0) === 1 ? 0 : 1;
  await run("UPDATE documents SET important = ?, version = version + 1 WHERE id = ?", [next, id]);
  showStandaloneStatus(next ? "Marked important." : "Removed important flag.", true);
  await render();
}

async function toggleStandaloneModule(moduleKey) {
  if (!DEFAULT_STANDALONE_MODULE_KEYS.includes(moduleKey)) return;
  const enabled = moduleEnabled(moduleKey);
  const next = enabled
    ? state.enabledStandaloneModules.filter((key) => key !== moduleKey)
    : [...state.enabledStandaloneModules, moduleKey].filter((key, index, values) => values.indexOf(key) === index);
  state.enabledStandaloneModules = DEFAULT_STANDALONE_MODULE_KEYS.filter((key) => next.includes(key));
  await saveStandaloneModuleSettings();
  if (!recordTypeEnabled(state.recordType)) {
    state.recordType = "contracts";
    state.recordFilter = "all";
  }
  if (state.detail && !recordTypeEnabled(state.detail.type)) {
    state.route = "records";
    state.detail = null;
    state.detailBack = null;
  }
  showStandaloneStatus(`${OPTIONAL_MODULES.find((module) => module.key === moduleKey)?.title ?? "Module"} ${enabled ? "hidden" : "shown"}.`, true);
  await render();
}

async function saveLocalProfile(form) {
  const displayName = valueOrNull(fieldValue(form, "displayName")) ?? "Hearth standalone";
  const currency = currencyOrDefault(fieldValue(form, "defaultCurrency")).slice(0, 6);
  const now = nowIso();
  await run(
    "INSERT OR REPLACE INTO local_profile (id, display_name, default_currency, created_at, updated_at, version) VALUES (?, ?, ?, COALESCE((SELECT created_at FROM local_profile WHERE id = ?), ?), ?, COALESCE((SELECT version FROM local_profile WHERE id = ?), 0) + 1)",
    ["local", displayName, currency, "local", now, now, "local"],
  );
  showStandaloneStatus("Local profile saved.", true);
  await render();
}

async function confirmDetails(type, id) {
  const table = type === "contracts" ? "contracts" : type === "products" ? "products" : null;
  if (!table) return;
  const confirmedAt = nowIso();
  await run(`UPDATE ${table} SET extraction_pending = 0, extraction_confirmed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`, [confirmedAt, confirmedAt, id]);
  if (state.localRemindersEnabled) {
    await syncLocalReminders(false).catch((error) => showStandaloneStatus(error.message || "Details confirmed, but reminders could not be rescheduled."));
  }
  showStandaloneStatus("Details confirmed.", true);
  await render();
}

async function copyValue(value) {
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    }
  } catch {
    // Some WebView/test contexts expose clipboard but reject writes without a
    // transient permission grant. The visible value is still selectable, so the
    // action should not break the screen.
  }
  showStandaloneStatus("Copied.", true);
}

async function openDocument(id) {
  const doc = cache.documents.find((item) => item.id === id);
  await openStoredDocument(doc);
}

async function openInboxDocument(id) {
  const doc = cache.inboxDocuments.find((item) => item.id === id);
  await openStoredDocument(doc);
}

async function openStoredDocument(doc) {
  if (!doc) return;
  if (!Filesystem) throw new Error("Native file storage bridge unavailable.");
  const result = await Filesystem.readFile({ directory: FILE_DIRECTORY, path: `${FILE_ROOT}/${doc.storage_key}` });
  const blob = base64ToBlob(String(result.data ?? ""), doc.mime_type);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function goBack() {
  if (state.route === "form") {
    state.route = state.backTo ?? "records";
    state.form = null;
  } else if (state.route === "detail") {
    if (state.backTo === "detail" && state.detailBack) {
      state.route = "detail";
      state.detail = state.detailBack;
      state.detailBack = null;
    } else {
      state.route = state.backTo ?? "records";
      state.detail = null;
      state.detailBack = null;
    }
  } else if (isSecondaryRoute(state.route)) {
    state.route = state.backTo ?? (state.route === "more" ? "dashboard" : "more");
    state.backTo = null;
  }
  render().catch((error) => showStandaloneStatus(error.message || "Could not go back."));
}

function routeTo(route) {
  const previousRoute = state.route;
  state.route = route;
  state.detail = null;
  state.detailBack = null;
  state.form = null;
  state.backTo = isSecondaryRoute(route) ? (previousRoute === "more" ? "more" : "dashboard") : null;
  render().catch((error) => showStandaloneStatus(error.message || "Could not open screen."));
}

function openForm(type, id = "", parentId = "") {
  if (!recordTypeEnabled(type)) {
    showStandaloneStatus(`${typeLabel(type)} is hidden. Show it again from Settings first.`);
    return;
  }
  state.form = { type, id: id || null, parentId: parentId || null };
  state.detailBack = null;
  state.backTo = state.route === "detail" ? "detail" : state.route;
  state.route = "form";
  render().catch((error) => showStandaloneStatus(error.message || "Could not open form."));
}

$("choose-standalone").addEventListener("click", async () => {
  try {
    await openStandalone();
  } catch (error) {
    showStatus(standaloneStatus, error.message || "Could not open standalone mode.");
  }
});

$("choose-connected").addEventListener("click", async () => {
  await openConnected();
});

switchModeButton.addEventListener("click", async () => {
  await prefRemove(MODE_KEY);
  state.route = "dashboard";
  show("mode");
});

backButton.addEventListener("click", goBack);

document.querySelectorAll("[data-reset-mode]").forEach((button) => {
  button.addEventListener("click", async () => {
    await prefRemove(MODE_KEY);
    show("mode");
  });
});

	$("connect-form").addEventListener("submit", async (event) => {
	  event.preventDefault();
	  try {
	    const url = normalizeUrl($("server-url").value);
	    showStatus(connectedStatus, `Connecting to ${url}...`, true);
	    await ServerConfig.setServerUrl({ url });
	    recordAttempt(url);
	    navigateToConnectedServer(url);
	  } catch (error) {
	    showStatus(connectedStatus, error.message || "Could not connect.");
	  }
	});

$("import-cert-btn").addEventListener("click", async () => {
  if (!ServerConfig) return;
  try {
    const result = await ServerConfig.importClientCertificate();
    showStatus(connectedStatus, result?.label ? `Imported certificate: ${result.label}` : "Certificate imported.", true);
  } catch (error) {
    if (error?.message && !/cancel/i.test(error.message)) showStatus(connectedStatus, error.message);
  }
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.recordType) {
      state.recordType = button.dataset.recordType;
      state.recordFilter = "all";
    }
    routeTo(button.dataset.nav);
  });
});

mobileView.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.nav) {
    if (button.dataset.recordType) state.recordType = button.dataset.recordType;
    routeTo(button.dataset.nav);
    return;
  }
  if (button.dataset.importInbox !== undefined) {
    state.documentFilter = "inbox";
    routeTo("documents");
    return;
  }
  if (button.dataset.recordType) {
    state.recordType = button.dataset.recordType;
    state.recordFilter = "all";
    await render();
    return;
  }
  if (button.dataset.recordFilter) {
    state.recordFilter = button.dataset.recordFilter;
    await render();
    return;
  }
  if (button.dataset.documentFilter) {
    state.documentFilter = button.dataset.documentFilter;
    await render();
    return;
  }
  if (button.dataset.formType) {
    openForm(button.dataset.formType, button.dataset.id, button.dataset.parentId);
    return;
  }
  if (button.dataset.openRecord) {
    if (!recordTypeEnabled(button.dataset.openRecord)) {
      showStandaloneStatus(`${typeLabel(button.dataset.openRecord)} is hidden. Show it again from Settings first.`);
      await render();
      return;
    }
    const previous = state.route;
    const previousDetail = state.detail;
    state.route = "detail";
    state.detail = { type: button.dataset.openRecord, id: button.dataset.id };
    state.detailBack = previous === "detail" && previousDetail ? previousDetail : null;
    state.backTo = previous === "search" ? "search" : previous === "detail" && previousDetail ? "detail" : "records";
    await render();
    return;
  }
  if (button.dataset.deleteRecord) {
    await deleteRecord(button.dataset.deleteRecord, button.dataset.id);
    return;
  }
  if (button.dataset.openDocument) {
    await openDocument(button.dataset.openDocument).catch((error) => showStandaloneStatus(error.message || "Could not open document."));
    return;
  }
  if (button.dataset.openInboxDocument) {
    await openInboxDocument(button.dataset.openInboxDocument).catch((error) => showStandaloneStatus(error.message || "Could not open document."));
    return;
  }
  if (button.dataset.deleteDocument) {
    await deleteDocument(button.dataset.deleteDocument);
    return;
  }
  if (button.dataset.deleteInboxDocument) {
    await deleteInboxDocument(button.dataset.deleteInboxDocument);
    return;
  }
  if (button.dataset.toggleImportantDocument) {
    await toggleImportantDocument(button.dataset.toggleImportantDocument);
    return;
  }
  if (button.dataset.keepInboxSeparate) {
    await keepInboxDocumentSeparate(button.dataset.keepInboxSeparate);
    return;
  }
  if (button.dataset.toggleStandaloneModule) {
    await toggleStandaloneModule(button.dataset.toggleStandaloneModule);
    return;
  }
  if (button.dataset.copyValue) {
    await copyValue(button.dataset.copyValue);
    return;
  }
  if (button.dataset.confirmDetails) {
    await confirmDetails(button.dataset.confirmDetails, button.dataset.id);
    return;
  }
  if (button.dataset.exportStandaloneBackup !== undefined) {
    await exportStandaloneBackup().catch((error) => showStandaloneStatus(error.message || "Could not export backup."));
    return;
  }
  if (button.dataset.cancelForm !== undefined) {
    goBack();
    return;
  }
  if (button.dataset.switchRuntimeMode !== undefined) {
    await prefRemove(MODE_KEY);
    show("mode");
    return;
  }
  if (button.dataset.enableLocalReminders !== undefined) {
    await syncLocalReminders().catch((error) => showStandaloneStatus(error.message || "Could not enable reminders."));
    await render();
    return;
  }
  if (button.dataset.disableLocalReminders !== undefined) {
    await disableLocalReminders().catch((error) => showStandaloneStatus(error.message || "Could not disable reminders."));
    await render();
    return;
  }
  if (button.dataset.clearSearch !== undefined) {
    state.searchQuery = "";
    await render();
    return;
  }
  if (button.dataset.clearAssistant !== undefined) {
    state.assistantQuery = "";
    await render();
  }
});

mobileView.addEventListener("input", (event) => {
  if (event.target.id === "record-search") {
    state.recordQuery = event.target.value;
    const target = $("record-results");
    if (target) {
      const rows = filteredRecords();
      target.innerHTML = rows.length === 0 ? empty("No matching records", "Add a record or adjust the search/filter.") : rows.map((row) => renderRecordCard(state.recordType, row)).join("");
    }
  }
  if (event.target.id === "global-search") {
    state.searchQuery = event.target.value;
    const target = $("search-results");
    if (target) {
      const results = searchResults();
      target.innerHTML = state.searchQuery.trim() === "" ? empty("Search Hearth", "Find contracts, products, vehicles, vehicle records and documents stored on this phone.") : results.length === 0 ? empty("Nothing found", "Try another title, provider, serial, plate, filename or note.") : results.map(renderSearchResult).join("");
    }
  }
  if (event.target.id === "assistant-query") {
    state.assistantQuery = event.target.value;
    const target = $("assistant-results");
    if (target) {
      const results = assistantResults();
      target.innerHTML = state.assistantQuery.trim() === "" ? renderAssistantHints() : results.length === 0 ? empty("No local answer", "Try searching a title, provider, serial number, plate, ticker, booking code, or filename.") : results.map(renderSearchResult).join("");
    }
  }
});

mobileView.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.dataset.saveType) {
      await saveForm(form);
      return;
    }
    if (form.dataset.attachOwnerType) {
      const file = formFile(form);
      if (!file) throw new Error("Choose a file first.");
      await storeFile(form.dataset.attachOwnerType, form.dataset.ownerId, file);
      showStandaloneStatus("Document attached.", true);
      await render();
      return;
    }
    if (form.dataset.saveLocalProfile !== undefined) {
      await saveLocalProfile(form);
      return;
    }
    if (form.dataset.importInboxForm !== undefined) {
      const file = formFile(form);
      if (!file) throw new Error("Choose a file first.");
      await storeInboxFile(file);
      state.documentFilter = "inbox";
      showStandaloneStatus("Document imported.", true);
      await render();
      return;
    }
    if (form.dataset.importTradesPortfolioId) {
      const file = formFile(form);
      const { imported, skipped } = await importTradesFromCsv(form.dataset.importTradesPortfolioId, file);
      showStandaloneStatus(`Imported ${imported} trade${imported === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`, true);
      await render();
      return;
    }
    if (form.dataset.importStandaloneBackupForm !== undefined) {
      await importStandaloneBackup(formFile(form));
      await render();
      return;
    }
    if (form.dataset.fileInboxId) {
      await fileInboxDocument(form);
      state.documentFilter = "all";
      showStandaloneStatus("Document filed.", true);
      await render();
    }
  } catch (error) {
    showStandaloneStatus(error.message || "Could not save.");
  }
});

(async function init() {
  const mode = await prefGet(MODE_KEY);
  if (mode === "standalone") {
    await openStandalone().catch((error) => showStatus(standaloneStatus, error.message || "Could not open standalone mode."));
    return;
  }
  if (mode === "connected") {
    await openConnected();
    await autoConnectIfSaved().catch((error) => showStatus(connectedStatus, error.message || "Stored server address is not usable."));
    return;
  }
  show("mode");
})();
