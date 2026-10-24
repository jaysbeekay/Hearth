# Every write goes through its record's command; the Reminder log is keyed by date

Each record type used to be written from several places: server actions, the offline sync handler, extraction review, import and the Assistant. Only Contracts and Products had a shared command, and everything else was written once in the action and again in `api/sync/entityHandlers.ts`, kept in step by hand. Clearing the sent-Reminder log when a date moved was each writer's job, and four writers forgot: Vehicle updates in both paths, extraction review, and Contract notice-period and renewal-type changes. Renewed rego never got Reminders again (#382). We decided two things. First, every record type has a command that owns the module gate, the write, file cleanup, soft delete, restore and permanent delete, and revalidation. Actions, sync, import, extraction review and the Assistant all call it, and none of them touches Prisma for that record. Second, each sent-log row stores the Due entry date it was sent for, and the Reminder schedule only counts rows that match the entry's current date. Moving a date therefore resets its Reminders without any writer doing anything.

## Considered Options

- **Keep resets, but make every command do them.** Rejected: the next new writer or new dated field brings the bug back, and the reset rule ("which fields matter") would leak out of the Reminder schedule into every command.
- **Leave sync with its own copy of the write logic.** Rejected: that duplication is how the Vehicle reset was missed in both paths.

## Consequences

- Commands take validated input and the actor. Signing in, role checks and Zod parsing stay with the caller. Don't inline a command back into sync or an action "for speed".
- Don't add `clearNotificationLogs` calls when a date changes. It's only used on permanent delete. Old log rows for an earlier date stay as history.
- The migration stamps existing rows with the record's current date only if they were sent within that threshold's window, so the upgrade sends nothing new and #382's stuck Vehicles start working again.
- Commands are tested in vitest against a temporary SQLite database. The Reminder schedule is a pure function and needs no database.
