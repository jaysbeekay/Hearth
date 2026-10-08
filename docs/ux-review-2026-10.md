# Hearth UX review (October 2026)

Method: full read of every page, form and shared component under `src/app` and
`src/components`, then a scripted walkthrough of a fresh instance (scratch SQLite DB,
`next dev`, Playwright) at 1280×900 and 390×844 covering setup, sign-in, dashboard,
contracts, warranties, import, inbox, documents, calendar, spend, settings and help.
Each finding below names the code or screen that proves it. Severity reflects how often a
household member hits it and how much it costs them when they do.

Hearth's goal, per the README and the dashboard tagline, is "what's expiring, what it
costs, and what needs attention". The recurring theme in the findings is that the product
has grown many good safeguards and views, but the primary path (capture a document, get a
reminder, act on it) is now surrounded by secondary UI that competes with it.

---

## A. Core job: capture → review → remind → act

### A1. The "Needs attention" queue, the app's most important surface, is below the fold on every device
- **Finding.** On desktop the queue starts ~780 px down; on a phone it starts after
  eleven stat cards and a warning banner (~1,300 px). What a user sees first is a
  "Documents" section with "Inbox 0 / Total documents 1".
- **Reason.** `src/app/(app)/dashboard/page.tsx` renders sections in this order: header,
  Documents stats, onboarding/contract stats, warranty stats, then Needs attention.
  The Documents section is unconditional and placed first even though inbox count is
  usually zero.
- **Fix.** Move "Needs attention" directly under the page header. Collapse the stat grid
  to one row of at most four cards (Expiring, Expired, Needs review, Monthly spend) and
  fold the "Inbox" count into the Documents nav badge or a single line ("3 documents
  waiting in your inbox") that only renders when non-zero.

### A2. Stat grids leave an orphan card on every breakpoint
- **Finding.** "Contracts missing info" and "Warranties missing info" sit alone on a
  second row (desktop and phone screenshots both show this).
- **Reason.** Each grid is `md:grid-cols-4` with five cards (the warranty row has 4 or 5
  depending on the Vehicles module), so the fifth always wraps.
- **Fix.** Either drop "missing info" into the Needs attention queue as a single
  "N records are missing key details" row, or make the grid `md:grid-cols-5` / wrap the
  cards in a `flex-wrap` row. Pairs with A1.

### A3. The suggested next action is often not the action the user needs
- **Finding.** An expired mobile plan's primary button is "Upload document"; an expiring
  warranty's is "Upload document"; an expiring policy's is "Renew policy", which just opens
  the edit form. Nothing in the app renews anything.
- **Reason.** `src/lib/needsAttention.ts` picks the action purely from "has a document
  or not", and `DetailStatusBanner` does the same. A missing document is a completeness
  gap, not an urgency gap, and "Renew policy" is a mislabelled "Edit".
- **Fix.** Separate urgency from completeness. For an expiring contract offer a real
  "Renew" flow that pre-fills a new end date (same term length) and keeps the old one as
  history, plus "Mark as cancelled". For a warranty, there is no renewal, so the row should
  read "Expires in 15 days" with "Dismiss" / "View". Treat "no document" as a quiet badge,
  not the headline action.

### A4. Every uploaded file is assumed to be a contract and re-scanned on each type change
- **Finding.** On the Upload page a file is scanned as a contract immediately; choosing
  "Product" or "Inventory item" triggers a second scan and another wait.
- **Reason.** `ImportClient.addFiles` hard-codes `type: "CONTRACT"` and `scanRow` runs on
  every select change. The inbox already has a type-guess heuristic (`computeInboxIntake`,
  used by the mobile camera FAB) that the Upload page does not use.
- **Fix.** Run the same type guess first, pre-select the guessed type, and request all
  three extractions in one call so a type switch is instant.

### A5. Reminders are configured per record with a free-text "30,14,7,1" field
- **Finding.** Contract, warranty and vehicle forms each end with "Remind me before
  expiry (days, comma-separated)". The default is only shown as placeholder text, so a
  user cannot tell whether leaving it blank means "no reminders" or "the defaults".
- **Reason.** `ContractForm`, `ProductForm` and `VehicleForm` all render a plain text
  input; validation rejects anything that is not a comma-separated number list.
- **Fix.** Replace with a small preset group ("Default (30/14/7/1)", "1 week", "Custom…")
  that shows the resolved thresholds, and move the control into a collapsed "Reminders"
  section so the main form is shorter (see B1).

### A6. Reminder health shows six fields on every detail page, three of which are never
useful on a fresh install
- **Finding.** "Enabled: Yes / Delivery channel: None configured / Delivery status: Not
  configured / Last sent: Never" appears on each contract, warranty and vehicle (vehicles
  show it up to three times).
