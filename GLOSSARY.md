# Hearth

A household's record of what it owns, what it has signed up for, and what is coming due. Everything here belongs to the household as a whole, not to an individual member.

## Language

**Household**:
The group of people sharing one Hearth, who all see and edit the same records.
_Avoid_: Account, family, team

### Things the household owns

**Item**:
Something the household owns, such as a fridge, a laptop or a bike.
_Avoid_: Product, purchase, possession, inventory item

**Warranty**:
The coverage an Item has against faults, with an end date, either included with the purchase or bought once as an extension. A Warranty always belongs to an Item. Cover billed on a recurring basis is a Contract that Covers the Item instead.
_Avoid_: Product, guarantee

**Lapsed**:
The state of a Warranty whose end date has passed. The Item itself is unaffected, and a Lapsed Warranty is never Due.
_Avoid_: Expired (for Warranties)

**Archived**:
The state of an Item, Vehicle or Property the household no longer has, because it was sold, given away, thrown out, or its lease ended. It is always set deliberately, never by a date passing, and its history is kept.
_Avoid_: Expired (for things owned), deleted

**Property**:
A building or dwelling the household owns, rents or lets out, whether or not the household lives there.
_Avoid_: Home, house

**Vehicle**:
A car, motorbike or other registered vehicle the household owns.

**Service record**:
A record of work done or money spent on a Vehicle, such as a service, repair, roadworthy or modification.
_Avoid_: Vehicle item

**Maintenance record**:
A record of work done or money spent on a Property, such as maintenance, an improvement or a repair.
_Avoid_: Home item, property item

### Agreements

**Contract**:
An ongoing agreement with a provider that has a term or a recurring cost, such as insurance, a phone plan, a lease or a loan.
_Avoid_: Policy (as a record type), bill, subscription (as a record type), agreement

**Term**:
One period of a Contract, with its own start date, end date and cost. Renewing a Contract adds its next Term; earlier Terms are kept as history. The Contract's end date is its current Term's end date.
_Avoid_: Period, cycle

**Notice deadline**:
The last day to tell the provider you won't renew: the end date minus the notice period. Fixed-term Contracts have no notice deadline.
_Avoid_: Cancel-by date

**Expired**:
The state of a manual-renewal Contract whose end date has passed without being renewed or Cancelled. It stays Due until someone does one or the other. An auto-renewing Contract never expires; it carries on into its next Term, which someone adds once the new end date is known.
_Avoid_: Lapsed (for Contracts), overdue (for Contracts)

**Ended**:
The state of a fixed-term Contract whose end date has passed. It was meant to end, so it is not Due.
_Avoid_: Expired (for fixed-term Contracts)

**Cancelled**:
The state of a Contract that someone deliberately ended.

**Category**:
The kind of Contract, such as car insurance, registration, utility or subscription. "Policy" is fine in everyday speech for an insurance-category Contract, but it is not a separate kind of record. There is no warranty Category: that is a Warranty on an Item.

**Linked to**:
The general relationship between a Contract or Item and the Vehicle or Property it relates to, such as a phone plan for a Property or a fridge that lives there. Linking alone derives nothing.
_Avoid_: Attached to, belongs to

**Covers**:
The narrower case of Linked to where the Contract's end date is the linked Vehicle, Property or Item's expiry, as with insurance, registration or recurring-billed device cover. The covered thing shows that end date and has no expiry or Reminders of its own.

**Tenancy**:
A Property the household lets out to a tenant, with its rent, bond and lease dates. It is income, not a Contract: rent the household pays is a Contract with Category Rental instead.
_Avoid_: Rental agreement, lease

**Rental statement**:
A periodic statement from a property manager of rent received and fees deducted for a Property under a Tenancy.

### Travel and wealth

**Trip**:
A journey the household plans or takes, made of segments such as flights and stays.
_Avoid_: Travel (as a record name)

**Trip segment**:
One flight, stay or other leg of a Trip.
_Avoid_: Leg, booking (as a record name)

**Portfolio**:
A set of investment Holdings tracked together.

**Holding**:
An amount of one asset within a Portfolio.

**Trade**:
A buy or sell of a Holding. Cost basis is worked out from Trades, not stored.

### Documents

**Document**:
A file attached to a Contract, an Item, or one of a record's entries: a Service record, Maintenance record, Trip segment, Rental statement or Trade. Every Document behaves the same way wherever it is attached: it can be starred, replaced by a newer version, and moved to Trash.
_Avoid_: Attachment, file

**Inbox**:
The holding area for Documents that arrived (by upload, camera or email) before anyone said what they belong to. A Document leaves the Inbox when it is attached. Being in the Inbox is a location, not a type of Document.
_Avoid_: Unlinked documents, queue

**Needs review**:
The state of a record that was filled in automatically, from email or the Inbox, with no person present, and that nobody has saved since. Saving a record is confirmation.
_Avoid_: Pending, unconfirmed

### Views

**Reminder**:
A message sent ahead of a Due entry's date, by email, push or webhook. Reminders stop once the date has passed; anything Overdue stays in Needs attention instead. If several Reminder thresholds are crossed at once, one catch-up Reminder goes out, not one per threshold.
_Avoid_: Alert, notification (as the domain term)

**Reminder threshold**:
How many days before a Due entry's date a Reminder goes out. Each record can set its own list, otherwise the household default applies. Moving the date resets which thresholds count as sent.
_Avoid_: Reminder days, alert offset

**Needs attention**:
The household's queue of things to act on, split into Due and Housekeeping.
_Avoid_: Alerts, tasks, to-do

**Due**:
A Needs attention entry whose date is within its due-soon window or has passed and still needs action. Only Contracts (the notice deadline, then the end date unless the Contract auto-renews), Warranties, a Vehicle's rego, insurance and service dates, and a Tenancy's lease end before it passes can be Due; Cancelled Contracts, Ended Contracts and Lapsed Warranties never are. Days are counted in the household's day, not any one person's.

**Due entry**:
One dated obligation of a record: a Contract's notice deadline or end date, a Warranty's end date, one of a Vehicle's rego, insurance or service dates, or a Tenancy's lease end. A record has one Due entry per such date, each with its own state.

**Due-soon window**:
How far ahead of its date a record becomes Due: its largest Reminder threshold, so a record enters Needs attention when its first Reminder goes out.
_Avoid_: Expiring soon (as a fixed 30 days)

**Overdue**:
A Due entry whose date has passed, such as an Expired Contract or a Vehicle's rego that has run out.

**Housekeeping**:
A Needs attention entry about a record that needs tidying rather than a date, such as missing details, a Document waiting in the Inbox, a record that Needs review, an auto-renewing Contract past its end date that needs its new end date, or a Tenancy past its lease end that needs its new lease end.

**Missing key details**:
A Housekeeping entry for a record lacking something it needs to be useful: a Contract with no end date (unless it auto-renews) or a cost with no billing frequency; an Item with neither serial nor barcode, or with a Warranty that has no end date; a Vehicle with neither VIN nor plate. Cancelled Contracts and Archived records are never missing anything. Having no Reminder threshold or not being Linked to anything is not missing.
_Avoid_: Incomplete, missing info, missing identifier

**Upcoming**:
The household's timeline of dated things across all records, including Trips, which are never Due. Cancelled Contracts don't appear.
_Avoid_: Calendar

**Spending**:
What the household's Contracts cost, totalled and broken down by Category.
_Avoid_: Spend
