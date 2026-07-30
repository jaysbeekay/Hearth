-- INSURANCE and REGISTRATION are being removed as vehicle item types (now
-- tracked via linked Contracts instead). Recode existing rows to OTHER
-- rather than orphaning them, preserving the original type in notes so the
-- record isn't silently relabeled without a trace.
UPDATE "vehicle_items"
SET "notes" = '[Insurance] ' || COALESCE("notes", ''),
    "type" = 'OTHER'
WHERE "type" = 'INSURANCE';

UPDATE "vehicle_items"
SET "notes" = '[Registration] ' || COALESCE("notes", ''),
    "type" = 'OTHER'
WHERE "type" = 'REGISTRATION';