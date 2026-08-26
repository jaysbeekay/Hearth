# Architecture and robustness programme

This note records the implementation boundary for issues [#253](https://github.com/jaysbeekay/Hearth/issues/253), [#254](https://github.com/jaysbeekay/Hearth/issues/254), and [#255](https://github.com/jaysbeekay/Hearth/issues/255).

## Delivered

- Contract and Product writes are transport-neutral commands shared by server actions, assistant flows, imports, and offline sync.
- OCR extraction and market-price work have bounded concurrency.
- Scheduled price refresh is persisted as a database-backed background job with leases, retries, and terminal status, and `/api/cron` drains queued jobs.

## Follow-up job types

OCR/document extraction and large CSV/PDF exports should be added as `BackgroundJob` types once their storage/status response contracts are finalized. The queue already provides the single-owner lease and retry boundary required by #250; adding those handlers will remove the remaining request-critical work without changing routes.

Issue #255 remains tracking/sequencing documentation; this file is the repository-side record of what has landed and what is intentionally deferred.
