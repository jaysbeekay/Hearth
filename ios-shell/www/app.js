const { Capacitor } = window;
const Plugins = Capacitor?.Plugins ?? {};
const ServerConfig = Plugins.ServerConfig;
const SQLite = Plugins.CapacitorSQLite;
const Filesystem = Plugins.Filesystem;
const Preferences = Plugins.Preferences;

const DB = "hearth_standalone";
const ENCRYPTED_MODE = "secret";
const ENCRYPT_EXISTING_MODE = "encryption";
const MODE_KEY = "hearth.mobile.runtimeMode";
const LAST_ATTEMPT_KEY = "lastConnectAttempt";
const RETRY_DEBOUNCE_MS = 5000;
const CLEARTEXT_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const CLEARTEXT_SUFFIXES = [".local", ".home.arpa"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
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

const $ = (id) => document.getElementById(id);
const modeScreen = $("mode-screen");
const connectedScreen = $("connected-screen");
const standaloneScreen = $("standalone-screen");
const connectedStatus = $("connected-status");
const standaloneStatus = $("standalone-status");

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
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('standalone_schema_version', '1');
`;

function showStatus(node, message, ok = false) {
  node.textContent = message;
  node.hidden = false;
  node.classList.toggle("ok", ok);
}

function hideStatus(node) {
  node.hidden = true;
  node.textContent = "";
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

function show(screen) {
  modeScreen.hidden = screen !== "mode";
  connectedScreen.hidden = screen !== "connected";
  standaloneScreen.hidden = screen !== "standalone";
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

function recentFailedAttempt() {
  try {
    const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (!raw) return null;
    const { url, ts } = JSON.parse(raw);
    if (url && Date.now() - ts < RETRY_DEBOUNCE_MS) return url;
  } catch {
    // ignore malformed entries
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
  const now = new Date().toISOString();
  await run(
    "INSERT OR IGNORE INTO local_profile (id, display_name, default_currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)",
    ["local", null, "AUD", now, now],
  );
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

function localId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function storeFile(ownerType, ownerId, file) {
  if (!file || file.size === 0) return null;
  if (!Filesystem) throw new Error("Native file storage bridge unavailable.");
  const bytes = await validateFile(file);
  const extension = (file.name.toLowerCase().match(/\.[a-z0-9]{1,10}$/) ?? [""])[0];
  const storageKey = `${ownerType}/${ownerId}/${crypto.randomUUID()}${extension}`;
  const data = bytesToBase64(bytes);
  await Filesystem.writeFile({
    directory: "DATA",
    path: `standalone-documents/${storageKey}`,
    data,
    recursive: true,
  });
  try {
    await run(
      "INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, mime_type, size, uploaded_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [localId("document"), ownerType, ownerId, file.name.slice(0, 255), storageKey, file.type || "application/octet-stream", file.size, new Date().toISOString()],
    );
  } catch (error) {
    await Filesystem.deleteFile({
      directory: "DATA",
      path: `standalone-documents/${storageKey}`,
    }).catch(() => undefined);
    throw error;
  }
  return storageKey;
}

async function validateFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is too large (15MB max).");
  if (!ALLOWED_MIME_TYPES.has(file.type)) throw new Error("Unsupported file type. Use PDF, Word, or image files.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) throw new Error("That file's contents don't match any supported format. Use PDF, Word, or image files.");
  const acceptable = CONTAINER_EQUIVALENTS[sniffed] ?? [sniffed];
  if (!acceptable.includes(file.type)) throw new Error(`That file is labelled ${file.type} but its contents are ${sniffed}.`);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

async function renderStandalone() {
  const [contracts, products, vehicles] = await Promise.all([
    query("SELECT * FROM contracts WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM products WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
    query("SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY updated_at DESC"),
  ]);
  $("contract-count").textContent = String(contracts.length);
  $("product-count").textContent = String(products.length);
  $("vehicle-count").textContent = String(vehicles.length);
  renderList("contract-list", contracts, (item) => ({
    title: item.title,
    meta: [item.provider, item.end_date ? `Ends ${item.end_date}` : null, item.cost ? `${item.currency} ${item.cost}` : null],
  }));
  renderList("product-list", products, (item) => ({
    title: item.description,
    meta: [item.manufacturer, item.warranty_end_date ? `Warranty ${item.warranty_end_date}` : null, item.price ? `${item.currency} ${item.price}` : null],
  }));
  renderList("vehicle-list", vehicles, (item) => ({
    title: item.label,
    meta: [[item.make, item.model].filter(Boolean).join(" "), item.rego_expiry ? `Rego ${item.rego_expiry}` : null],
  }));
}

function renderList(id, rows, map) {
  const node = $(id);
  if (rows.length === 0) {
    node.innerHTML = '<p>No records yet.</p>';
    return;
  }
  node.innerHTML = rows
    .map((row) => {
      const item = map(row);
      const meta = item.meta.filter(Boolean).join(" · ");
      return `<article class="record-card"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(meta)}</p></article>`;
    })
    .join("");
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

async function openStandalone() {
  show("standalone");
  await prefSet(MODE_KEY, "standalone");
  await initDb();
  await renderStandalone();
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
  $("server-url").value = url;
  normalizeUrl(url);
  const failedUrl = recentFailedAttempt();
  if (failedUrl === url) {
    localStorage.removeItem(LAST_ATTEMPT_KEY);
    showStatus(connectedStatus, `Could not reach ${url}. Check the address and try again.`);
    return;
  }
  showStatus(connectedStatus, `Connecting to ${url}...`, true);
  recordAttempt(url);
  window.location.replace(url);
}

$("choose-standalone").addEventListener("click", async () => {
  try {
    hideStatus(standaloneStatus);
    await openStandalone();
  } catch (error) {
    showStatus(standaloneStatus, error.message || "Could not open standalone mode.");
  }
});

$("choose-connected").addEventListener("click", async () => {
  await openConnected();
});

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

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `${tab.dataset.tab}-tab`;
    });
  });
});

$("contract-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const now = new Date().toISOString();
  const recordId = localId("contract");
  await run(
    "INSERT INTO contracts (id, title, category, provider, end_date, cost, currency, billing_frequency, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    [recordId, form.get("title"), "OTHER", form.get("provider"), form.get("endDate") || null, Number(form.get("cost")) || null, "AUD", form.get("billingFrequency") || null, "ACTIVE", now, now],
  );
  await storeFile("contract", recordId, form.get("file"));
  event.currentTarget.reset();
  await renderStandalone();
});

$("product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const now = new Date().toISOString();
  const recordId = localId("product");
  await run(
    "INSERT INTO products (id, description, manufacturer, warranty_end_date, price, currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    [recordId, form.get("description"), form.get("manufacturer") || null, form.get("warrantyEndDate") || null, Number(form.get("price")) || null, "AUD", now, now],
  );
  await storeFile("product", recordId, form.get("file"));
  event.currentTarget.reset();
  await renderStandalone();
});

$("vehicle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const now = new Date().toISOString();
  await run(
    "INSERT INTO vehicles (id, label, make, model, rego_expiry, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    [localId("vehicle"), form.get("label"), form.get("make") || null, form.get("model") || null, form.get("regoExpiry") || null, now, now],
  );
  event.currentTarget.reset();
  await renderStandalone();
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
