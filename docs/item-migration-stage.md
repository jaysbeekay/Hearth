# Item migration stage (#380)

The Product and InventoryItem routes remain canonical while the Item tables are
staged. The hidden Item preview reads staged rows and sends Item form edits
through the existing InventoryItem transaction, which mirrors them back to the
stage. It does not replace the existing routes.

On a stopped installation, copy both the SQLite database and uploads tree to
scratch paths. Run these commands against the copies, substituting absolute
paths:

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
