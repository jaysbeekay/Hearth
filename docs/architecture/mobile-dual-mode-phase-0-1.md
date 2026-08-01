# Mobile dual-mode implementation: Phase 0 and Phase 1

Date: 2026-07-31

This document starts the implementation track for a single Hearth mobile app
that can run either standalone or connected to a self-hosted Hearth server.

GitHub linkage:

- Parent implementation discussion:
  [jaysbeekay/Hearth#150](https://github.com/jaysbeekay/Hearth/pull/150)
- Architecture decision:
  [ADR 0001](./adr-0001-dual-mode-mobile.md)

## Phase 0: product and architecture decisions

### Product mode definitions

Standalone mode means the mobile device is the complete system of record. Data
is stored locally, attachments live locally, and there is no household sharing,
remote login, server sync, MCP, server backups, webhooks, SMTP, or server cron.
The user may export a backup file, but the app does not connect to a Hearth
server.

Connected mode means the self-hosted Hearth server is the system of record. The
mobile app authenticates to that server and preserves the current household-wide
sharing model: admin/member roles gate administration, not ordinary data
visibility. Connected offline capture can be added later, but it remains a queue
for the server rather than standalone storage.

### Architecture decisions

- Ship one binary per platform with runtime mode selection.
- Replace the remote WebView target over time with a bundled mobile UI.
- Keep the existing Next.js/Prisma server as the connected-mode backend.
- Build a local repository implementation for standalone mode.
- Build an HTTP repository implementation for connected mode.
- Share contracts, validation, capability metadata, and domain logic across both
  providers.
- Keep server-only infrastructure behind explicit capability checks.
- Treat mode switching as a deliberate export/import workflow, not a background
  merge.

### User journeys to support first

- First launch: choose "Use on this device only" or "Connect to my Hearth
  server."
- Standalone setup: create local profile, choose enabled modules, set optional
  device lock/biometric protection, land on dashboard.
- Connected setup: enter server URL, validate server compatibility, sign in,
  optionally register this device, land on dashboard.
- Existing connected users: keep the remote WebView path available until the
  bundled connected screens cover the same core workflows.

### Scope boundaries

In scope for the first dual-mode release:

- Contracts and Products as always-on domains.
- Module enablement for Travel, Home, Vehicles, Inventory, and Wealth.
- Local attachments for standalone.
- Connected attachment upload/download.
- Local export/restore for standalone.
- Capability-aware UI that hides or disables unavailable features per mode.

Out of scope for the first dual-mode release:

- Multi-device sync for standalone data.
- Household sharing in standalone mode.
- Running the Next.js server on device.
- Local MCP server.
- Local SMTP, webhooks, or offsite backup jobs.
- Automatic standalone-to-connected merge.

### Key risks

- Data model drift between server Prisma schema and mobile local schema.
- Server-only assumptions leaking into shared code.
- Attachment lifecycle bugs, especially orphaned files after failed writes.
- Conflict handling if connected offline queue is added too early.
- User confusion around the difference between "offline connected" and
  "standalone."

### Phase 0 exit criteria

- The app has accepted definitions for standalone and connected modes.
- Product capability differences are documented.
- The implementation avoids embedded Node/Next/Prisma on device.
- The first release scope is limited to core data, attachments, and local
  backup/restore.
- The team agrees that connected household-wide sharing remains intentional.

## Phase 1: shared contracts and capability model

Phase 1 creates the vocabulary and boundaries developers need before building
screens or persistence. The goal is to prevent mobile code from asking "am I on
iOS?" or "is there a server?" in arbitrary places. Instead, the app should ask a
data provider and a capability registry what is available.

### Deliverables started in this phase

- `src/lib/mobile/capabilityModel.ts`: shared mode, capability, entity, and
  repository-contract definitions.
- `docs/architecture/adr-0001-dual-mode-mobile.md`: accepted architecture
  decision record.
- This Phase 0/1 handoff document.

### Provider contract shape

Every mobile screen should depend on a repository interface rather than directly
calling server actions, Prisma, IndexedDB, or native storage. The first
repository set should cover:

- `ContractsRepository`
- `ProductsRepository`
- `DocumentsRepository`
- `ModuleSettingsRepository`
- `DashboardRepository`

Later module repositories should be added in this order:

- Vehicles
- Travel
- Home
- Inventory
- Wealth

Each repository method should accept and return DTOs from the shared contract
package/module. Connected implementations call `/api/mobile/v1/*`. Standalone
implementations call the local database and native file store.

### Capability model rules

- Capabilities are mode-aware and user-visible.
- Unavailable standalone features must not appear as broken buttons.
- Server-required capabilities must declare the server feature they need.
- Optional connected capabilities must be probed from the server, not assumed.
- Standalone module toggles change local navigation and validation only; they do
  not delete local data.

### Contract rules

- DTOs must not expose Prisma models directly.
- DTOs must use stable IDs generated client-side for standalone and connected
  offline creation.
- Mutations must be idempotent once connected offline queue is introduced.
- Attachments must be represented as metadata plus file handles, not raw bytes in
  JSON payloads.
- Any field that participates in conflict detection needs a stable `version` or
  equivalent server token. `updatedAt` can be shown to users but should not be
  the long-term conflict primitive.

### Storage rules

Standalone storage:

- Native SQLite or libSQL-compatible local database.
- Native protected file storage for attachments.
- Local schema migrations owned by the mobile app.
- Encrypted local metadata where platform support allows.
- Backup-before-upgrade for destructive migrations.

Connected storage:

- Server remains authoritative.
- Server files are cached by `serverInstanceId`, account/household identity,
  document ID, and document version.
- Auth tokens live in Keychain/Keystore, not browser local storage.
- The server exposes compatibility metadata before login-sensitive work starts.

### Developer sequence

1. Wire `MobileRuntimeMode` into app bootstrap and settings.
2. Implement capability lookup and use it to drive navigation visibility.
3. Extract shared DTOs and validation for Contracts and Products first.
4. Build standalone local repositories for Contracts, Products, Documents, and
   Modules.
5. Add connected `/api/mobile/v1` endpoints for the same contracts.
6. Convert the first mobile screens to repository calls.
7. Repeat by module, starting with Vehicles.

### Phase 1 exit criteria

- Runtime mode and capability definitions compile and are importable.
- The first DTO/repository contracts are defined without depending on server
  actions or Prisma.
- UI work can start without deciding storage details inside each screen.
- Server-only features have explicit capability entries.
- Connected and standalone behavior differences are visible in one registry.
