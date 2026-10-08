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

---

# Part 2: walking the real moments

The first pass audited screens. This pass follows a household through the moments the
app exists for, and asks what each person actually needs at that moment. Every claim is
tied to code or to the walkthrough.

## Moment 1. A renewal notice arrives (the single most common event)

The insurer emails "your policy renews on 20 Oct at $1,340". Today the user must open the
contract, press "Renew policy" (which is just Edit), overwrite the end date, overwrite the
cost, and lose last year's figure. There is no history, no "premium went up 12%", and the
old policy PDF and the new one sit side by side with no relationship unless the file is
byte-identical (the version chain only triggers on a duplicate hash).

- `renewalType` ("Auto-renews / Manual / Fixed term") and `noticePeriodDays` are stored
  and displayed but used nowhere: not by the scheduler, the calendar, the status badge or
  the attention queue (grep confirms the only consumers are forms, labels, MCP and chat
  tool schemas). So an auto-renewing policy shows "Expired 5d ago" every year, and a
  contract with a 30-day notice period gets its reminders at the end date, i.e. after the
  cancellation window has closed. For an app whose form copy promises "never miss a
  renewal or cancellation deadline", this is the biggest functional gap.

**What the user needs.** A first-class "Renew" action on the detail page and in the
queue that: pre-fills a new term of the same length, asks for the new cost, archives the
previous term (dates, cost, document) as history, and attaches the new document. For
`AUTO_RENEW`, roll the end date forward automatically when it passes and log it. For
notice periods, compute the real deadline (end date minus notice period) and drive
reminders and the "Expires in N days" copy from that, with the label "Cancel by 20 Sep".

## Moment 2. A reminder lands on the phone

The email says: `Reminder: "Home & Contents Insurance" contract expires in 14 days` and
the body ends with "Log in to Hearth to review it." There is no link to the record, no
link at all. The ntfy push has no Click URL either. The date is hard-coded to `en-AU`
formatting regardless of the household's preference. If the user does find the record by
hand, signing in drops them on the dashboard (finding A7), and the record offers "Renew
policy" (Edit) or "Mark as cancelled".

**What the user needs.** One tap from the notification to the record, and on the record
three honest choices: "Renewed", "Cancelled", or "Remind me again in N days". None of the
three exists today: there is no snooze or acknowledge state anywhere in the schema, so the
only way to silence an item is to edit the date or cancel the contract. Add a
`snoozedUntil` on contracts, products and vehicles, surface "Snooze" on queue rows and
detail banners, and put the deep link plus the two main actions into every email and push
(ntfy supports a Click header and action buttons).

## Moment 3. The thing has expired and nobody did anything

Reminders stop at day 0 (`if (remaining < 0) continue;`), but the dashboard keeps the
item in "Needs attention" as "Expired N days ago" indefinitely. Products and vehicles have
no status or archive field at all (only `deletedAt`), so a TV whose warranty ended three
years ago sits in the attention queue forever with an "Upload document" button, and the
only way out is to delete the record. Vehicles with a past service date behave the same.

**What the user needs.** Expiry should be a terminal, calm state, not a permanent alarm.
Auto-archive warranties after expiry plus a grace period (keep them searchable, drop them
from the queue), add an "Archived" status to products and vehicles, and keep expired
contracts in the queue only until they are renewed, cancelled or snoozed.

## Moment 4. The partner is invited

The admin adds a member. With email configured they get a 48-hour link; after setting a
password the page says "Password set. You can now sign in" with a button to the login
page, so they type the email and new password again. They land on the dashboard, which
leads with "Documents: Inbox 0 / Total 7" and two stat grids, and the Upcoming view they
most likely want is behind "More". Nothing tells them what is theirs to do. The role
description text appears only to the admin at invite time.

**What the user needs.** Sign the member in automatically after accepting the invite and
land them on "Upcoming", with a one-time banner: "You're a Member of the Example household.
Everything here is shared; you can add and edit anything." Promote Upcoming into the
mobile bar (replace Documents, which the camera button already serves) because the
consuming member's recurring question is "when is X due", not "where is the PDF".

