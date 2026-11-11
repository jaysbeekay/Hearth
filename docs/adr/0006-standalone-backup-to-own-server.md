---
status: proposed
---

# A standalone phone may upload its encrypted backup to the household's own Hearth server, as ciphertext under a per-device token

A standalone phone's data leaves the phone only when the user shares a `.hearthbackup` file by hand (#226, PR #500). Some households also run a Hearth server, which has room and its own backup routine (`src/lib/backup/`) but nothing that accepts a phone's backup. We propose an optional "Back up to my Hearth server" for standalone mode. The phone uploads the same `.hearthbackup` file that Export makes, already encrypted with the user's backup password, under a **per-device backup token**. The server stores it as an opaque blob, keeps the newest few for each device, and hands them back byte for byte. The server only ever holds ciphertext and never receives the password. The prototype (branch `spike/493-server-backup-upload`, not for merge) round-trips a real backup this way (#493).

## Threat model

The server holds the ciphertext, the file's plaintext header (format version, schema version, export time, PBKDF2 salt and iteration count), each blob's size, upload time and SHA-256, and the SHA-256 of each device token. It never holds the backup password or any key derived from it. The password is used only on the phone, by `backup-format.js`.

- **Server compromise.** The attacker gets every device's ciphertext and can try passwords offline. The protection is PBKDF2-SHA256 at 600,000 iterations with a 12-character minimum, so a generated passphrase holds up and a weak one doesn't. That is the same exposure as a file the user saved to Drive, and the copy should say so. The attacker can also delete or replace blobs. AES-GCM with the header and record index bound as AAD makes any change fail on restore, and restore already bounds the iteration count and checks storage keys and the schema, so a crafted file can't hang or escape the phone. What the attacker can do undetected is serve an *older* genuine backup of the same device (rollback) or none at all. The restore screen must therefore show the export date from inside the decrypted file, not the server's listing. Connected mode on the same phone doesn't change this: server pages run under the server's origin in the WebView, not `capacitor://localhost`, so they can't read the standalone database.
- **Token theft.** A device token can upload, list and download that device's blobs and nothing else: no household records, no other device's blobs, no Documents and no Settings. A thief can download ciphertext and then faces the same offline attack as above. The real harm is availability. Because retention keeps the newest N, a thief who uploads N junk blobs with a valid header pushes out the real backups. The mitigations are a per-token upload rate limit (for example 4 a day), a listing in Settings that shows each upload's time and size, and immediate revocation. Tokens are stored hashed (`hashToken`, as for iCal and invitation tokens), looked up by that hash, and throttled per address on failure, like `/api/mcp`. On the phone the token goes in the Keychain or Keystore, not Preferences.
- **Lost phone.** The finder has a locked phone with an encrypted SQLite database and a token in the Keychain. The user signs in to the server from any browser and revokes that device's token. The backups stay on the server, readable only with the password, and the replacement phone takes them over (see Restore). Without a server, a lost phone with no exported file means lost data. With one, the user loses only what changed since the last upload.
- **Out of scope.** A malicious household admin can delete any device's backups (availability), but can't read them. The server's own offsite backup copies only its database (`snapshot.ts`), not files on disk, so device backups are only as durable as Documents on that disk. The ADR doesn't change that.

## Authentication: a per-device backup token, shared with #543's token model

| Option | Verdict |
|---|---|
| **Reuse a connected-mode session** | Rejected. A standalone user usually has no session on the server. Where one exists, it is an httpOnly SameSite=Lax cookie on the server's origin, which a fetch from `capacitor://localhost` doesn't send, and the proxy's origin check rejects a cross-origin POST anyway. Sessions also expire and need an interactive sign-in, possibly with TOTP or a passkey, which rules out a backup running unattended. And a session can read and write everything in the household, far more than "store my ciphertext" needs. |
| **`MCP_TOKEN` or another household-wide secret** | Rejected for the same reason #543 gives: it is household-wide, set in the environment, and can't be revoked per phone. |
| **Per-device token** (chosen) | Issued from Settings by any non-READONLY member, shown once as a code or QR code to paste into the phone, stored hashed, revocable on its own, with last-used time shown. It authorizes exactly one thing: this device's backup blobs. |

#543 proposes the same shape for the connected-mode Siri intent: per device, read-only, revocable, Keychain-held, mTLS-capable. The triage note asks for one token model, not two. On a "go", build a single **device token** with a scope, `backup` for this ADR and `due:read` for #543, and issue one token per purpose per device rather than one token with both scopes. A stolen backup token then can't read household data, and a stolen Siri token can't touch backups. The routes check the scope, and Settings lists both kinds together under the device's name.

