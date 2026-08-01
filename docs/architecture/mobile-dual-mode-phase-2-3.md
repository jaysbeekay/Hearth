# Mobile dual-mode implementation: Phase 2 and Phase 3

Date: 2026-07-31

GitHub linkage:

- Parent implementation discussion:
  [jaysbeekay/Hearth#150](https://github.com/jaysbeekay/Hearth/pull/150)
- Superseding architecture decision:
  [ADR 0001](./adr-0001-dual-mode-mobile.md)
- Phase 0/1 groundwork:
  [mobile-dual-mode-phase-0-1.md](./mobile-dual-mode-phase-0-1.md)

## Phase 2: shared DTOs and repository contracts

Phase 2 turns the architectural boundary into code. Mobile screens should not
know whether data came from local SQLite, an HTTPS API, IndexedDB, Prisma, or a
server action. They should depend on DTOs and repository interfaces.

Deliverables started in this phase:

- `src/lib/mobile/dtos.ts`
- `src/lib/mobile/repositories.ts`
- `src/lib/mobile/standaloneSchema.ts`
- `src/lib/mobile/repositoryProvider.ts`

The first repository set covers:

- Contracts
- Products
- Documents
- Module settings
- Dashboard summary
- Vehicles and vehicle items as the first optional-module slice

Phase 2 rules:

- DTOs use JSON-safe values. Dates are ISO strings or `null`.
- Repository interfaces are mode-neutral.
- Connected implementations will call `/api/mobile/v1/*`.
- Standalone implementations will call the local database and native file store.
- Prisma models remain server-private and are not exported as mobile contracts.
- Attachments are represented as metadata plus a storage key, not raw bytes in
  JSON DTOs.

Phase 2 exit criteria:

- The first DTOs and repository interfaces compile.
- The first standalone schema can be reviewed against the Prisma schema.
- Developers can build a screen against a repository without choosing connected
  or standalone storage inside the screen.

## Phase 3: standalone vertical slices

Phase 3 proves standalone mode with real local CRUD and attachment lifecycle.
The first vertical slices should be implemented in this order:

1. Runtime mode bootstrap and local profile.
2. Module settings.
3. Contracts with document attachments.
4. Products with invoice/photo attachments.
5. Dashboard summary.
6. Vehicles and vehicle items with attachments.

Implementation status:

- Runtime mode persistence and local standalone profile are implemented in
  `src/lib/mobile/runtime.ts`.
- The production native standalone repository implementation is available from
  `src/lib/mobile/nativeStandaloneRepositories.ts`, backed by native SQLite and
  protected file storage.
- The IndexedDB implementation in `src/lib/mobile/standaloneRepositories.ts`
  remains as a browser/WebView development fallback only.
- `src/lib/mobile/repositoryProvider.ts` selects the standalone repository set
  when the stored runtime mode is `standalone`, preferring the native driver on
  iOS and Android.
- The Capacitor shell in `ios-shell/www` now includes the first-launch mode
  choice and first standalone screens for Contracts, Products, Vehicles,
  dashboard counts, and attachments.

Standalone repository behavior:

- Generate IDs on device.
- Wrap record and attachment writes in transactions where possible.
- Store local record versions as monotonically increasing integers.
- Soft-delete first if an attachment or parent delete has file-system risk.
- Never call server actions, Prisma, NextAuth, or `/api/sync`.
- Use local notifications only for reminder behavior.

Standalone attachment behavior:

- Copy incoming files into protected app storage before committing metadata.
- Store metadata in the local DB only after the file copy succeeds.
- Delete or quarantine orphaned files during startup repair.
- Preserve original filename, MIME type, size, owner type, owner ID, and document
  kind.

Phase 3 exit criteria:

- Repository layer can initialise standalone mode and create local data with no
  server configured.
- Contracts and Products support create, read, update, delete, and attachments
  through the standalone repositories.
- Module toggles persist locally without deleting data.
- Dashboard counts and expiry summaries are computed locally.
- Vehicles and vehicle items prove optional-module repository reuse.
- Native iOS/Android persistence survives reloads through SQLite and protected
  app file storage.

Remaining Phase 3 follow-up work:

- Expand the bundled standalone UI beyond the first vertical slices.
- Add automated device-level persistence tests for cold launch and app restore.
