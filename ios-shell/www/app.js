// Bootstrap screen shown before the WebView hands off to the user's own
// self-hosted server. ServerConfig is a native Capacitor plugin (see
// ios/App/App/ServerConfigPlugin.swift) backed by UserDefaults.standard so
// it can also be edited from the iOS Settings app via Settings.bundle.
const { Capacitor } = window;
const ServerConfig = Capacitor?.Plugins?.ServerConfig;

const form = document.getElementById("connect-form");
const input = document.getElementById("server-url");
const status = document.getElementById("status");
const importCertBtn = document.getElementById("import-cert-btn");

function showStatus(message, ok) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle("ok", Boolean(ok));
}

function normalizeUrl(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Address must start with http:// or https://");
  }
  return trimmed;
}

// Debounce flag for the errorPath bounce-back below. Capacitor's
// WebViewDelegationHandler reloads straight to index.html on a failed
// navigation — no query params, no way to tell "fresh launch" apart from
// "just failed" except by leaving ourselves a breadcrumb first.
const LAST_ATTEMPT_KEY = "lastConnectAttempt";
const RETRY_DEBOUNCE_MS = 5000;

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
    // ignore malformed/missing entry
  }
  return null;
}

async function connect(url) {
  // setServerUrl saves the address natively and restarts the bridge so this
  // host is allow-listed for in-WebView navigation (see
  // MainViewController.swift) — that restart reloads this page, and init()
  // below picks up the saved URL and redirects. Nothing further to do here.
  await ServerConfig.setServerUrl({ url });
}

// On launch: if a server URL is already stored (set here previously, or via
// iOS Settings > Hearth), skip straight to it instead of showing the form.
//
// If we land back here within RETRY_DEBOUNCE_MS of attempting that same URL,
// the navigation must have failed (server.errorPath bounced us back) —
// show the failure instead of silently retrying forever.
async function init() {
  if (!ServerConfig) {
    showStatus("Native bridge unavailable — open this build on a device or simulator.", false);
    return;
  }

  const { url } = await ServerConfig.getServerUrl();
  if (!url) return;

  input.value = url;

  const failedUrl = recentFailedAttempt();
  if (failedUrl === url) {
    localStorage.removeItem(LAST_ATTEMPT_KEY);
    showStatus(`Couldn't reach ${url}. Check the address and try again.`, false);
    return;
  }

  showStatus(`Connecting to ${url}…`, true);
  recordAttempt(url);
  window.location.replace(url);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = normalizeUrl(input.value);
    showStatus(`Connecting to ${url}…`, true);
    await connect(url);
  } catch (err) {
    showStatus(err.message || "Could not connect.", false);
  }
});

importCertBtn.addEventListener("click", async () => {
  if (!ServerConfig) return;
  try {
    const result = await ServerConfig.importClientCertificate();
    showStatus(result?.label ? `Imported certificate: ${result.label}` : "Certificate imported.", true);
  } catch (err) {
    // User cancelling the file/password prompt is not an error worth surfacing.
    if (err?.message && !/cancel/i.test(err.message)) {
      showStatus(err.message, false);
    }
  }
});

init();
