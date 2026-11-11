# Spike #493: standalone backup to the user's own Hearth server (NOT FOR MERGE)

Throwaway prototype for the ADR in `docs/adr/0006-standalone-backup-to-own-server.md`
(PR against main on `docs/493-adr-server-backup`). Nothing on this branch is meant to ship.

## What is here

| Piece | File |
|---|---|
| Token + blob tables (hand-written migration) | `prisma/schema.prisma`, `prisma/migrations/20261111120000_spike_493_device_backups/` |
| Upload (streamed, size-capped, header-checked), list, download, prune | `src/lib/deviceBackups.ts` |
| Bearer-token routes, excluded from the proxy matcher | `src/app/api/device-backups/route.ts`, `src/app/api/device-backups/[id]/route.ts`, `src/proxy.ts` |
| Session-authenticated token mint/revoke (stand-in for a Settings UI) | `src/app/api/device-backup-tokens/route.ts` |
| Shell client (pure fetch, UMD like backup-format.js) | `ios-shell/www/server-backup.js`, `index.html` |
| Shell hook: export → upload, list, download → normal restore path | `ios-shell/www/app.js` (`window.__hearthServerBackupSpike`) |
| End-to-end test through the shell harness | `e2e/standalone/mobile-shell.spec.ts` ("SPIKE #493") |
| Large real-blob round trip in Node | `spike-493/large-roundtrip.mjs` |

## How it was run (2026-11-11)

Scratch DB and folders only, never `/data`:

```bash
S=<scratch dir>
export DATABASE_URL="file:$S/app.db" AUTH_SECRET=<random> ENCRYPTION_KEY=$(openssl rand -base64 32) \
  UPLOADS_DIR=$S/uploads DEVICE_BACKUP_DIR=$S/device-backups \
  DEVICE_BACKUP_MAX_BYTES=1048576 DEVICE_BACKUP_RETENTION_COUNT=3 \
  DEVICE_BACKUP_CORS_ORIGINS="capacitor://localhost,null" \
  APP_URL=http://127.0.0.1:3493 AUTH_URL=http://127.0.0.1:3493
npx prisma migrate deploy
npx next dev -p 3493 -H 127.0.0.1 &

SPIKE_493_SERVER=http://127.0.0.1:3493 SPIKE_493_BACKUP_DIR=$S/device-backups \
  npx playwright test -c playwright.standalone.config.ts -g "SPIKE #493"
```

(`null` is the Origin a `file://` page sends; the real shell sends `capacitor://localhost`.)

The test: creates the admin through `/setup`, mints two device tokens, makes a real encrypted
backup in the shell (real `app.js` + `backup-format.js`, mocked Capacitor plugins), uploads it
over cross-origin `fetch`, lists it, downloads it from Node and checks the SHA-256 matches the
phone's copy and the single generated-name file on disk, decrypts it with the password (and fails
with a wrong one), restores it in the shell through `restoreStandaloneBackup`, then checks: 401
without/with a bad token, another device's token sees an empty list and 404 on the id, a
`..%2F..` id is 404, non-backup bodies are 400, a 1.1 MB body is 413 both with Content-Length and
streamed without one (and leaves no file), retention 3 prunes rows and files together, and a
revoked token gets 401. Result: 1 passed. The rest of the standalone suite still passes (123).

Large blob (dev server restarted with `DEVICE_BACKUP_MAX_BYTES=314572800`, token inserted straight
into the scratch DB):

```text
$ node spike-493/large-roundtrip.mjs http://127.0.0.1:3493 <token> 150
backup: 203 lines, 266.7 MB on the wire
upload: … 279645437 bytes in 902 ms
download: 279645437 bytes in 962 ms
byte-identical: yes
decrypt: 202 records, document (157286400 bytes) identical: yes
```

150 MB of document bytes is 267 MB of `.hearthbackup` (base64 inside the JSON record, then
base64 of the ciphertext: about 1.78x). A body that size only arrives whole because the route is
outside `src/proxy.ts`'s matcher; inside it, `proxyClientMaxBodySize` (20 MB) would cut it off.

## Known prototype shortcuts

- The shell hook reads the whole backup into memory (`Filesystem.readFile`) before uploading.
- The token is kept in Preferences, not the Keychain/Keystore.
- No Settings UI, no audit log rows, no per-user cap across devices, no chunked/resumable upload.
- `server-backup.js` is not in `scripts/verify-mobile-packages.mjs`'s asset list.
- Not tried on a device, behind a reverse proxy, or with the mTLS client certificate.
