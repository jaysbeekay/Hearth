# Saving a scanned record counts as reviewing it

When a document scan fills in a record's fields, the record is marked Needs review and its Reminders are held until a person has looked at it. Before #359 that look was a separate checkbox, which people skipped, so records sat in Needs review with no Reminders. We decided that saving is the review. On a Contract or Warranty form, pressing Save on the filled-in fields confirms the record, and "Save for later review" is the explicit opt-out. Rows saved from Upload or the Inbox count as reviewed if the person changed something, or if the scan read them confidently (a text or AI scan that filled at least two fields). An untouched, weakly read row is left as Needs review and shows up in Quick check. Email-ingested documents never go through this path, because nobody looked at them.

## Considered Options

- **Always require a person to confirm an untouched row.** Rejected: on Upload and the Inbox the fields are on screen when the person presses Save, so a second confirmation mostly adds clicks. It would also push confident scans into Quick check, which hides the ones that actually need a look.
- **Keep the separate "I've reviewed this" checkbox.** Rejected: it was skipped often enough that Reminders were held on records nobody intended to leave unchecked.

## Consequences

- The two-field threshold is a heuristic, not proof that someone read every field. Accepted for now. If a wrong auto-filled date causes a missed or wrong Reminder in practice, revisit this decision, not the threshold alone.
- On the forms, "Save for later review" must stay after Save in the markup. A browser submits with the first submit button when Enter is pressed, and a later button keeps Enter from quietly saving for later.
- `extractionReviewedOnSave` (`src/lib/documents/extractionConfirmation.ts`) is the single rule for Upload and the Inbox. Don't add another per-screen threshold.
