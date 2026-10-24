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
The state of a Warranty whose end date has passed. The Item itself is unaffected.

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
The state of a manual-renewal or fixed-term Contract whose end date has passed without being renewed. An auto-renewing Contract never expires; it rolls into its next Term.
_Avoid_: Lapsed (for Contracts), ended

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

**Portfolio**:
A set of investment Holdings tracked together.

**Holding**:
An amount of one asset within a Portfolio.

**Trade**:
A buy or sell of a Holding. Cost basis is worked out from Trades, not stored.

### Documents

**Document**:
A file attached to a Contract, Item, Vehicle, Property or Trip.
_Avoid_: Attachment, file

**Inbox**:
The holding area for Documents that arrived (by upload, camera or email) before anyone said what they belong to. A Document leaves the Inbox when it is attached. Being in the Inbox is a location, not a type of Document.
_Avoid_: Unlinked documents, queue

**Needs review**:
The state of a record that was filled in automatically, from email or the Inbox, with no person present, and that nobody has saved since. Saving a record is confirmation.
_Avoid_: Pending, unconfirmed

### Views

**Reminder**:
A message sent ahead of something Due, by email, push or webhook.
_Avoid_: Alert, notification (as the domain term)

**Needs attention**:
The household's queue of things to act on, split into Due and Housekeeping.
_Avoid_: Alerts, tasks, to-do

**Due**:
A Needs attention entry with a date that is coming up or has passed, such as a notice deadline, an end date or a service.

**Housekeeping**:
A Needs attention entry about a record that needs tidying rather than a date, such as missing details, a Document waiting in the Inbox, or a record that Needs review.

**Upcoming**:
The household's timeline of what is coming due across all records.
_Avoid_: Calendar

**Spending**:
What the household's Contracts cost, totalled and broken down by Category.
_Avoid_: Spend
