# A Cost review is a Due entry, derived from the Contract and not tied to its dates

An auto-renewing Contract is Due only on its notice deadline. A gym membership or streaming subscription that auto-renews, with no end date or no notice period, has no Due entry at all, so Hearth never surfaces it and the household keeps paying without being asked. We decided to add a fourth kind of Contract Due entry, the **Cost review**: a periodic "is this still needed?" decision with its own date. It is derived by the Due policy (ADR 0002) like every other Due entry, so it uses Reminders, Needs attention, Upcoming, Snooze, iCal, the MCP server and the Assistant without a parallel pipeline (#243).

A Contract has a Cost review when it is not Cancelled, auto-renews, has a cost, and has no notice deadline. A Contract with a notice deadline is already asked the same question at the right time. Category plays no part, so a membership filed under Other still qualifies. Its date is a household-wide interval (default 6 months, or Off) after the Contract's last Cost review. A Contract never reviewed counts from whichever is later: its start date (or creation date) or the day Cost reviews were switched on. That way, switching the feature on doesn't make every old Contract Overdue at once.

Two actions resolve it. **Still needed** records the review (date and who did it), which moves the next Cost review one interval on. **Cancel** goes through the existing cancel flow, and a Cancelled Contract has no Cost review. Renewing a Contract or editing its dates doesn't change its Cost review.

## Considered Options

- **A Housekeeping entry instead of a Due entry.** Rejected: Housekeeping has no date and sends no Reminders. A decision about money that comes round on a schedule is what Due is for.
- **A Reminder on an existing date (end date or renewal).** Rejected: the Contracts this is for usually have no such date.
- **Subscription Category only, or a per-Contract toggle.** Rejected: Category is often wrong for memberships, and a toggle adds a setting that people forget. Qualifying is derived from facts already on the Contract.
- **A separate "Memberships" module.** Rejected: a subscription is a Contract Category, not a record type (see `GLOSSARY.md`).
- **A "planning to cancel" state.** Rejected: Snooze already covers "not now", and Cancelled covers "done".

## Consequences

- The list of things that can be Due grows. Every Due entry consumer (lists, Search, the dashboard, Upcoming, iCal, webhooks, the MCP `whats_due` tool, the Assistant) sees a new entry kind. Webhook consumers get a new entry type, which goes in the CHANGELOG.
- The Reminder sent log is keyed by the Due entry's date (ADR 0003). Marking Still needed moves that date, so it re-arms the next Cost review's Reminders with no extra writer.
- A Contract stores when it was last reviewed and by whom. The Due policy needs that, and the household setting stores the interval and the switched-on date.
- The standalone phone app ports the same rule. Its cases go into the shared Due test-case file that both sides run (ADR 0002).
