# Item migration stage (#380)

The Product and InventoryItem routes remain canonical while the Item tables are
staged. The hidden Item preview reads staged rows and sends Item form edits
through the existing InventoryItem transaction, which mirrors them back to the
stage. It does not replace the existing routes.

On a stopped installation, copy both the SQLite database and uploads tree to
scratch paths. Copy the database's `-wal` and `-shm` sidecar files with it if
they exist (`SQLITE_JOURNAL_MODE=WAL` keeps recent writes there until a
checkpoint), or take the copy with SQLite's own backup instead, for example
`sqlite3 /path/to/app.db ".backup /absolute/copy.db"`. A copy of `app.db`
alone can be missing data. Run these commands against the copies,
substituting absolute paths:

Use the inline `DATABASE_URL=...` prefix for `prisma migrate deploy` only;
don't `export` it. The backfills treat whatever this shell's `DATABASE_URL`
and `UPLOADS_DIR` point at as live, so an exported copy path is refused. If
the shell does point at the copy, either unset both variables or set
`ITEM_STAGE_COPY=yes-this-is-a-scratch-copy`. That token only covers the
shell's own variables and never unlocks `./data/...` or `/app/data/...`.

```sh
DATABASE_URL=file:/absolute/copy.db npx prisma migrate deploy
node --import tsx scripts/backfill-items.ts /absolute/copy.db
node --import tsx scripts/backfill-item-documents.ts /absolute/copy.db /absolute/uploads-copy
node --import tsx scripts/verify-item-stage.ts /absolute/copy.db /absolute/uploads-copy
```

The backfills are rerunnable and retain all legacy rows and files. Once the
copy passes, take a fresh backup and repeat the sequence during a maintenance
window against the primary database and uploads tree. Run the verifier again
before enabling `ITEMS_PREVIEW=1`. Keep the primary paths absolute and verify
them before running the backfills, because these scripts write their target.

The two backfills refuse a path that is, or is inside, the live install's
database or uploads directory (this shell's `DATABASE_URL`/`UPLOADS_DIR`, and
the default `./data/app.db`, `./data/uploads` and `/app/data/...`). For the
primary run only, after taking the fresh backup, set
`ITEM_STAGE_PRIMARY=yes-i-have-a-fresh-backup`. To roll back, stop the app and
restore that backup (database file and uploads tree together); the legacy
tables and files are never modified by the backfills, so the staged tables can
also simply be left unused.

The verifier
exits nonzero when links, Warranty ownership, Document metadata/version links,
or copied file bytes differ. It is read-only. Review the `mergeConflictFields`
of staged Items before a public cutover. Re-run the verifier on a new, recent
copy after correcting any source or staging issues.

The runtime `itemCutoverReadiness` gate also checks relational ownership before
serving the hidden preview. It does not compare uploaded file bytes; the copy
verifier must pass before enabling the preview. This stage does not authorize a
public route or navigation cutover.

## Cutover gate: Document mirrors

Staged Document mirrors (`mirrorStagedDocument`) are best-effort, and so are
the staged file copies made when an InventoryItem moves between Items: those
are queued during the legacy transaction and copied after it commits
(`src/lib/items/stagedFileMoves.ts`), so a missing staged file or a full disk
never rolls back a legacy edit. They run
after the legacy Document write and only log on failure, and the runtime
readiness gate does not compare Document metadata, bytes or search-index
freshness. So a failed mirror can leave the stage stale without anything
noticing. This staging PR deliberately leaves it that way, because nothing
public reads the stage.

The public cutover PR must not ship unless all of these hold:

1. With the app stopped, the full sequence above (migrate, both backfills,
   `verify-item-stage.ts`) passes against a frozen snapshot of the primary
   database and uploads tree, taken immediately before the cutover deploy.
   A nonzero verifier exit blocks the deploy.
2. The cutover PR includes tests that inject a failing Document mirror and
   show that the verifier detects the divergence and that a backfill rerun
   repairs it.
3. The rollback backup from the maintenance-window run is kept until the
   cutover is confirmed.

The injected-failure tests in (2) must cover these known divergence paths,
which a row count can't see:

- a staged Document whose predecessor's mirror is missing loses its
  `supersedesId` link (`syncLegacyDocument.ts`), so the verifier must check
  version chains, not only counts;
- `purgeProduct`'s staged cleanup is logged, not retried, after the legacy
  delete (`commands/products.ts`);
- a queued file copy that fails after commit (`stagedFileMoves.ts`).

`itemCutoverReadiness` loads every row of the eight tables on each preview
request. That's acceptable behind `ITEMS_PREVIEW=1`, but the cutover must not
run it on public reads: replace it with targeted checks or a cached result.
