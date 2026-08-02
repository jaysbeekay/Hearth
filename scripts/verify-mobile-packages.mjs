#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const failures = [];

function rel(path) {
  return path.replace(`${root}/`, "");
}

function fail(message) {
  failures.push(message);
}

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`Missing file: ${rel(path)}`);
}

function requireDir(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(`Missing directory: ${rel(path)}`);
}

function text(path) {
  requireFile(path);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sha(path) {
  requireFile(path);
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) fail(`${label} does not include ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) fail(`${label} unexpectedly includes ${needle}`);
}

function assertEqual(left, right, label) {
  if (left !== right) fail(`${label} mismatch`);
}

function assertSameAsset(file) {
  const source = join(root, "ios-shell/www", file);
  const ios = join(root, "ios/App/App/public", file);
  const android = join(root, "android/app/src/main/assets/public", file);
  assertEqual(sha(source), sha(ios), `${file}: ios synced asset`);
  assertEqual(sha(source), sha(android), `${file}: android synced asset`);
}

function commandOutput(command, args, label) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8" });
  } catch (error) {
    fail(`${label} failed: ${error.message}`);
    return "";
  }
}

const packageJson = JSON.parse(text(join(root, "package.json")) || "{}");
const requiredDependencies = [
  "@capacitor-community/sqlite",
  "@capacitor/filesystem",
  "@capacitor/local-notifications",
  "@capacitor/preferences",
  "@capacitor/network",
];
for (const dependency of requiredDependencies) {
  if (!packageJson.dependencies?.[dependency]) fail(`package.json missing ${dependency}`);
}

for (const file of ["app.js", "index.html", "style.css", "icon.svg"]) {
  assertSameAsset(file);
}

const shell = text(join(root, "ios-shell/www/app.js"));
for (const marker of [
  "CapacitorSQLite",
  "Filesystem",
  "LocalNotifications",
  "const ServerConfig = Plugins.ServerConfig",
  "function normalizeUrl",
  "function navigateToConnectedServer",
  "Plain HTTP is not allowed",
  "ServerConfig.setServerUrl",
  "autoConnectIfSaved",
  "CREATE TABLE IF NOT EXISTS trades",
  "standalone_schema_version', '7'",
  "CREATE TABLE IF NOT EXISTS rental_agreements",
  "CREATE TABLE IF NOT EXISTS rental_statements",
  "function toggleImportantDocument",
  "function duplicateMatchesForInbox",
  "function renderDocumentVersionHistory",
  "function confirmDetails",
  "function recordReminderScheduleAttempt",
  "function exportStandaloneBackup",
  "function importStandaloneBackup",
  "function renderMore()",
  "function renderHelp()",
  "function toggleStandaloneModule",
  "function saveLocalProfile",
  "function saveTrade",
  "function saveRentalAgreement",
  "function saveRentalStatement",
  "function importTradesFromCsv",
  "function parseTradesCsvText",
  "function recomputeHoldingFromTrades",
  "Trade history",
  "Import CSV trades",
  "Rental agreements",
  "Rental statements",
  "Modules on this phone",
  "Using Hearth on mobile",
  "Local profile",
  "Default currency",
]) {
  assertIncludes(shell, marker, "standalone shell");
}

const html = text(join(root, "ios-shell/www/index.html"));
for (const marker of [
  'data-nav="dashboard">Dashboard',
  'data-nav="records" data-record-type="contracts">Contracts',
  'data-nav="records" data-record-type="products">Warranties',
  'data-nav="documents">Documents',
  'data-nav="more">More',
]) {
  assertIncludes(html, marker, "standalone HTML");
}

const androidPublic = join(root, "android/app/src/main/assets/public");
const iosPublic = join(root, "ios/App/App/public");
requireDir(androidPublic);
requireDir(iosPublic);

const androidConfig = text(join(root, "android/app/src/main/assets/capacitor.config.json"));
const androidPlugins = text(join(root, "android/app/src/main/assets/capacitor.plugins.json"));
for (const plugin of [
  "CapacitorSQLite",
  "Filesystem",
  "LocalNotifications",
  "Preferences",
  "Network",
]) {
  assertIncludes(androidPlugins, plugin, "Android Capacitor plugins");
}
assertIncludes(androidConfig, '"webDir"', "Android Capacitor config");

const androidXmlDir = join(root, "android/app/src/main/res/xml");
const androidXmlFiles = existsSync(androidXmlDir) ? readdirSync(androidXmlDir) : [];
for (const file of androidXmlFiles) {
  if (/\s\d+\.xml$/.test(file)) fail(`Android duplicate resource remains: ${rel(join(androidXmlDir, file))}`);
}

const androidMainActivity = text(join(root, "android/app/src/main/java/com/hearthapp/app/MainActivity.java"));
for (const marker of [
  "registerPlugin(ServerConfigPlugin.class)",
  "getSharedPreferences(ServerConfigPlugin.PREFS_NAME",
  ".setAllowNavigation(new String[]{host})",
  "bridge.setWebViewClient(new MtlsWebViewClient(bridge))",
]) {
  assertIncludes(androidMainActivity, marker, "Android connected-mode activity");
}

const androidServerConfigPlugin = text(join(root, "android/app/src/main/java/com/hearthapp/app/ServerConfigPlugin.java"));
for (const marker of [
  '@CapacitorPlugin(name = "ServerConfig")',
  'static final String PREFS_NAME = "ServerConfig"',
  'static final String SERVER_URL_KEY = "server_url"',
  "public void setServerUrl",
  ".edit().putString(SERVER_URL_KEY, url.trim()).apply()",
  "getActivity().runOnUiThread(() -> getActivity().recreate())",
  "public void importClientCertificate",
]) {
  assertIncludes(androidServerConfigPlugin, marker, "Android ServerConfig plugin");
}

const androidMtlsClient = text(join(root, "android/app/src/main/java/com/hearthapp/app/MtlsWebViewClient.java"));
for (const marker of [
  "extends BridgeWebViewClient",
  "onReceivedClientCertRequest",
  "ClientCertManager.loadCredential(context)",
  "request.proceed(cred.privateKey, cred.chain)",
  "request.cancel()",
]) {
  assertIncludes(androidMtlsClient, marker, "Android mTLS WebView client");
}

const androidManifest = text(join(root, "android/app/src/main/AndroidManifest.xml"));
assertIncludes(androidManifest, 'android:usesCleartextTraffic="false"', "Android manifest");
assertIncludes(androidManifest, 'android:networkSecurityConfig="@xml/network_security_config"', "Android manifest");

const androidNetworkSecurity = text(join(root, "android/app/src/main/res/xml/network_security_config.xml"));
for (const marker of [
  '<base-config cleartextTrafficPermitted="false">',
  '<domain includeSubdomains="true">localhost</domain>',
  '<domain includeSubdomains="true">127.0.0.1</domain>',
  '<domain includeSubdomains="true">local</domain>',
  '<domain includeSubdomains="true">home.arpa</domain>',
]) {
  assertIncludes(androidNetworkSecurity, marker, "Android network security config");
}

const mergedManifestPath = join(
  root,
  "android/app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml",
);
const mergedManifest = text(mergedManifestPath);
for (const marker of [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher",
  "com.capacitorjs.plugins.localnotifications.NotificationDismissReceiver",
  "com.capacitorjs.plugins.localnotifications.LocalNotificationRestoreReceiver",
]) {
  assertIncludes(mergedManifest, marker, "Android merged manifest");
}
assertNotIncludes(mergedManifest, "android.permission.SCHEDULE_EXACT_ALARM", "Android merged manifest");

const apkPath = join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
requireFile(apkPath);
if (existsSync(apkPath)) {
  const apkEntries = commandOutput("unzip", ["-Z1", apkPath], "Inspect Android APK");
  for (const asset of ["assets/public/app.js", "assets/public/index.html", "assets/public/style.css"]) {
    assertIncludes(apkEntries, asset, "Android APK");
  }
}

const iosAppCandidates = [
  process.env.HEARTH_IOS_APP_PATH,
  join(root, "ios/App/build/Build/Products/Debug-iphonesimulator/App.app"),
  "/private/tmp/hearth-ios-derived-data-clean-mobile-branch/Build/Products/Debug-iphonesimulator/App.app",
  "/private/tmp/hearth-ios-derived-data-runtime-iphone17pro/Build/Products/Debug-iphonesimulator/App.app",
  "/private/tmp/hearth-ios-derived-data-mobile-standalone-smoke/Build/Products/Debug-iphonesimulator/App.app",
  "/private/tmp/hearth-ios-derived-data-mobile-more-modules/Build/Products/Debug-iphonesimulator/App.app",
  "/private/tmp/hearth-ios-derived-data-mobile-nav-baseline/Build/Products/Debug-iphonesimulator/App.app",
].filter(Boolean);
const iosAppPath = iosAppCandidates.find((candidate) => existsSync(candidate));
if (!iosAppPath) {
  fail("Missing built iOS simulator App.app bundle. Run the iOS debug build before this verifier.");
} else {
  for (const file of ["app.js", "index.html", "style.css"]) {
    requireFile(join(iosAppPath, "public", file));
    assertEqual(sha(join(root, "ios-shell/www", file)), sha(join(iosAppPath, "public", file)), `iOS App.app public/${file}`);
  }
  const iosInfo = text(join(iosAppPath, "Info.plist"));
  assertIncludes(iosInfo, "com.hearthapp.app", "iOS Info.plist");
}

const iosMainViewController = text(join(root, "ios/App/App/MainViewController.swift"));
for (const marker of [
  "bridge?.registerPluginInstance(ServerConfigPlugin())",
  "override func instanceDescriptor() -> InstanceDescriptor",
  "descriptor.allowedNavigationHostnames += [host]",
  "static func reloadForUpdatedServerUrl()",
]) {
  assertIncludes(iosMainViewController, marker, "iOS connected-mode view controller");
}

const iosServerConfigPlugin = text(join(root, "ios/App/App/ServerConfigPlugin.swift"));
for (const marker of [
  "public let jsName = \"ServerConfig\"",
  "static let serverUrlDefaultsKey = \"server_url\"",
  "@objc func setServerUrl",
  "UserDefaults.standard.set(url, forKey: Self.serverUrlDefaultsKey)",
  "MainViewController.reloadForUpdatedServerUrl()",
  "public override func handleWKWebViewURLAuthenticationChallenge",
  "ClientCertManager.shared.storedIdentity()",
]) {
  assertIncludes(iosServerConfigPlugin, marker, "iOS ServerConfig plugin");
}

const privacyManifest = text(join(root, "ios/App/App/PrivacyInfo.xcprivacy"));
assertIncludes(privacyManifest, "NSPrivacyAccessedAPITypes", "iOS privacy manifest");

if (failures.length > 0) {
  console.error("Mobile package verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mobile package verification passed.");
console.log(`Verified assets: ${["app.js", "index.html", "style.css", "icon.svg"].map((file) => basename(file)).join(", ")}`);
console.log(`Verified Android APK: ${rel(apkPath)}`);
console.log(`Verified iOS app: ${iosAppPath}`);