## Moment 5. Day one with a shoebox of paper

The admin drags fifteen PDFs onto Upload. Each is scanned as a contract (finding A4),
every category defaults to "Other" (B2), every row needs a type decision and a provider,
"Save all" files everything as unconfirmed so all fifteen reappear in the queue as
"Needs review" (A8), and without a configured AI provider the heuristics find little on
scanned paper. Then the user discovers that the car insurance they just filed as a contract
is also a date field on the Vehicle ("Insurance expiry"), that the home insurance has no
link to the property unless they go back and edit, and that "Warranty" is also a contract
category, duplicating the whole Warranties module.

- Vehicle `insuranceExpiry` and a `CAR_INSURANCE` contract linked to that vehicle are two
  independent records with two independent reminders and no sync (confirmed: no code path
  touches `insuranceExpiry` from the contracts actions).
- `CATEGORY_LABELS` includes `WARRANTY` for contracts.

**What the user needs.** One place for each fact. Derive the vehicle's insurance expiry
from its linked insurance contract (and rego from a linked registration record) rather
than asking twice; remove "Warranty" from contract categories and redirect to the warranty
form; let the import table set category and link in bulk ("apply to all selected"); and
show one clear banner after Save all: "15 records added. 4 need a quick check" with a
single review screen instead of fifteen queue rows.

## Moment 6. "Send me the policy" (at the mechanic, on the phone)

The user opens the contract on their phone, finds the document row, and gets a download.
There is no inline preview on the detail page (the eye icon exists only on the Documents
page), no Web Share integration anywhere (`navigator.share` is unused), and the camera
button covers the document row's own actions on short screens (E1). Sharing a PDF to
WhatsApp or email, the thing a phone is for, takes a download, a Files app, and a share
from there.

**What the user needs.** Preview and Share on every document row, using the Web Share
API with a file payload on supported mobile browsers and a copy-link fallback.

## Moment 7. Setting up reminders, which is the whole point

The nudge "Reminders aren't configured" leads to a System settings page whose first
section is SMTP host, port, username, password, TLS. Most households do not have an SMTP
relay. The alternative, ntfy, requires installing a third-party app and sharing one topic
across the household, and there is no per-person channel choice (the only per-user
preference is the single `emailReminders` boolean). The app is installable as a PWA with
a service worker already in place, yet offers no Web Push, which is the one channel that
needs no external account and would notify each member on their own device.

**What the user needs.** A "Turn on reminders" step on the dashboard that offers, in
order: browser/PWA push (one tap, per device), then email, then ntfy, with a test send
right there. Keep SMTP and ntfy as the advanced path.

## Moment 8. Queue ordering under real load

With a handful of records the queue reads well. With a year of data, "Needs review" rows,
"Reminder failed" rows and the "not configured" nudge all sort above anything with a
date (`sortKey(null)` is negative infinity), so a policy expiring tomorrow can sit beneath
six housekeeping rows. There is also no way to dismiss a per-record row.

**What the user needs.** Two sections: "Due" (sorted by real deadline, including notice
periods) and "Housekeeping" (review, failures, configuration), each collapsible, each
with Snooze.

## Priorities from the user's seat

1. Make renewal real: Renew action with history, auto-renew roll-forward, notice-period
   deadlines. This turns the app's promise into behaviour.
2. Make reminders reach a person and lead somewhere: deep links and actions in email and
   push, honour the callback URL on login, add Web Push.
3. Give every alarm an off switch: snooze, archive, expiry as a terminal state.
4. One fact, one place: vehicle/property dates derived from linked contracts; drop the
   duplicate "Warranty" contract category.
5. Day-one bulk import that ends in one review screen, not fifteen queue rows.
6. Member onboarding: auto sign-in after invite, land on Upcoming, promote Upcoming in
   the mobile bar.
7. Preview and Share on documents.