- **Reason.** `ReminderHealthCard` always renders the full grid; the household-level fact
  ("no channel configured") is repeated per record.
- **Fix.** Collapse to one sentence with state colouring: "Next reminder 20 Sep via
  email" or "Reminders can't be delivered yet – set up email or push (admin)". Expand to
  the full grid only on click, and keep "Send test reminder" there.

### A7. Signing in after a deep link always lands on the dashboard
- **Finding.** Opening `/contracts/<id>` while signed out redirects to
  `/login?callbackUrl=…`, but after signing in the user is on `/dashboard`.
  Reproduced in the walkthrough.
- **Reason.** `proxy.ts` sets `callbackUrl`; the login page only reads `passwordChanged`,
  `LoginForm` has no hidden field, and the `login` action uses `redirectTo: "/dashboard"`.
- **Fix.** Pass `callbackUrl` through the form and honour it (same-origin only) in the
  action. This matters most for reminder emails that link to a record.

### A8. Extraction confirmation is a checkbox that defaults to "needs review"
- **Finding.** After a scan fills fields, the form shows "I've checked the highlighted
  fields… Leave this unchecked to save anyway". Most people save without reading it, so
  most scanned records become "Needs review" with reminders on hold, and then reappear in
  the attention queue.
- **Reason.** `ContractForm`/`ProductForm` default `confirmExtraction` to false; the
  Upload page always sends `confirmExtraction=0`.
- **Fix.** Make confirmation the act of saving: show the highlighted fields in a short
  review list above the Save button ("3 fields were auto-filled – edit any that are wrong")
  and treat Save as confirmation. Keep "needs review" only for records created without a
  human in the loop (email ingestion, bulk "Save all").

---

## B. Forms and record pages

### B1. The contract form is 20 fields on one screen (about 2,200 CSS px tall on a phone)
- **Finding.** Title, category, provider, number, two dates, renewal type, notice period,
  cost, currency, billing frequency, property, vehicle, three contact fields, notes,
  reminders, tax deductible, plus two upload zones on the warranty form.
- **Reason.** All fields are rendered unconditionally in `ContractForm`.
- **Fix.** Keep the five fields that drive reminders and spend (title, provider, category,
  end date, cost + frequency) visible. Put the rest behind "More details" (contacts,
  notice period, notes, links, tax) and "Reminders". Default currency is already
  inferred; billing frequency should default to Monthly when a cost is entered.

### B2. Category is marked required but silently defaults to "Other"
- **Finding.** The select shows a red asterisk yet is pre-set to "Other", so it is never
  actually enforced and most records end up uncategorised, which then degrades the Spend
  by-category chart.
- **Reason.** `defaultValue … ?? "OTHER"` in `ContractForm`.
- **Fix.** Start with an empty "Choose a category" option, or infer from the title and
  provider (the extraction code already has provider heuristics).

### B3. Native date inputs ignore the household date-format preference
- **Finding.** With the preference set to DD/MM/YYYY the inputs still show "mm/dd/yyyy".
- **Reason.** `DateInput` is a native `type="date"`; the preference is only echoed as a
  hint under the field after a value is entered.
- **Fix.** Acceptable as-is if the hint is kept, but say so in the Preferences copy
  ("date pickers follow your browser's language") so the mismatch is not read as a bug.

### B4. "Mark as cancelled" has the same weight as Edit on every contract
- **Finding.** Detail header shows badge + Edit + Mark as cancelled + overflow; on a phone
  this wraps to two rows with a lone "⋮" button underneath.
- **Reason.** `contracts/[id]/page.tsx` renders the status toggle as a top-level button.
- **Fix.** Move status change into the overflow menu (where Delete already lives) and
  into the expiry banner where it is contextually relevant.

### B5. Warranty document upload shows two unlabelled "Other" selects
- **Finding.** Product detail page has a "kind" select and a "category" select stacked,
  both reading "Other", with no visible labels.
- **Reason.** `ProductDocumentUploadForm` renders both selects with `aria-label` only.
- **Fix.** Merge into one labelled "Document type" select, or drop "kind" and derive
  Photo from the file's MIME type (the page already does that to find the hero image).

### B6. The barcode "Look up product info" link appears even when lookup is disabled
- **Finding.** Clicking it returns "Automatic lookup isn't enabled on this server".
- **Reason.** `ProductForm` always renders the link; the API returns 404 when disabled.
- **Fix.** Pass the barcode-config flag into the form and hide the link (keep the scanner
  button, which still fills the barcode field).

