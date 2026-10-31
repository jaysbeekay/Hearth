# Proposal: backup and restore for Standalone mode (#226)

Status: proposal for owner review. Refs #226, #399. Written 2026-10-31.
Nothing in this document is implemented; it only recommends.

## Summary

- A Standalone user's data exists only on the phone. A lost, wiped or replaced phone loses everything.
- A manual export/import already exists but is not good enough to promise anything with: it writes an **unencrypted** JSON file to a folder the user cannot reach on iOS, has no passphrase, no share sheet, no schema check and no restore-on-new-phone flow.
- Recommendation: ship an **encrypted, passphrase-protected backup file handed to the system share sheet**, a proper restore flow, and last-backup reminders before the paid unlock goes live. Keep OS backup disabled. Study "push an encrypted backup to my own Hearth server" afterwards. Do not build Hearth-run cloud or direct Drive/iCloud/WebDAV integrations now.

## 1. Problem and what exists today

Standalone mode stores everything in an encrypted SQLite database (`@capacitor-community/sqlite`) with Document files as app-private files, and is a one-time paid unlock (#399). Connected mode stores nothing durable on the phone; the server holds the data and the server has its own backups.

### Facts from the code (at `main` bfb08cc)

All paths are relative to the repo root; line numbers are for `ios-shell/www/app.js` unless stated.

- **Database encryption key is per-install.** `ensureEncryptionSecret()` (655-659) generates a random passphrase with `SQLite.setEncryptionSecret` the first time the app runs. `capacitor.config.ts` (15-27) sets `iosIsEncryption`, `androidIsEncryption`, `iosKeychainPrefix: "hearth-standalone"`, `iosDatabaseLocation: "Library/CapacitorDatabase"`. A reinstall or a new phone generates a new key, so the old database file could not be opened with it even if it were copied. Backup must therefore be a **logical export**, never a file copy.
- **Export exists.** `exportStandaloneBackup()` (2119-2132) calls `buildStandaloneBackup()` (2134-2147), which `SELECT *`s every table in `BACKUP_TABLES` (437-457, 19 tables: profile, contracts, contract terms, products, vehicles and items, properties, home items, rental agreements and statements, inventory, trips and segments, portfolios, holdings, trades, documents, inbox documents, reminder logs). The result is `{ kind: "hearth-standalone-backup", version: 1, schemaVersion, exportedAt, tables }` pretty-printed as JSON.
- **File contents are included.** `enrichBackupRow()` (2149-2153) reads each Document and inbox Document file with `Filesystem.readFile` and inlines it as base64 (`file_data`). The whole backup is therefore one string in memory. Per-file upload cap is 15 MB (`MAX_UPLOAD_BYTES`, line 37), so a data set of 100 scans can exceed a gigabyte of JSON in the worst case; typical households will be tens to hundreds of MB.
- **It is not encrypted.** The file is plain JSON, containing contract numbers, VINs, serial numbers, portfolio holdings, extracted document text and the documents themselves.
- **It goes somewhere hard to reach.** The file is written to `BACKUP_DIRECTORY = "DOCUMENTS"` under `hearth-backups/` (lines 39, 2121-2130). Per the Capacitor Filesystem docs, on iOS `Documents` is invisible in the Files app unless `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are set; `ios/App/App/Info.plist` sets neither, so an iOS user has no way to get the file off the phone short of a device backup. On Android it is the public Documents folder, readable by other apps with access. There is no share sheet: `@capacitor/share` is not a dependency (`package.json`).
- **Import is merge-only and trusting.** `importStandaloneBackup()` (2161-2177) checks only `kind`, then `upsertBackupRow()` (2179-2192) does `INSERT OR REPLACE` per row and rewrites Document files. It ignores `schemaVersion` (`STANDALONE_SCHEMA_VERSION = 10`, line 45) and each row's `version`/`updated_at`, so an older backup silently overwrites newer rows, a newer-schema backup silently drops unknown columns, and a half-finished import leaves a half-restored database (no transaction around the loop). Missing: wipe-and-replace, progress, integrity check.
- **Settings outside SQLite are not backed up.** `STANDALONE_MODULES_KEY`, `LOCAL_REMINDERS_KEY` and similar live in Capacitor Preferences (lines 30-33, 550-562). Restoring on a new phone would reset which modules are shown and whether reminders are on.
- **UI.** Settings has a "Standalone backup" card (2067-2082) with "Export backup" and an "Import backup" file input. Copy at 1992 says "Backups are manual and are not uploaded by Hearth". Nothing records when the last backup happened or warns that none exists. The e2e spec (`e2e/standalone/mobile-shell.spec.ts` 787-806) asserts only that a `DOCUMENTS` write contains the JSON markers.
- **OS backup is deliberately off on Android.** `android/app/src/main/AndroidManifest.xml` line 5 sets `android:allowBackup="false"` and `res/xml/data_extraction_rules.xml` excludes root, file, database, sharedpref and external domains from both `cloud-backup` and `device-transfer`. The comment there is about the connected-mode session cookie and server address, but the rule also covers the standalone database and Documents.
- **Restore on a new device today** is: install, choose Standalone, go through the paywall/Restore purchases, open Settings, pick the JSON file with the file input. This only works if the user kept the file somewhere reachable, which on iOS they cannot.

### What the household already understands as "backup"

On the server (`src/lib/backup/`): `snapshot.ts` takes a `VACUUM INTO` copy, `scheduler.ts` encrypts it with `ENCRYPTION_KEY` (AES-256-GCM) and uploads to exactly one chosen destination (S3-compatible, SFTP or a local path), then prunes to `BACKUP_RETENTION_COUNT`. Admin-controlled, scheduled, encrypted, off-box, with retention. That is the expectation Standalone users will carry over, and it is worth being explicit that Standalone's story is weaker: it is user-driven and not automatic.

## 2. Requirements and non-negotiables

1. The data is sensitive (financial, identity, property). A backup must not be readable by whoever finds, syncs or emails the file.
2. Offline-first: backup and restore must work with no Hearth server and no account.
3. No Hearth-operated cloud, no Hearth-held keys. The user, or the user's own server, holds the copies.
4. Works on iOS and Android with the same file format, because people switch platforms.
5. Restore on a new device must really work, and be rehearsed before launch, not assumed.
6. Paid users get a clear, honest promise (section 4) shown before they pay.
7. The shell is hand-written vanilla JS with no build step; solutions should use platform APIs, Capacitor first-party plugins and Web Crypto, not a bundler-dependent library.
8. A failure must never leave the existing database worse off (atomic restore).

## 3. Options

Ratings are relative: good / ok / poor.

### (a) Do nothing except warn that data is only on the device

- Security: good (nothing leaves the phone). User effort: none. Reliability: poor, the user is their own single point of failure. Restore on new device: impossible. Size: n/a. Store policy: fine. Cost: trivial.
- Verdict: required as a *complement* (honest copy), not acceptable alone for a paid product. It also leaves the existing plaintext export as a trap.

### (b) Manual encrypted export/import via the share sheet

- Flow: Settings, Export backup, choose a passphrase, file is built and encrypted, system share sheet opens, user saves to Files, Drive, iCloud Drive, email, AirDrop, a USB stick. Restore: pick the file, enter the passphrase.
- Security: good if the passphrase is mandatory. The file may then sit in any cloud the user chooses without exposing content. Loss of the passphrase means loss of the backup; that must be stated plainly.
- User effort: low per backup, but depends on the user doing it, hence (c).
- Reliability: good. Same logical format on both platforms; independent of OS backup behaviour and of Keystore/Keychain.
- Restore on new device: good, and cross-platform.
- Size: the real engineering concern. A single base64 JSON string is wrong at scale. Use a chunked container: a small header (format version, schemaVersion, KDF parameters, salt), then records and Document files as separately AES-GCM encrypted chunks, with binary Documents not base64. Write with `Filesystem.writeFile` then `appendFile`; read Documents one at a time. The share sheet takes a `file://` URL (`@capacitor/share` `files`); on Android the file must be in a FileProvider-exposed path, and the default is the cache folder, so write to cache and delete after sharing.
- Store policy: fine. A user-initiated share is "sharing based on a specific user-initiated action" under Google's Data safety rules and sending to the user's own Drive is not collection by the developer. Apple has no export requirement in the guidelines text (checked), only privacy-policy disclosure.
- Cost: medium. Roughly the work in follow-up issues for the file format, share, restore.

### (c) Scheduled / automatic export reminders

- A background job cannot silently write to a user-chosen cloud folder on either OS without a platform-specific file access grant (Android Storage Access Framework tree URI, iOS security-scoped bookmark). Neither is a first-party Capacitor API. What is realistic is a **reminder**: record the last successful export, show a banner on Home and Settings, and schedule a local notification (the shell already uses `LocalNotifications`) if none exists after N days or X new records.
- Security: neutral. Effort: tapping the reminder. Reliability: only as good as the user's follow-through, but far better than nothing. Store policy: fine. Cost: low, builds on (b).
- True unattended backup is (e) or (f).

### (d) OS backup (iCloud Backup / Android Auto Backup / device transfer)

- **Android.** Auto Backup copies shared preferences, `getFilesDir()`, database paths and external files dir to the user's Google Drive, limited to 25 MB per app; over that limit nothing is backed up ([Auto Backup docs](https://developer.android.com/identity/data/autobackup)). Documents alone will exceed 25 MB for many users, so cloud backup would silently stop. Device-to-device transfer is configured separately on Android 12+. The docs say nothing about Keystore keys; the Keystore page states key material is non-exportable and may be bound to secure hardware (TEE/StrongBox) so it never leaves it ([Keystore docs](https://developer.android.com/privacy-and-security/keystore)). Together that means a restored encrypted SQLite file would arrive without a key that can open it. I did not find a primary source that states "Keystore keys are not restored" in as many words, so treat it as an inference to test on real devices, not a verified fact. In any case the plugin's own passphrase is stored by the plugin (mechanism not verified in this research; to check when the plugin sources are available), so the outcome depends on whether that store is included in the backup.
- **iOS.** iCloud Backup includes app data and, under Standard data protection, Apple holds the keys to the backup; with Advanced Data Protection it is end-to-end encrypted ([Apple](https://support.apple.com/en-us/102651)). The page does not say how Keychain items inside a device backup are treated. Apple's documented behaviour for `...ThisDeviceOnly` accessibility is that the item is not migrated to a new device; items without it can move via encrypted backup. I could not fetch the Apple reference page for that, so this is general knowledge to verify. What the plugin chooses for the secret's accessibility class is unknown to me (`iosKeychainPrefix` only namespaces it). `Library/CapacitorDatabase` is in the app container and is included in iCloud Backup unless excluded; a restored DB with a Keychain secret that did not move is unreadable.
- Security: mixed. Data would go to Google or Apple under their key regime, off by the owner's current rules and contrary to the "sensitive" posture. Users cannot inspect or test it; if the key does not follow the data, the backup is a silent dud. Restore on new device: unreliable and untestable by us before launch. Size: Android 25 MB cap. Store policy: fine either way. Cost: low to enable, high to verify.
- Verdict: **keep it off**, and do not use it as the promise. Re-evaluate only if a future test proves key and data both survive on both platforms.

### (e) Optional backup to the user's own Hearth server

- Standalone users who also run a server push an already-encrypted backup blob (the (b) file) to an authenticated endpoint on that server, which stores it with the existing retention and off-site machinery (`src/lib/backup/`). Alternatively switch to Connected mode and import the data, which is a migration, not a backup.
- Security: good, because the server only ever stores ciphertext and never needs the passphrase. Adds token handling. Effort: set once. Reliability: good when the server is up. Restore on new device: download the blob in the app, enter passphrase. Size: server upload limits and mobile data cost. Store policy: sending to a server the user configures; disclose it. Cost: medium (endpoint, token, UI), and it only serves the subset of users with a server; a person who chose Standalone often has none.
- Verdict: phase 2, studied in a spike (#493) first.

### (f) User-chosen cloud folder (Drive / iCloud Drive / WebDAV / S3-compatible)

- Reuses the server's S3/SFTP ideas, so it fits the product's self-hosting spirit.
- Drive/iCloud Drive need OAuth or document-picker bookmarks and platform plugins that are not first-party; the vanilla-JS shell has no build step for SDKs. WebDAV and S3 need credentials stored on the phone, a signing implementation (SigV4) in the shell, and CORS/network config for the WebView. The attack surface and support burden are large for a single developer, and the share sheet in (b) already reaches Drive, iCloud Drive and many WebDAV apps for free.
- Verdict: not now. Revisit only if (b)+(c) feedback shows people will not back up manually.

### Comparison

| | Security | User effort | Reliability | New-device restore | Size | Store policy | Cost |
|---|---|---|---|---|---|---|---|
| a. warn only | good | none | poor | no | n/a | ok | trivial |
| b. encrypted file + share sheet | good | low, manual | good | yes, cross-platform | chunk it | ok | medium |
| c. reminders (on top of b) | good | low | better | same as b | same | ok | low |
| d. OS backup | mixed | none | unproven, 25 MB cap on Android | unproven | poor | ok | low to enable, high to verify |
| e. own Hearth server | good (ciphertext only) | set once | good | yes | server limits | disclose | medium |
| f. cloud folder | good if encrypted | set once | good | yes | ok | disclose | high |

### Encryption of the export (applies to b, e, f)

- Available in the WebView: Web Crypto `subtle.deriveKey` supports PBKDF2 (plus HKDF, ECDH, X25519); **Argon2 is not available** ([MDN, deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)). The shell already uses `crypto.subtle.digest` (line 1134), so the API is present in the Capacitor WebView.
- OWASP currently recommends PBKDF2-HMAC-SHA256 at 600,000 iterations if Argon2id is not available ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)). Use PBKDF2-SHA256 at 600,000 iterations, a random 16-byte salt per file, AES-256-GCM with a fresh 12-byte IV per chunk, and the header bound as additional authenticated data. Store the iteration count in the header so it can be raised later.
- Passphrase strength is the real limit of PBKDF2. Encourage a generated passphrase (the shell already has `generatePassphrase()`; offer to show it once and let the user copy it into a password manager) and a minimum length.
- Unencrypted export: **do not offer it.** A full plaintext dump invites an email attachment containing the user's whole life; if power users ask for portability, offer per-record-type CSV as a separate, clearly labelled feature.
- There is no recovery for a lost passphrase. That is the price of no Hearth-held keys and must be shown at export time.

### Store policy

- Apple: the guidelines text (checked 2026-10-31) has no data export requirement; account deletion (5.1.1(v)) applies only if the app supports account creation, which Standalone does not. The privacy policy must state retention and deletion (5.1.1(i)): add that data is on the device only and deleted by uninstalling, and that exports are the user's responsibility. Restore of the purchase (3.1.1) must keep working and is already in #399.
- Google Play: Data safety treats on-device-only processing as not collected; user-initiated sharing to another app is "sharing" exempt where it is based on a specific user action. Sending to a server the user configures (option e) should be declared. A data deletion mechanism is asked for; uninstall deletes Standalone data, which is worth saying.
- The paywall and listing must not promise automatic or cloud backup that does not exist.

## 4. Recommendation and plan

**Do (b) + (c), keep (d) off, defer (e) behind a spike, skip (f).**

### Phase 1: before the paid unlock goes live (satisfies #399's acceptance criterion)

1. #490: replace the plaintext export with a passphrase-encrypted, chunked `.hearthbackup` file handed to the share sheet; include Preferences-held settings; no plaintext option.
2. #491: real restore: first-launch entry point after Restore purchases, Replace and Merge modes, schema and integrity checks, atomic, cross-platform. Test on a real second device.
3. #492: last-backup status, banner and local reminder; the written promise on the paywall, onboarding, Help and listing; comment the manifest so nobody "helpfully" turns Auto Backup on.

Estimate (one developer, including device testing on two Android and two iOS devices): #490 about 3 to 5 days, #491 about 3 to 4 days, #492 about 1 to 2 days. The biggest risk is memory and speed with large Document sets on older phones, which is why the chunked format is in scope.

### Phase 2: later

4. #493: spike for optional encrypted upload to the user's own Hearth server; ADR and go/no-go.
5. Only on demand: revisit OS backup if tests prove key and data survive, and revisit cloud-folder integrations if manual backup habits prove insufficient.

### The promise (exact copy)

Paywall and store listing (short): "Standalone mode keeps everything on this phone only. Nothing is sent to Hearth or any cloud. Back up regularly to a file protected by your own passphrase, and keep it somewhere safe. If you lose your phone and have no backup, your data cannot be recovered."

In-app, Settings, Backup card: "Your data is stored only on this phone. Export an encrypted backup and save it to Files, Google Drive, iCloud Drive or another place you trust. You will need the passphrase to restore it. Hearth cannot recover it for you. Last backup: [date, or 'never']."

On the export passphrase screen: "Choose a passphrase for this backup. If you lose it, the backup cannot be opened by anyone, including us."

In the store listing "what's new"/description footer: "Optional: Connected mode keeps your data on your own Hearth server, with scheduled server backups."

Avoid the words "automatic", "cloud backup" and "sync" for Standalone.

## 5. Risks and open questions

- **Passphrase loss / weak passphrase.** Mitigate with generated passphrase, clear copy, and a "verify by restoring" prompt on the first backup (decrypt the file header in-app before finishing).
- **Memory on large Document sets.** Needs the chunked format and a device test with several hundred MB; Android WebView memory is the likely failure.
- **Plaintext residue.** The temporary cache copy and any copy the user shares are ciphertext, but anything written by older app versions in `hearth-backups/` is plaintext. Offer to delete old plaintext exports on update. Open question: should the app warn users who already created one?
- **Share sheet on Android uses a FileProvider.** `res/xml/file_paths.xml` must expose the cache path used. I did not review that file in this research; check in #490.
- **Unverified claims in this document.** Keystore behaviour on restore, the iOS Keychain accessibility class used by the SQLite plugin and where the plugin keeps its secret on Android were not confirmed from primary sources. They only matter if option (d) is revisited; test on devices at that time.
- **Cross-platform restore.** The logical format is platform-neutral, but Document MIME handling (HEIC) and file names should be tested iOS to Android and back.
- **Users who never back up.** Reminders help; nothing else will. Accept this and be honest in the copy.
- **Merge semantics.** `version` and `updated_at` exist on most tables but `reminder_delivery_logs` has neither; define its merge rule (keep both, or drop and re-derive).
- **Android public Documents.** Existing exports in the public folder are readable by other apps with the right access; mention in release notes.

## 6. Decisions for the owner

1. **Is Phase 1 (#490, #491, #492) a launch blocker for the paid unlock?** Recommended: yes. The data lives only on the device and a paying user needs a tested restore.
2. **Mandatory passphrase, no plaintext export?** Recommended: yes, mandatory; remove the plaintext JSON export.
3. **Accept "lost passphrase means lost backup"?** Recommended: yes, shown at export time, no recovery mechanism or Hearth-held key.
4. **Keep Android Auto Backup and iCloud-container backup off and not promise them?** Recommended: yes, keep off; revisit only with device proof.
5. **KDF choice: PBKDF2-SHA256 at 600,000 iterations (no bundled Argon2)?** Recommended: yes, since Web Crypto lacks Argon2 and the shell has no build step.
6. **Reminders: banner plus optional local notification, 30-day default?** Recommended: yes, opt-out.
7. **Approve the store/paywall wording in section 4?** Recommended: yes, with edits as you like; the key sentence is that data is on this phone only.
8. **Authorize the Hearth-server spike (#493) as Phase 2, and defer cloud-folder integrations?** Recommended: yes to the spike after launch; defer (f).
9. **Should existing installs get a one-time prompt to make their first encrypted backup and delete old plaintext exports?** Recommended: yes.

## Follow-up issues

- #490 passphrase-encrypted export via share sheet
- #491 restore on a new phone
- #492 last-backup status, reminders and promise copy
- #493 spike: encrypted backup to the user's own Hearth server

## 7. Sources (all checked 2026-10-31)

- Android, Back up user data with Auto Backup: https://developer.android.com/identity/data/autobackup (what is included, 25 MB limit, `allowBackup`, `dataExtractionRules`, `fullBackupContent`, cloud vs device transfer).
- Android, Keystore system: https://developer.android.com/privacy-and-security/keystore (non-exportable, hardware-bound key material; silent on backup and restore).
- Apple, iCloud data security overview: https://support.apple.com/en-us/102651 (backup protection levels; silent on Keychain in backups).
- Apple, `kSecAttrAccessible...ThisDeviceOnly` reference: https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly (page text could not be retrieved; behaviour as generally documented, to verify).
- Apple, App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/ (3.1.1 restore, 5.1.1 privacy and account deletion; first 100,000 characters read).
- Google Play, Data safety: https://support.google.com/googleplay/android-developer/answer/10787469 (collection vs sharing, user-initiated sharing, on-device processing).
- Capacitor, Share plugin: https://capacitorjs.com/docs/apis/share (`files` as `file://` URLs, Android FileProvider note).
- Capacitor, Filesystem plugin: https://capacitorjs.com/docs/apis/filesystem (Documents vs Data, iOS `UIFileSharingEnabled`, Android public Documents).
- MDN, SubtleCrypto.deriveKey: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey (PBKDF2 supported, Argon2 not).
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html (PBKDF2-HMAC-SHA256 600,000 iterations; Argon2id minimums).
- Repo: `ios-shell/www/app.js`, `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/data_extraction_rules.xml`, `ios/App/App/Info.plist`, `src/lib/backup/`, `e2e/standalone/mobile-shell.spec.ts`; issues #226 (including the 2026-10-24 triage comment) and #399.
