# ADR 0001: Dual-mode mobile app architecture

Status: Accepted for implementation planning

Date: 2026-07-31

## Context

Hearth currently serves one self-hosted household through a Next.js server and uses
Capacitor as a thin WebView wrapper pointed at that server. The target product
direction is one iOS and Google Play app binary that can run in two modes:

- Standalone: all household data stays on one device, with no server, household
  sharing, sync, or remote access.
- Connected: the app connects to a user-managed Hearth server, preserving the
  current household-wide sharing model.

The current server includes Node-only and server-only capabilities: Next.js
server rendering, Prisma, SMTP, ntfy, cron, backups, MCP, OAuth/passkeys, AI
provider integrations, barcode lookup, document extraction, and file storage.
Embedding that server inside the mobile app would make the app fragile, hard to
ship through app stores, and mismatched with iOS and Android background/runtime
constraints.

This ADR is linked to
[jaysbeekay/Hearth#150](https://github.com/jaysbeekay/Hearth/pull/150), which
explored the embedded-Node standalone path. That PR remains useful as spike
evidence, but this ADR supersedes it as the implementation direction.

## Decision

Build a single app binary with a bundled mobile UI and a runtime-selected data
provider:

- `standalone` provider: native local database and native protected file storage.
- `connected` provider: authenticated HTTPS API against the self-hosted server.

Do not embed Node.js, Next.js, Prisma, or the self-hosted server inside the
mobile app. The server remains the connected-mode authority. Standalone mode has
its own local authority and does not silently sync or merge with a server later.

The existing remote WebView path may remain as a migration and compatibility
path while the bundled mobile UI is built, but it is not the target architecture
for standalone mode.

## Consequences

- Shared validation, DTOs, capability definitions, and domain rules must be
  separated from server-only infrastructure.
- Mobile persistence must not depend on Prisma or Next server actions.
- Mode selection becomes a first-run and settings concern, not a build-time
  fork.
- Features that require a server must be explicitly unavailable or replaced with
  local equivalents in standalone mode.
- Connected offline support, if built, is a best-effort enhancement to connected
  mode rather than the foundation of standalone mode.

## Non-negotiables

- One app listing for iOS and one app listing for Google Play.
- One app binary per platform, with runtime mode selection.
- No background server process on device.
- No sharing in standalone mode.
- Household-wide visibility remains intentional in connected mode.
- No silent migration from standalone to connected. Moving data between modes
  requires explicit export/import with user review.

## Alternatives considered

Embedding the existing Next.js server in the app was rejected because it couples
mobile viability to Node runtime compatibility, native module support, local HTTP
server lifecycle, app-store review risk, and OS background limits.

Keeping only the remote WebView was rejected as the target because it cannot run
standalone without a server and does not provide a durable local system of
record.

Forking separate standalone and connected apps was rejected because it doubles
release, QA, support, and app-store operational burden.
