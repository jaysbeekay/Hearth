# The Due policy is the single source of Due rules; the database only filters roughly

Whether a record is Due, how many days it has left and what its badge says used to be worked out separately in each place that showed it: the contract and warranty lists, the dashboard and Needs attention, Search, Upcoming and iCal, the detail banners, the MCP server and the Assistant, and the Reminder scheduler. Each had its own `where` clause or `daysUntil` call, so they disagreed. For example, Search's own end-date range ignored notice deadlines, and every list called a passed date "Expired" whatever the renewal type. We decided that one in-memory module, the Due policy, takes any record and returns its Due entries (field, date, days left and state). Every caller asks it. A database query only narrows the candidates roughly (for example, "has an end date before today plus the largest possible window") and never decides Due on its own. "Today" is passed in explicitly and counted in the household's timezone.

## Considered Options

- **Exact `where` clauses per caller** (the status quo, tidied up). Rejected: notice deadlines, renewal type, per-record due-soon windows and the household timezone don't translate cleanly into SQL, and every caller ends up keeping its own copy of the rules.
- **Store a computed `dueAt` / state column, refreshed by a job.** Rejected: it goes stale between runs and when the timezone setting changes, and it adds a write path that every edit must remember to update.

## Consequences

- Lists, Search and the dashboard filter in memory after a rough query. That is deliberate. Don't "optimise" it back into exact SQL, which brings the disagreements back. A household's data is small enough that this is cheap.
- The standalone mobile app (`ios-shell/www/app.js`) can't import `src/`, so it keeps a hand-ported copy of the rules. It stays in step through a shared JSON file of test cases that both the vitest suite and the standalone tests run. Any change to a Due rule changes that file, and both sides must pass it.
- State labels (Lapsed, Expired, Ended, Overdue and so on) come from the same module. Display code such as `ExpiryBadge` only renders them.
