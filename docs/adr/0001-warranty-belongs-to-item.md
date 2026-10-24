# A Warranty always belongs to an Item; Items are always on

The code has two overlapping records for things the household owns. `Product` mixes the object with its warranty, and `InventoryItem` (an opt-in module) describes the object and can point at a `Product`. The same fridge can therefore be entered twice, with its model, serial and price stored in both. We decided the domain has one concept for the thing, **Item**, and a **Warranty** is coverage an Item has, never a record on its own. Because every Warranty needs an Item, Items can't be opt-in. They're always on, under a single "Items" nav entry, and the Inventory module is retired. An Item whose warranty has run out is still an Item, not an expired warranty.

## Considered Options

- **Keep Warranty and Inventory item as separate records** (the status quo). Rejected: the duplicated details drift apart, and enabling Inventory silently adds a second section to the warranties page (#364).
- **Fold Inventory into a "Purchases" page with Warranties and Items tabs** (#364 option B). Rejected: it keeps two record types behind one page and leaves the duplication in place.

## Consequences

- `Product` and `InventoryItem` will be merged into one Item record with an optional Warranty. Until that migration, the glossary is ahead of the schema.
- Recurring-billed device cover (such as AppleCare billed monthly) is a Contract that Covers the Item, not a Warranty. The `WARRANTY` contract category is removed.
- `/inventory/*` routes redirect to the Items pages, and `INVENTORY` leaves the module registry and setup.