## Size limits

- A `.hearthbackup` file is about **1.78 times** the size of the Documents it holds: base64 inside the JSON record, then base64 of the ciphertext. In the prototype, 150 MB of documents became 267 MB on the wire.
- The proposed default cap is **512 MB per upload** (about 290 MB of documents), set with `DEVICE_BACKUP_MAX_BYTES`. The server enforces it while streaming, so it doesn't rely on Content-Length, and a refused upload leaves no file. A storage bound per device is the cap × the retention count; a household-wide limit on device count keeps the total bounded.
- The route must sit outside `src/proxy.ts`'s matcher. The proxy buffers bodies up to `proxyClientMaxBodySize` (20 MB) and silently cuts off anything longer. That is safe for a Bearer-token API: there is no cookie to forge, so the proxy's session and origin checks have nothing to protect, and the route sets its own `no-store` and `nosniff` headers.
- Reverse proxies in front of self-hosted servers often cap request bodies (nginx defaults to 1 MB, and Cloudflare's free plan to 100 MB), and phones drop connections. A shippable version therefore uploads in **chunks of 8 MB or less**, resumable, with the server assembling a temp file and checking the whole file's SHA-256 before it becomes a backup. Chunking also keeps the phone from reading the whole file into WebView memory, which the prototype still does.

## Retention

Retention reuses the server's pruning rule (`pruneLocal`, `pruneS3`, `pruneSftp`): after each successful upload, keep the newest N for that device and delete the rest, deleting the row and the file together as the Document command does. N defaults to 5 (`DEVICE_BACKUP_RETENTION_COUNT`). Retention is per device, so one phone can't push out another's backups. Revoking a token stops new uploads at once and keeps its backups until someone deletes them in Settings ("Revoke and delete backups") or hands them to a replacement device.

## Restore

- **Same phone** (after a bad edit, say): Settings → Restore from server lists this device's backups by date. The user picks one and enters the password, and the backup goes through the existing `restoreStandaloneBackup` path, so Replace or Merge and every integrity check apply unchanged. The download is checked against the SHA-256 recorded at upload.
- **New phone:** in the server's Settings, the user issues a token *as a replacement for* the lost device. The new token takes over that device's backups and the old one is revoked, all in one step. The new phone pastes the token, lists the backups and restores as above. The fallback, which needs nothing new, is to download the `.hearthbackup` from Settings in a browser and use the existing Restore from file.
- There is no recovery for a lost password, as with an exported file. The server can't help, by design.

## Recommendation: go, with stated limits

Go for an opt-in, manually started "Back up to my Hearth server" in standalone mode, with these limits:

- a per-device, scoped device token shared with #543;
- chunked, resumable upload before it ships;
- 512 MB per backup, with the newest 5 kept per device;
- an upload rate limit per token;
- the date shown on restore comes from inside the file;
- `https` only (loopback excepted);
- no automatic or background upload in the first version, because iOS background execution limits make "automatic" a promise we can't keep.

The privacy policy and Play Data safety form must declare the upload to a user-configured server. The paywall line "Nothing is sent to Hearth or any cloud" stays true, but Settings has to say the server option exists and is off by default.

It becomes **no-go** if either of these fails on real devices:

- chunked reads of a 500 MB backup file stay within memory on an older Android phone;
- a WebView `fetch` to a server behind mTLS presents the client certificate from `ClientCertManager.swift`.

The prototype checked neither.

## Considered Options

- **Server-side encryption with `ENCRYPTION_KEY`.** Rejected: the server would hold a key to the phone's data, which breaks "the server only ever holds ciphertext", and a server compromise would expose everything.
- **Sync instead of backup** (merging standalone rows into the household's records). Rejected: that is connected mode, and a standalone phone's data is not household data on the server.
- **Hearth-operated cloud storage.** Out of scope (#493).
- **Native HTTP (CapacitorHttp) instead of WebView fetch.** Open. It avoids CORS but bypasses the WebView's client-certificate handling, so it is chosen only if WebView fetch fails the mTLS check above.

## Consequences

- New tables for device tokens and backup blobs, a migration, two Bearer-token routes outside the proxy matcher, a Settings card to issue, replace and revoke tokens and list or delete backups, and an exclusion in `src/proxy.ts` that names those routes. Don't widen it to a prefix that could cover a cookie-authenticated route.
- The shell gains a server-backup client and a Settings section in `ios-shell/www/`, a parity item like every shell change. The phone's last-backup date counts a complete server upload the same way it counts a shared file.
- `GLOSSARY.md` gets a term for the device token and for a backup held on the server once the owner decides, and not before.
- #543 is built on the same token model.
