-- Auto-fill confirmations move from the record page to the admin-only
-- Security log (AUTOFILL_CONFIRMED). Copy the confirmations already saved
-- into the log, so none of them disappears with the record-page line. Who
-- confirmed is the reviewer of the record's auto-filled fields, when one was
-- recorded; the log shows no one otherwise rather than guessing.
INSERT INTO "security_event_logs" ("id", "type", "userId", "email", "detail", "createdAt")
SELECT
    'c' || lower(hex(randomblob(12))),
    'AUTOFILL_CONFIRMED',
    r."reviewedById",
    u."email",
    'Contract "' || c."title" || '" · confirmed before this log',
    c."extractionConfirmedAt"
FROM "contracts" c
LEFT JOIN (
    SELECT "contractId", max("reviewedById") AS "reviewedById"
    FROM "extraction_review_fields"
    WHERE "contractId" IS NOT NULL AND "reviewedById" IS NOT NULL
    GROUP BY "contractId"
) r ON r."contractId" = c."id"
LEFT JOIN "users" u ON u."id" = r."reviewedById"
WHERE c."extractionConfirmedAt" IS NOT NULL;

INSERT INTO "security_event_logs" ("id", "type", "userId", "email", "detail", "createdAt")
SELECT
    'c' || lower(hex(randomblob(12))),
    'AUTOFILL_CONFIRMED',
    r."reviewedById",
    u."email",
    'Warranty "' || p."description" || '" · confirmed before this log',
    p."extractionConfirmedAt"
FROM "products" p
LEFT JOIN (
    SELECT "productId", max("reviewedById") AS "reviewedById"
    FROM "extraction_review_fields"
    WHERE "productId" IS NOT NULL AND "reviewedById" IS NOT NULL
    GROUP BY "productId"
) r ON r."productId" = p."id"
LEFT JOIN "users" u ON u."id" = r."reviewedById"
WHERE p."extractionConfirmedAt" IS NOT NULL;