### B7. Linked-record fields appear and disappear inconsistently
- **Finding.** The contract form shows a Vehicle select but no Property select when the
  Property module is on but no property exists; the warranty form instead shows a hint
  ("No properties yet – add one"). The Upload page shows one combined "Link to" select.
- **Fix.** Use the same pattern everywhere: a single "Linked to" field that lists
  homes and vehicles, with the "add one" hint when a module is enabled but empty.

### B8. Back links come in three styles
- **Finding.** Contract detail uses an icon `BackLink`; product and vehicle detail use a
  text arrow "← Back to products"; wealth pages use "← Back to wealth". Labels also
  disagree with nav names ("Back to products" vs "Purchases & warranties").
- **Fix.** Use `BackLink` everywhere with the nav label as the destination name.

---

## C. Naming and information architecture

### C1. Four vocabularies for the same two objects
- **Finding.** Nav: "Policies & contracts" / "Purchases & warranties". Buttons and
  headings: "Add contract", "Add warranty", "Back to products", "Warranties tracked".
  Upload/Inbox selects: "Contract" / "Product". Add picker: "A bill or subscription" /
  "Something under warranty". Help: "Contracts, Warranties".
- **Reason.** Issue #332 renamed the nav but not the buttons, selects, help, trash
  labels or back links (see `nav-items.ts` comment).
- **Fix.** Pick one short noun per object and use it everywhere. Recommended:
  "Contracts" and "Warranties" (both already used in the dashboard, trash and help), with
  the longer phrasing only as a subtitle on the list page.

### C2. Nav labels do not match page titles
- **Finding.** Nav "Upcoming" → route `/calendar`; nav "Spending" → page heading "Spend";
  Help references "Settings → Users" and "Documents → Inbox tab" which do not exist under
  those names.
- **Fix.** Align heading, nav label and help copy; update the FAQ strings in
  `help/page.tsx` when settings routes are renamed.

### C3. Settings is a three-level tree with overlapping names
- **Finding.** Settings → "Household & System settings" → "System settings". Personal
  Settings says "only affect your own account" but contains Trash (household data) and
  Downloaded documents. System settings is one page with nine independent Save buttons
  and raw cron expressions.
- **Fix.** Two top-level tabs: "My account" (profile, password, 2FA, passkeys,
  preferences, notifications, calendar feed) and "Household" (members, modules,
  reminders & channels, AI, ingestion, backups, webhooks, trash). Group System settings
  into those tabs instead of a separate page. Express schedules as "Daily at 08:00" with
  a cron escape hatch.

### C4. Inventory is half a module
- **Finding.** It is a module in the registry and setup screen but is excluded from the
  nav (`nav-items.ts` filters it out), lives as a section at the bottom of
  "Purchases & warranties", and still has its own `/inventory` pages reachable from the
  Add picker.
- **Fix.** Either give it a nav entry like the other modules or fold it fully into
  warranties ("Items" tab) and retire the standalone routes.

### C5. The AI extraction settings pre-select "Anthropic Claude" and warn as if it were live
- **Finding.** With no provider configured, the select shows a provider and the banner
  says "Documents will be sent to Anthropic Claude for processing."
- **Reason.** `AiSettingsForm` uses `useState(provider ?? "ANTHROPIC")`.
- **Fix.** Default to "Not configured (local extraction only)" and show the data-egress
  warning only after a provider is chosen.

---

## D. Lists, search and filters

### D1. Contract list filter bar has a redundant "Filter" button and two rows of look-alike pills
- **Finding.** Search auto-submits after 400 ms and both selects submit on change, so
  "Filter" never does anything new. Below it, four filter chips and then a summary strip
  of near-identical pills ("1 expiring within 30 days", "1 expired"). On a phone the bar
  (search, two full-width selects, Filter button, chips, summary) fills the first screen
  before any contract is visible.
- **Reason.** `ContractListClient` renders the form button and both pill rows.
- **Fix.** Remove the Filter button (keep Enter-to-submit). Merge the summary counts into
  the chips ("Expiring soon · 1", "Expired · 1") so there is one row. On mobile, put
  category and status behind a single "Filters" sheet.

### D2. Global search opens with eight jargon chips
- **Finding.** "Missing link", "Missing identifier", "Missing reminder", "Missing date"
  are presented before the user has typed anything.
- **Reason.** `GlobalSearch` renders every server filter as a chip.
- **Fix.** Show recent records / records needing attention by default; keep two or three
  plain-language chips (Expiring soon, Needs review, Important) and expose the
  completeness filters on the list pages where they already exist.

### D3. "Type" means two different things on the Documents page
- **Finding.** Chips "All types / Contracts / Warranties…" (which module), a select "All
  document types" (invoice, photo…), and a column "Document type" showing both pills.
