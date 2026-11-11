# Serverless hosting (Vercel and similar)

Hearth runs as one long-lived Node process with a persistent disk: the Docker
image, PikaPods, or a Render web service with a disk. We are not reworking it
to run on scale-to-zero serverless hosts such as Vercel.

## Why this is out of scope

The #477 investigation (`docs/deployment/one-click.md`) rated Vercel a
**no-go**. Every runtime assumption Hearth makes breaks on serverless, and
fixing that means four separate projects:

- **Documents** live on local disk under `UPLOADS_DIR`. Serverless needs a
  remote object-store driver with client-side encryption, plus browser-direct
  uploads to get around the 4.5 MB request-body cap (#479).
- **The database** is a local SQLite file. Serverless needs remote libSQL
  (Turso), a different migration path, a replacement for `VACUUM INTO`
  backups, and FTS5 checks against the remote database (#482).
- **Scheduled work** runs from an in-process ticker (#481). That piece *is*
  worth doing for any external scheduler, so #481 was kept and rescoped
  without the Vercel-specific request shape.
- **OCR** shells out to `pdftotext`/`pdftoppm`/`tesseract`, which the Node.js
  function runtime doesn't have (#480 covers degrading gracefully when they're
  missing).

Taken together, this also changes the data-custody story. A household's
contracts and documents would be spread across three third-party services
instead of sitting on one volume they control. That works against Hearth's
self-hosted, one-household design, and PikaPods and Render already offer
one-click hosting without any of this.

## Prior requests

- #479: "Pluggable document storage: local disk or S3-compatible / Vercel Blob"
- #482: "Support a remote libSQL database (Turso) as an alternative to the local SQLite file"
