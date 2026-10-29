# Item migration stage (#380)

The Product and InventoryItem routes remain canonical while the Item tables are
staged. The preview is read-only and does not replace the existing routes.

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

The verifier
exits nonzero when links, Warranty ownership, Document metadata/version links,
or copied file bytes differ. It is read-only. Review the `mergeConflictFields`
of staged Items before a public cutover. Re-run the verifier on a new, recent
copy after correcting any source or staging issues.

The runtime `itemCutoverReadiness` gate also checks relational ownership before
serving the hidden preview. It does not compare uploaded file bytes; the copy
verifier must pass before enabling the preview. This stage does not authorize a
public route or navigation cutover.