- **Fix.** Call the module dimension "Belongs to" and the category dimension "Document
  type", in chips, select and column header.

### D4. Spend shows noise tiles and a flat chart
- **Finding.** "Tax-deductible / mo AUD 0.00" renders when nothing is deductible; the
  12-month chart shows twelve identical bars for most households; a $1,200 policy with no
  billing frequency is excluded and only flagged on the dashboard, not here.
- **Fix.** Hide zero tiles, show the "not counted" warning on Spend too, and replace the
  flat timeline with the by-category breakdown as the primary chart.

### D5. The calendar feed lives in Settings, not on Upcoming
- **Finding.** The one action a user wants on "Upcoming" (subscribe in their calendar
  app) is in personal Settings.
- **Fix.** Add a "Subscribe (iCal)" button to the Upcoming page header that opens the
  same token UI.

---

## E. Mobile

### E1. The camera/“Choose file” FAB covers content and controls
- **Finding.** On the contracts list it overlaps the cost of the first card; on contract
  detail it covers "Send test reminder"; on Settings it covers the Preferences text.
- **Reason.** `MobileUploadFab` is fixed on every non-form route; pages add bottom
  padding only for the nav bar, not the FAB.
- **Fix.** Show the FAB only on the dashboard and Documents pages (where capture is the
  primary job), or collapse it to a single camera icon that hides on scroll-down.

### E2. Primary actions wrap or stack awkwardly
- **Finding.** "Policies & contracts" heading wraps to two lines next to Export and a
  two-line "Add contract" button; the detail header wraps its "⋮" onto its own row.
- **Fix.** On `< md`, stack heading above a single full-width primary button and move
  Export into the overflow menu.

### E3. Mobile "More" sheet has no Upload/Inbox entry
- **Finding.** Documents is in the bar but the Upload page itself is only reachable via
  the dashboard button, the FAB's "Choose file" pill, or empty states.
- **Fix.** Add "Upload" to the More sheet (or make the FAB the only entry point and label
  it as such).

---

## F. Dialogs, feedback and accessibility

### F1. The dashboard "Add" picker ignores Escape and has no focus trap
- **Finding.** Reproduced: after pressing Escape the overlay still intercepts clicks.
- **Reason.** `AddEntryPicker` is a hand-rolled overlay; it does not use the shared
  `Dialog` primitive that #297 introduced for every other modal.
- **Fix.** Render it through `Dialog`.

### F2. Favicon and PWA icon are behind the auth wall
- **Finding.** Dev log shows `GET /icon.svg` → `307 /login?callbackUrl=…/icon.svg` on
  the login and setup pages, so the tab icon is missing before sign-in. `/sw.js` is in
  the same position.
- **Reason.** `proxy.ts` matcher excludes `favicon.ico`, `manifest.json` and `icons/`
  but not `icon.svg` or `sw.js`.
- **Fix.** Add both to the matcher exclusion.

### F3. "Sign in with passkey" shows for every household, including ones with no passkeys
- **Finding.** The button is rendered unconditionally; with no registered passkey the
  browser prompt fails and the user sees "The passkey may not match an account".
- **Fix.** Render it only when at least one passkey exists (one count query on the login
  page) and `APP_URL` is set.

### F4. Onboarding checklist cannot be completed by a household that wants no modules
- **Finding.** "Enable the modules you need" is "done" only when
  `enabledModules.length > 0`, so a contracts-only household sees it unchecked forever
  (until they dismiss the whole card).
- **Fix.** Mark it done once the user has visited the Modules page, or drop the step
  (modules are already chosen at setup).

### F5. Toasts disappear after 4 s and carry no undo
- **Finding.** Delete/discard actions show "Removed." for 4 s; the only undo is Settings
  → Trash, which the toast does not link to.
- **Fix.** Add an "Undo" action to destructive toasts (restore actions already exist),
  or at least a "View trash" link.

### F6. Email reminder preference copy understates what it controls
- **Finding.** Checkbox says "Email me about contracts expiring soon" but the scheduler
  uses it for warranties and vehicles too.
- **Fix.** "Email me expiry reminders (contracts, warranties, vehicles)".

---

## Suggested order of work

1. A1 + A2 + A3 (dashboard order, stat grid, real actions) – highest daily impact, small code.
2. A7, F1, F2, F3 – small correctness fixes with user-visible confusion.
3. C1 + C2 + B8 – one naming pass across nav, buttons, back links, help.
4. B1 + A5 + A8 – shorten the forms and make confirmation the default path.
5. D1 + E1 + E2 – list toolbar and mobile overlap.
6. C3 + C4 – settings restructure and Inventory decision (larger, plan separately).
