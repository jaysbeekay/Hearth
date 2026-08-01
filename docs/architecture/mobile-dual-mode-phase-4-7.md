# Mobile dual-mode implementation: Phase 4 to Phase 7

Date: 2026-07-31

GitHub linkage:

- Parent implementation discussion:
  [jaysbeekay/Hearth#150](https://github.com/jaysbeekay/Hearth/pull/150)
- Superseding architecture decision:
  [ADR 0001](./adr-0001-dual-mode-mobile.md)
- Earlier implementation:
  [Phase 0/1](./mobile-dual-mode-phase-0-1.md) and
  [Phase 2/3](./mobile-dual-mode-phase-2-3.md)

## Phase 4: connected mobile API

Implemented first-slice endpoints under `/api/mobile/v1`:

- `GET /compatibility`
- `GET/PATCH /modules`
- `GET /dashboard`
- `GET/POST /contracts`
- `GET/PUT/DELETE /contracts/:id`
- `GET/POST /products`
- `GET/PUT/DELETE /products/:id`
- `GET/POST /vehicles`
- `GET/PUT/DELETE /vehicles/:id`
- `GET/POST /vehicles/:id/items`
- `PUT/DELETE /vehicles/:id/items/:itemId`
- `GET/POST /documents`
- `GET/DELETE /documents/:id`

The API preserves the connected household model: authenticated members can read
household data, `READONLY` users cannot write, module toggles are admin-only,
and Vehicles endpoints respect the Vehicles module toggle.

## Phase 5: connected repository integration

Implemented in `src/lib/mobile/connectedRepositories.ts` and selected through
`src/lib/mobile/repositoryProvider.ts`.

The app now has two repository providers behind one interface:

- `standalone`: native local repository set from
  `nativeStandaloneRepositories` on iOS/Android, with the IndexedDB repository
  retained only as a browser development fallback.
- `connected`: HTTP repository set from `createConnectedRepositories`.

Screen code should call `getMobileRepositories(mode, connectedBaseUrl)` and
avoid direct server actions, Prisma calls, or storage decisions.

## Phase 6: connected offline outbox

Implemented a mobile outbox utility in `src/lib/mobile/connectedOutbox.ts`.

It supports queued connected mutations for:

- Contracts
- Products
- Vehicles
- Vehicle items
- Documents

The outbox stores queued mutations locally, marks sync progress, and drains them
through the selected connected repositories. It is separate from standalone
storage: standalone remains a local system of record, while the connected outbox
is only a retry buffer for the server-backed mode.

## Phase 7: release hardening

Before app-store submission, complete this checklist:

- Confirm first-launch mode selection cannot accidentally merge standalone and
  connected data.
- Confirm connected compatibility works before login and authenticated endpoints
  reject unauthenticated requests.
- Confirm `READONLY` users cannot write through `/api/mobile/v1`.
- Confirm module-disabled Vehicles API calls return a clear error.
- Run local CRUD tests for standalone repositories.
- Run API route tests for connected repositories.
- Exercise document upload rejection for unsupported, mislabeled, too-large, and
  empty files.
- Force-close and reopen the app after standalone record and attachment writes.
- Validate connected mode against an HTTPS self-hosted server with and without
  mTLS configured.
- Validate iOS and Android app restore/backup behavior for local standalone
  data.
- Confirm native SQLite and protected file storage behavior on physical iOS and
  Android devices before declaring standalone storage production-grade.

## Remaining app integration

The data/provider architecture and first bundled mobile UI are now implemented
for the first slice. The remaining product work is deeper standalone screen
coverage, automated native persistence tests, physical-device QA, export/restore
hardening, and app-store release checks.
