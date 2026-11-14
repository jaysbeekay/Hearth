# Housekeeping rules narrow roughly in the database and decide in memory

ADR 0002 settled this for Due: the database only narrows the candidates, and the Due policy decides. Housekeeping was left as it was. Each Housekeeping rule in `src/lib/recordFilters.ts` (Missing key details, Needs review, no Document, important) carries both an exact Prisma `where` and an in-memory `matches` check, and the two must agree. The standalone phone app holds a third copy. Missing key details is where they drift: its `where` restates `contractMissingParts`, `productMissingParts`, `vehicleMissingParts` and `itemMissingParts` as `OR` clauses, so a change to what counts as missing has to be made twice in `src` and once more in the phone app, with nothing failing if one is missed. We decided to apply ADR 0002's reasoning to Housekeeping. A rule keeps an exact `where` only when it is one condition that the database states the same way as the check: a column flag (Needs review) or whether a live related row exists (no Document, important). Any rule that combines several fields, or mirrors a `*MissingParts` helper, gets a rough `where` that only narrows, and `matches` decides.

## Considered Options

- **Keep exact `where` clauses for every rule** (the status quo). Rejected: this is the duplication ADR 0002 rejected for Due. Missing key details already has four pairs that must be kept in step by hand.
- **Make every rule rough, including the one-condition ones.** Rejected: a column flag or a related-row check can't disagree with its check, and keeping it exact keeps those filters cheap and lets Search keep its row limit for them.
- **Store a computed "missing details" column, refreshed on write.** Rejected for the same reasons as ADR 0002's `dueAt` column: every writer must remember to update it, and the rule lives in two places again.

## Consequences

- Lists, Search and the dashboard apply `matches` after the rough query for multi-field rules. That is deliberate. Don't "optimise" it back into an exact `where`.
- Search can't apply its row limit (`take`) before a rough filter, so it drops `take` when such a filter is active, as it already does for Due. A household's data is small enough that this is cheap.
- What counts as Missing key details is pinned by a shared test-case file that both the vitest suite and the standalone app's tests run, in the same way as the Due cases (ADR 0002). Any change to the rule changes that file, and both sides must pass it.
- A new Housekeeping rule starts rough unless it is a single condition the database states exactly.
