# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/), starting at `0.1.0`.

## [Unreleased]

### Security

- `nodemailer` 10.0.16 → 10.2.1 and `mailparser` → 3.12.4, fixing three
  high-severity "interpretation conflict" advisories in nodemailer
  (SNYK-JS-NODEMAILER-21663365, -21663367, -21663373).
- `fast-uri` override 3.1.8 → 3.1.9, fixing four moderate-severity URI
  parsing advisories (scheme spoofing, host confusion, path equivalence and
  scheme injection; GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr,
  GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp). The remaining low-severity
  `npm audit` entries all trace to `@simplewebauthn/server` 9.x and are
  tracked in #376.
- **Signing out clears this device's offline data (#424).** Sign out now
  deletes the service worker's cached pages and data (and serwist's record
  of their URLs), the offline write queue and offline Documents, then does
  a full page load to the sign-in page, so Back can't show the previous
  user's pages and the next person to use a shared browser can't see or
  replay any of it. If changes are still waiting to sync, including ones a
  sync is sending right now or left mid-sync by a closed tab, it first
  waits for that sync and asks: Sync now (signs out only once they've
  synced), Discard and sign out, or Cancel. Signing out while offline is
  refused, and if the server can't be reached anyway, the tab stays signed
  in with offline use working, rather than half signed out. Other open
  tabs reload, and Escape on a phone closes just the prompt, not the More
  sheet behind it. When a session ends without Sign out (a password change, an
  expiry), the sign-in page drops offline Documents and cached lists too,
  keeping only the write queue for that user's return. Offline data is
  also tied to the user who stored it: a different user signing in never
  sees the last user's queued changes or downloads and purges them,
  `/api/sync` refuses a change queued by another account, a read-only
  member can't queue changes offline (one made read-only is told their
  queued changes can't be saved, and can discard them), and the service worker serves no
  cached signed-in page once nobody is signed in or the session has
  expired. Changes queued before this release carry no owner: the first
  member who can write to sign in takes them on (a read-only member's
  sign-in purges them instead), and offline Documents and cached lists
  from before it are purged. If someone other than the person who queued
  them is that first writer, they'll sync under that member's account.

### Added

- **Household timezone.** Admins pick any timezone in Settings → Household
  & System; until then it follows the server's `TZ`, else the server's own
  zone, else UTC. Reminders and due dates will count days in it, so every
  member sees the same count, while each member's own timezone still only
  changes how times are shown. Members see it read-only on their Settings
  page (#383).
- **One set of Due rules.** `src/lib/duePolicy.ts` works out every
  record's Due entries (a Contract's notice deadline or end date, a
  Warranty's end date, a Vehicle's rego, insurance and service dates, a
  Tenancy's lease end) with their days left, state and label, counted in
  the household's day. Its rules are pinned by a shared case file,
  `tests/fixtures/due-policy-cases.json`, which replaces the
  `contractTiming` unit tests and which the standalone app will run too.
  The Reminder schedule and every screen use it; see "Every screen follows
  the Due rules" under Changed (#383, #384).
- **Reminders link to the record.** Email reminders include an "Open it in
  Hearth" link; ntfy notifications open the record when tapped and add an
  Open action. Links are only included when `APP_URL` is set, and Settings
  → App shows a nudge when reminder delivery works but `APP_URL` is
  missing (#352).
- **"Send test reminder" sends the real thing.** On a contract, warranty
  or vehicle page it now sends that record's own reminder, so you can see
  exactly what will arrive (#352).
- **Subscribe from Upcoming.** A "Subscribe in your calendar" button on
  Upcoming opens the calendar feed controls in place, with a `webcal://`
  link that hands the feed straight to your calendar app (#368).
- **Undo after deleting.** Deleting a contract, warranty, vehicle,
  property, inventory item, trip, home/vehicle item or document shows an
  Undo button for 8 seconds that restores it from Trash. An offline delete
  can be undone before it syncs. Toasts can now be dismissed (#371).
- `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` and `MAP_TILE_SUBDOMAINS` choose
  the property map's tile source; the Content-Security-Policy follows the
  configured host (#338).
- **Standalone mobile mode caught up with the connected app.** The offline
  standalone shell (`ios-shell/www`, shared by the Android and iOS Capacitor
  builds) hadn't been updated since it first shipped and had drifted behind
  87 commits of web-app changes. It now has: a warranty-to-property picker
  (with the same "no properties yet" / "enable the Property module" hints as
  the connected app, #239), inventory-to-warranty linking with a reverse
  "Linked inventory" list on the warranty's detail page (#241), a vehicle
  "Next service due" date wired into the same reminder/calendar/attention
  pipeline as rego and insurance expiry, "Missing info" completeness filters
  and dashboard stat cards for policies and warranties (#328), and the
  "Policies & contracts" / "Purchases & warranties" terminology (#332). The
  standalone SQLite schema version moves to 8 for the new columns, migrated
  automatically for existing installs. Flight-status tracking, per-field
  extraction review, and inline home/vehicle linking during inbox review stay
  connected-mode only — see the code comments in `ios-shell/www/app.js` for
  why each doesn't have a standalone equivalent.
- **Standalone mobile mode is now a paid unlock; connected mode stays free.**
  Connecting the app to your own self-hosted server is unchanged and free.
  Using Hearth fully offline on-device (standalone mode) now requires a
  one-time, non-consumable in-app purchase, handled via RevenueCat
  (`@revenuecat/purchases-capacitor`) so App Store and Play Store billing
  share one entitlement check. The purchase is checked once per app launch
  (cached locally by the RevenueCat SDK afterward, so it still works
  offline) and gates both the initial "Use on this device" choice and the
  app's boot-time resume of a previous standalone session. A new paywall
  screen shows the live price, a Buy button, and a Restore purchases button.
  Requires a RevenueCat project and matching App Store Connect / Google Play
  Console non-consumable products to be set up before shipping — see the
  comments beside `REVENUECAT_API_KEY_IOS`/`REVENUECAT_API_KEY_ANDROID` in
  `ios-shell/www/app.js`, which are placeholders pending that setup.

### Changed

- **CI split into separate required checks.** `.github/workflows/ci.yml` replaces
  `e2e.yml` with one job per check: `typecheck`, `lint`, `unit`, `build`, `e2e`
  and `standalone`. A failing lint step no longer shows up as an "e2e" failure.
  `next build` now runs on every PR (before, only the Docker Scout image build
  ran it), and the standalone shell suite now runs in CI. `main` has a
  ruleset that requires these checks, plus Docker Scout, CodeQL and Codacy,
  before a merge, and blocks force-pushes and deletion.
- **Unit test coverage.** `npm run test:coverage` (Vitest + v8) reports
  coverage. CI posts a summary on every run, fails if coverage drops below the
  floor in `vitest.config.ts` (30% lines today), and uploads it to Codacy
  once the `CODACY_PROJECT_TOKEN` secret is set.
- **Dependabot version updates.** A weekly npm and GitHub Actions schedule,
  with minor and patch bumps grouped. Major bumps of `@simplewebauthn/*` and
  `next-auth` are held back: bumping one alone broke `main` (#443, reverted
  in #459), and #376 upgrades them together.

- **Standalone shell wealth parity (#440).** The offline shell's dashboard now
  lists net worth the way the web Wealth page does (#404): a Net worth total
  with its parts beneath — Shares, ETFs and crypto, Property and Items, each
  shown only when its module is on — and the listed parts add up to the
  total. Its generic CSV trade import reads the optional Asset Class and
  Exchange columns and creates a CRYPTO holding when either says Crypto
  (case-insensitive); a row with neither stays SHARE, and the class is never
  guessed from the ticker.
- **One navigation on phones (#407, #369).** The bottom bar and its More
  sheet are now the only way around on a phone; the menu button and
  edge-swipe drawer are gone (the desktop sidebar is unchanged). More lists
  every destination the bar doesn't, plus your name and Sign out, so phone
  and desktop navigation match. Upload and the Inbox aren't nav entries:
  Upload stays a button in the Dashboard and Documents headers (#401), and
  the Inbox is a tab on Documents. The number of Documents waiting in the
  Inbox shows as a badge on Documents, in both the bottom bar and the
  sidebar.
- **List page headers fit on a phone (#369).** Below tablet width the page
  heading keeps its own line, Export (CSV or PDF) moves into the ⋮ menu
  beside it, and the Add button runs full width underneath, on Contracts,
  Warranties, Properties, Vehicles, Travel, Inventory and Wealth. Section
  buttons on property and vehicle pages, "Send test reminder", Help's report
  button and Spending's totals no longer wrap or overflow at 360px.
- **One name for each thing (#362).** The nav, page headings, browser tab
  titles, buttons, back links, Trash and Help now use the same words as
  `GLOSSARY.md`:
  - "Policies & contracts" is **Contracts** and "Purchases & warranties" is
    **Warranties** again, so the mobile bottom bar labels fit on one line.
    (Warranties becomes Items with #380.) Search still finds records by the
    old words.
  - The Spend page is **Spending**, Help's heading is **Help**, and the
    Property module is **Properties** in the nav and on its page.
  - Vehicle and property entries are **Service records** and **Maintenance
    records**, a let-out property's page is **Tenancy**, and "Home or
    property" is **Property**.
  - Every back link uses one component with an arrow icon and the
    destination's name ("Back to Warranties"), including new back links on
    edit pages, the Settings sub-pages and Upload. "← Back to products" is
    gone.
  - Trash-backed deletes confirm with **Move to Trash** and say **Moved to
    Trash** with Undo.
  - "Expiring soon" is **Due soon**, reminder fields are **Reminder
    thresholds**, and the contract number field is **Contract number**.
  - en-AU spelling: Licence plate, Uncategorised, colours.
  - Sign-in says "Forgot your password? Ask your admin." when email isn't
    configured.
  - Help's answers point only at pages and Settings sections that exist,
    checked by a new unit test (`tests/unit/help-faq-labels.test.ts`).
  - The standalone mobile shell uses the same nouns.
  - Search results and Documents rows for a maintenance record, rental
    statement or trade link to a page that exists (the property, its
    Tenancy page, or the holding) instead of a 404.
- **Every screen follows the Due rules (#384).** The Contracts, Warranties
  and Vehicles lists and their cards, the "Expiring soon" and "Expired"
  filters and their counts, the dashboard's Needs attention, Search,
  Upcoming, the iCal feed and the detail-page banners now all ask the one
  Due policy, so the same record reads the same everywhere. What you'll
  notice:
  - Warranties past their end date read **Lapsed** and leave Needs
    attention. The Warranties list's "Expired" chip is now "Lapsed", at
    `?due=lapsed`; old `?due=overdue` and `?expired=true` links to it
    redirect there.
  - Fixed-term Contracts past their end date read **Ended**. Only
    manual-renewal Contracts read **Expired**. A fixed-term Contract ending
    soon is still Due but no longer offers "Renew".
  - An auto-renewing Contract past its end date is no longer "Expired": it
    becomes a Housekeeping row, "Set the new end date". Its end date is
    never Due, only its notice deadline.
  - A rented Property's lease end is Due as it approaches. Once it passes,
    it becomes a Housekeeping row, "Lease ended — set the new lease end",
    and the property page shows a banner for it.
  - "Expiring soon" means inside each record's due-soon window (its
    largest Reminder threshold, else the household default) instead of a
    fixed 30 days. The dashboard's empty state reads "Nothing due".
  - A Vehicle's rego, insurance and service dates are separate rows in
    Needs attention, each with its own state, and the vehicle page now has
    a banner for each one that's due soon (warning) or overdue (danger).
  - Badges show the policy's labels ("Cancel by 4 Nov", "Expires today",
    "Expired 3 days ago", "Ended 2 Oct", "Lapsed 1 Sep") instead of
    "12d left". Lapsed, Ended and "Needs new end date" are neutral, not red.
  - A Contract or Warranty ending today is due soon ("today"), not Expired.
  - Day counts follow the household timezone.
  - Cancelled Contracts leave Upcoming and the iCal feed. The feed calls a
    Contract's end date "renews", "ends" or "expires" by its renewal type,
    and a Warranty's "warranty ends", and it now includes the current
    Tenancy's lease end.
  - A Property's current Tenancy is its most recent lease (latest lease
    start), so back-entering an older lease doesn't replace it.
  - Search has no end-date range of its own; its "Expiring soon" filter
    matches the lists exactly, Vehicles included.

  The MCP server and the Assistant move onto the same rules in #394.
- **Upcoming shows what's coming up (#402).** It now runs from today to
  the horizon you pick, with no history: anything overdue is in Needs
  attention instead. Service and Maintenance records and Trip segments
  never read "Expired", and Trips show while any of them is still ahead.
  Record-type tags use the glossary's nouns ("Warranty", "Service record",
  "Maintenance record", "Trip", "Tenancy"), month headers are in sentence
  case, and a rented Property's lease end appears too.
- **One definition of Missing key details (#395).** The Contracts,
  Warranties and Vehicles lists, Search and the dashboard now share one set
  of filter rules (`src/lib/recordFilters.ts`), so a count always matches
  the list it opens. A Contract is missing key details when it has no end
  date (unless it auto-renews) or a cost with no billing frequency; contract
  number no longer counts. A Vehicle is missing key details when it has
  neither VIN nor plate. Cancelled and deleted records never count. The
  dashboard shows one "N contracts are missing key details" row (the
  separate "cost but no billing frequency" row is folded in), plus a
  Vehicles row, and each row in the filtered list says what is missing
  ("No end date", "No billing frequency", "No VIN or plate").
- **New list filter URLs (#395):** `?due=soon`, `?due=overdue`,
  `?missing=details`, `?review=1`, `?noDocument=1`, `?important=1`. Old
  links (`?expiring=30`, `?expired=true`, `?missingInfo=true`,
  `?needsReview=true`, `?missingDocument=true`) redirect to them, and
  Search still accepts its old `filter=` values. Following a dashboard link
  now shows the filter as an active chip with Clear all.
- Search's "Missing date" and "Missing identifier" chips are merged into
  "Missing key details", and its "Expiring soon" counts to a Contract's
  notice deadline, as the Contracts list does. The "Missing document" list chip is now "No
  document". "Expired" on the Contracts list leaves out Cancelled
  Contracts, matching the dashboard (#395).
- **Every Document goes to Trash.** Deleting a Document on a Trip segment,
  Rental statement or Trade now moves it to Trash with Undo, like every
  other Document, instead of deleting it for good. Trash lists and purges
  Documents of every kind, and those three kinds now keep the Document
  type chosen on upload. An offline Document delete also goes to Trash
  when it syncs (it used to delete the file outright) (#396).
- Search, the Documents page and the dashboard's Document counts leave out
  Documents in Trash, and Documents whose record is in Trash. A Document
  can only be deleted permanently from Trash, and a Restore or Delete in
  Trash that fails now says why (#396).
- All Document files are served from one address, `/api/documents/<id>`,
  which returns 404 when the Document's module is turned off or it, or its
  record, is in Trash. The old per-module addresses (`/api/vehicles/documents/…`,
  `/api/travel/documents/…` and so on) redirect there, so existing links
  and offline copies keep working (#396).
- **Plain colour palette.** The Stripe-derived tokens (purple accent, navy
  text, indigo dark mode, `shadow-stripe` card shadows) are replaced by
  neutral greys with one blue accent, in light and dark. Every text colour
  is at least 4.5:1 on the page and card backgrounds and on its own pill
  tint, borders are visible in both themes, and native inputs and date
  pickers follow the theme (`color-scheme`). `scripts/check-contrast.mjs`
  checks this and runs in `npm run test:unit`. Hard-coded Tailwind colours
  (amber, slate, blue and others) now use the theme's danger, warning or
  neutral tones; Upcoming's coloured record-type pills are plain text.
  Uppercase section labels are sentence case, and the Sparkles icon and
  the Wealth donut chart are gone, the latter replaced by a plain
  allocation list (#408).
- Reminder dates follow each recipient's date format preference (#352).
- `vehicle.expiring` webhook event: vehicle reminders now carry
  `"field": "regoExpiry" | "insuranceExpiry" | "nextServiceDue"` and link
  to `/vehicles/…`. Previously they were sent as `contract.expiring` with
  a `/contracts/…` URL that didn't resolve. Webhook `url` is `null` until
  `APP_URL` is set (#352).
- Contract "Mark as cancelled / active" moved from the page header into
  the ⋯ menu, and is offered beside Renew when a contract is expiring
  (#370).
- One "Linked to" select, grouped by Homes and Vehicles, on the contract
  and warranty forms, Upload and the Inbox, with an "add one" hint when a
  module is on but empty (#370).
- AI extraction and assistant settings start at "Not configured" instead
  of pre-selecting a provider (#346).
- The email reminder preference names everything it controls (#347).
- The mobile capture button only shows on the dashboard and Documents
  (#348).
- Warranty uploads have one labelled "Document type" select (#350).
- Vehicle and Service record writes go through one command module
  (`src/lib/commands/vehicles.ts`) shared by the server actions, offline
  sync and Trash retention, instead of being written separately in each
  (ADR 0003). An offline Vehicle edit now records who made it, as an online
  one does. Vitest command tests run against a temporary migrated SQLite
  database (`tests/helpers/testDb.ts`) (#389).
- Trip and Trip segment writes go through one command module
  (`src/lib/commands/trips.ts`) shared by the server actions, offline sync,
  Trash retention and the flight status and distance lookups (ADR 0003).
  An offline Trip edit now records who made it, as an online one does
  (#391).
- Property, Maintenance record, Tenancy, Rental statement and Property
  valuation writes go through one command module
  (`src/lib/commands/home.ts`) shared by the server actions, offline sync
  and Trash retention (ADR 0003). An offline Property edit now records who
  made it, as an online one does, and Property valuations are now refused
  while the Property module is off, like every other Property record. A
  Property in Trash (and a Maintenance record in Trash) can't be edited or
  added to, offline or online, until it's restored (#390).
- Extraction review, Confirm details and Cancel / Reactivate now write
  Contracts and Products through their commands
  (`src/lib/commands/contracts.ts`, `products.ts`) like every other update
  (ADR 0003). A review's corrections, clearing Needs review and marking its
  fields reviewed land together or not at all, and a status change records
  who made it and refreshes the same pages as an edit. A Contract or
  Product in Trash can't be edited, Cancelled, Reactivated or confirmed
  until it's restored. A review that blanks a title, provider or
  description, makes one too long, enters a value that isn't a number or
  date, or leaves an end date before the start date (a warranty end before
  the purchase date) is now refused with a message, where it used to fail
  as "Record no longer exists", cut the text short or quietly clear the
  field. An Assistant change that links to a Property or Vehicle that
  doesn't exist or is in Trash is refused with a message, and if saving a
  confirmed Assistant change fails, the card says so and can be retried
  instead of staying on "Saving…" (#393).
- Portfolio, Holding and Trade writes go through one command module
  (`src/lib/commands/wealth.ts`) shared by the server actions, offline
  sync and CSV import (ADR 0003). Cost basis is still worked out from the
  Trades on each view. Changing a Holding's ticker to one already in the
  Portfolio now shows "already in this portfolio" instead of failing (also
  when two saves race), an imported ticker is upper-cased so "vas.ax"
  lands on the existing VAS.AX Holding, an
  offline Holding edit is checked against the Portfolio it was made under,
  and the market price looked up after a new Trade no longer makes a
  queued offline edit of that Trade look stale (#392).
- **One Reminder schedule (#387).** The scheduler, the Reminder health
  card and Settings' household Reminder health now read one pure schedule
  (`src/lib/notifications/reminderSchedule.ts`) built on the Due policy, in
  place of three copied scheduler loops and a separate health rule. Days
  count in the household's timezone. The sent-Reminder log stores the Due
  entry date each Reminder was for, and only rows for the current date
  count, so moving a date resets its Reminders without anything clearing
  the log (ADR 0003). After the upgrade, a one-off backfill dates existing
  rows still inside their threshold's window, so nothing already sent goes
  out again; older rows stay as history. Behaviour changes that come with
  it: a manual-renewal Contract with a notice period now gets end-date
  Reminders once its notice deadline has passed; an auto-renewing
  Contract's end date never reminds; a catch-up Reminder (several
  thresholds crossed at once) is now the only one for the thresholds it
  passed over, where the next checks used to send each of those too; a
  record that Needs review shows its Reminders as on hold; and a failed
  Reminder for a date that has since moved, or that a later threshold's
  Reminder replaced, no longer shows as a Housekeeping item. Email counts
  as a Reminder channel only when someone has reminder emails turned on.
  "Send test reminder" previews the Reminder that would really go next and
  when, and says plainly when none will.

- **Simpler dashboard: what needs doing comes first (#356, #357).** The 11
  stat cards and the Documents block are gone. Under the heading is one line
  with the number of active contracts, warranties and the estimated monthly
  spend, each linking to its list, and then Needs attention, split in two:
  - **Due**: contracts, warranties and vehicles with a date in the next 30
    days or already passed, overdue first and then soonest. The soonest real
    deadline is always the first row; setup and tidying items no longer sort
    above it.
  - **Housekeeping**: documents waiting in the Inbox, records missing key
    details, contracts with a cost but no billing frequency, unconfirmed
    auto-filled details, failed reminders and the "reminders aren't
    configured" prompt. Each only appears when there's something to do.

  Rows no longer offer "Upload document" as their main action; a missing
  document is a small "No document" badge instead. Expiring contracts offer
  "Renew or cancel", which opens the contract with its renew and cancel
  options, rather than "Renew policy" opening the edit form. An expiring
  warranty has no action button, since there's nothing to do but know.

### Removed

- The mobile navigation drawer (`MobileNavDrawer`), its menu button and
  its left-edge swipe; the bottom bar's More sheet replaces it (#407).
- Search's "Missing reminder" and "Missing link" filters. A blank Reminder
  threshold means the household default and linking is optional, so
  neither was a real gap (#395).
- **Snyk CI checks.** The Snyk Security workflow (Open Source, Code and
  Container scans) and its `.snyk` policy file are gone. Docker Scout stays
  as the container scan that blocks on critical and high CVEs, and CodeQL
  still covers code scanning.

### Fixed

- **Wealth: net worth adds up, and crypto is priced from CoinGecko (#404).**
  The Wealth page shows the total above a plain list of every part of it
  (shares/ETFs/crypto, Property, Items), so the figures always sum to the
  total; Items were counted but had no tile. Anything left out (a holding
  with no price or exchange rate, or a portfolio, property or item with no
  exchange rate) is named in a note under it.
  - Crypto routing is keyed on the Holding's asset class (falling back to an
    exchange of CRYPTO) in one `isCryptoHolding` helper, used by live
    prices, price history, the Trade-date market-close backfill and the
    Trade form's close hint. Before, a CRYPTO "BTC" with a blank exchange
    went to Yahoo, where BTC is an ETF, and showed USD 35.89 at -99.9%.
  - CoinGecko looks a ticker up as a coin ID and as a symbol and takes the
    coin with the larger market cap (`ids=dot` alone is an obscure "Dot", not
    Polkadot), then remembers which lookup won. Misses and rate limits are
    cached for the price TTL, keeping the last good price until it is a day
    old (counted from when it was fetched, not from the last failed retry).
  - Crypto prices are cached under their own key, so a BTC ETF and BTC the
    coin are priced separately; a price cached from the wrong feed is never
    used, and stored Yahoo history and market closes aren't shown for crypto.
    The scheduled price refresh deletes CoinGecko rows cached before this
    under the bare ticker.
  - CSV import creates a crypto Holding only when the generic format's Asset
    Class or Exchange column says so. The ticker alone isn't enough: BTC,
    ETH, SOL and others are also listed ETFs and shares.
  - Cost basis converts each BUY from its own currency into the
    portfolio's (the Trade's AUD rate when entered, else today's rate, which
    the Holding page then notes), and gain/loss converts the price too.
    SELL, SPLIT and DIVIDEND Trades don't need a rate. A holding with no
    price shows "No price", one missing a rate "No exchange rate"; neither
    is counted or given a gain/loss. A portfolio's cost, value and gain/loss
    tiles all cover the counted holdings, with the cost of any left out
    shown under the cost. A holding card priced in another currency also
    shows its value in the portfolio's. The Trade form's rate field is now
    labelled "AUD per 1 unit of trade currency", and its "Use" market close
    also sets the Trade's currency to the quote currency.
- **Layout at phone and 1280px widths (#403).** Filenames no longer squeeze
  to a few characters in the document lists (contract, product, and the
  item/home/vehicle/rental-statement/trip-segment siblings): below `sm` the
  filename gets its own line with the size/date metadata under it. Inbox
  rows no longer slide under the type select, and long sender addresses
  wrap. The document-type and contract-list filter selects fill their
  wrappers again, so the chevron sits on the control instead of floating at
  the card edge. Holding-card and spend-tile amounts wrap inside their boxes
  instead of overflowing — the currency code joins the amount with a
  no-break space, making it one unbreakable word — and the financial-year
  actuals table separates its amount columns. The preferences grid is two
  columns so the longest date-format label shows whole, and contract cards
  keep even heights with a two-line category slot and a one-line price.
- **Assistant updates change only the fields they name (#420).** Updating a
  Contract or Warranty through the Assistant used to parse the change as a
  full record, so fields it didn't mention fell back to their defaults: a
  cost-only change unticked tax-deductible and reactivated a cancelled
  Contract. Update proposals now carry only the named fields, the
  confirmation card lists exactly those (under the record's current name),
  and the write is a partial patch. An end date before the saved start date
  is refused when the proposal is made, not only on confirm. Create
  proposals are unchanged. The card also shows dates as calendar dates and a
  linked Property or Vehicle by name, and the Assistant can no longer link a
  record to a Property or Vehicle while that module is off.
- **Due labels and dates follow your date format, and stay on their day
  (#422).** Badges and banners such as "Cancel by 4 Nov" now read in the
  Date format chosen in Settings → Preferences ("Cancel by Nov 4" for
  MM/DD/YYYY, "Cancel by 2026-11-04" for YYYY-MM-DD) on the lists,
  dashboard, Needs attention, Upcoming, detail pages and the Assistant's
  confirmation card. The Due policy now returns each label as a key and its
  parameters, and the screen formats it; its plain labels, and the shared
  Due cases, are unchanged. Calendar dates (end dates, expiries, purchase
  dates and so on) are stored at UTC midnight and now always read as that
  day: on a server or browser west of UTC, a 1 Dec end date could show as
  30 Nov. The same goes for the financial-year totals and the Spend
  timeline's month and year bars. Dates are built from one English month
  table rather than the runtime's locale data, so the server and the
  browser always render the same text, badges and date fields agree
  ("Sep", never "Sept"), month names stay English on Upcoming whatever the
  Region, and day counts are plain digits. Moments in time, such as when a
  document was uploaded or a Reminder sent, show in your own timezone.
  Preferences' timezone now starts with "Household default"; a member who
  never picked one (stored as "UTC", the old default) follows the
  household's timezone, and choosing UTC itself is now honoured.
- **Records in Trash stay read-only, and so does everything under them
  (#428).** An offline edit replayed after the record was trashed on another
  device could add a Service record to a Vehicle in Trash, or a segment to a
  Trip in Trash, and a Service record could be restored while its Vehicle
  was still in Trash. Now an edit to a Vehicle or Trip in Trash, and an add
  or edit under one, is refused as not found (offline sync lists it as a
  failed change), as Properties already were. Restoring a Service record,
  Maintenance record or Document while what it belongs to is still in Trash
  says "Restore the vehicle first." (or the trip, or the property), and a
  Document can't be added, or starred, under a record in Trash. Flight-status
  and flight-distance lookups skip segments of a Trip in Trash without
  calling AviationStack. The Trash check and the write can no longer be
  split by a move to Trash from another request: updates carry the rule in
  their guarded write, and creates, restores and Document writes check and
  write in one transaction (a refused Document's saved file is removed).
  Deleting, restoring and permanently deleting from Trash work as before.
  One shared rule in `src/lib/commands/shared.ts` now backs the Vehicle,
  Trip, Property, Wealth and Document commands and the Property/Vehicle
  link check.
- **Adding a Holding no longer hangs the app (#432).** Its price-history
  backfill wrote one row at a time from four parallel workers, and the
  database connection serialises every query, so other requests (session
  lookups included) timed out until it finished and the job processor
  logged "scheduled job processing failed" every 20s. History is now
  written in batches of 250 by a single writer that steps aside between
  batches, and fetched after the Holding page has been sent rather than
  while it renders, with a 15 s limit per Yahoo request. It reaches back up
  to 30 years, and fills in older prices when a Holding or Trade dates from
  before the history already stored; the chart says "Chart shows prices
  from …" when it starts after the first Trade. A job that hangs (a stalled
  S3 or SFTP upload) is now given up on before its lease ends and retried,
  so it no longer stops reminders, backups and other jobs; job-processor
  ticks no longer pile up behind a slow one; and a job that loses its lease
  on its last attempt is marked failed instead of blocking its type.
- **SQLite settings (#432).** One database client per process, with a 1 s
  busy timeout on every connection. The new `SQLITE_JOURNAL_MODE` setting
  is `DELETE` by default and can be set to `WAL` for a database on a local
  disk; don't use WAL on a NAS share or a Windows folder under WSL2. Under
  WAL each backup also checkpoints the WAL file, and the container
  entrypoint fixes the owner of `app.db-wal`/`app.db-shm`. README's backup
  and restore notes now cover copying the data directory safely.
- Linking a Tenancy to a Contract that another Tenancy already uses now
  says so ("That contract is already linked to another tenancy.") instead
  of failing with a server error, and a Contract in Trash can't be linked.
  The Contract picker on the Rental tab no longer offers either (#390).
- **Read-only members no longer see write controls (#400).** A READONLY
  member was shown, and could open, every Add, Edit, Delete and Upload
  control, only for the save to fail. They now see every record, Document,
  Due status and Reminder health read-out without the controls that change
  them: the dashboard's Add and Upload and its Needs attention actions, the
  detail pages' Edit, ⋮ menu, banner actions and "Send test reminder", the
  Document star, delete and upload on every record type, the quick-add
  buttons for service records, maintenance, segments, rental agreements
  and statements, Wealth's holdings, trades and valuations, and the Inbox's
  classify fields, which show as plain text. Details still awaiting review
  show as plain text too, with Reminders on hold. Every create, edit and
  import page now redirects them to the record or its list. The dashboard
  says "You have read-only access." The server actions still enforce the
  role. The document extract endpoints, which only checked for a session,
  now refuse read-only members with a 403, as `/api/sync` does, so they
  can't spend the household's OCR or AI budget. Viewing a trip no longer
  refreshes flight status for them.
- **Clearing an optional field on an edit form clears it (#413).** A
  blanked field (an end date, rego expiry, cost, notes, Reminder days, a
  linked property) used to keep its old value even though the save said it
  worked, on every record type and in offline sync. Edit forms now clear
  every field they submit blank, and anything worked out from it (Due
  entries, Reminders, Missing key details) follows. A blank cost clears to
  nothing rather than 0. Changes that only touch some fields, like
  extraction review or status changes, still leave the others alone. A
  link the edit form can't list (a warranty in Trash, a home or vehicle
  whose module is off, an exchange outside the usual list) stays selected,
  so saving doesn't drop it. Offline edits queued before upgrading replay
  with this clearing too, which is safe: each carries the record's
  `updatedAt`, so one made against an older version is refused as stale.
- Offline sync reads a queued form the same way the online form does: a
  ticked "Tax deductible" box no longer fails the sync, and a blank
  currency, asset class, cost method or occupancy falls back to the same
  default as online (#413).
- Two offline edits of the same record synced at the same moment can no
  longer both be applied: the "changed elsewhere" check now happens in the
  write itself, so the second is refused (#413).
- Permanently deleting a Contract, Warranty or Vehicle now removes its
  files before clearing its Reminder history, so a failure there can't
  leave files on disk with nothing pointing at them (#413).
- On phones, the floating camera button and "Choose file" pill no longer
  cover rows and buttons on the Dashboard and Documents pages (#401). Both
  are gone: "Take photo" now sits in the page header next to Upload on the
  Dashboard and every Documents tab, and still saves the photo to the Inbox.
  Documents also gets an Upload button in its header. Read-only members see
  neither button, and `/import` sends them back to Documents.
- The Documents Filed tab no longer says "No undefined documents yet." when
  nothing is filed but the Inbox has documents.
- Permanently deleting a property (from Trash, or when its 30 days run
  out) now also removes its Rental statement files from disk; only the
  database rows were removed before (#396).
- **"Next reminder" never shows a past date (#381).** The Reminder health
  card picked the largest unsent threshold even when its day had gone by,
  so a contract added late could show a "Next reminder" weeks ago. It now
  shows the next day a Reminder will really go out, or "On the next check"
  when a catch-up is waiting.
- **Renewed rego, insurance and service dates get Reminders again (#382).**
  Editing a Vehicle's dates (and extraction review, and a Contract's notice
  period or renewal type) never cleared the sent-Reminder log, so a renewed
  rego stayed silent. The log is now keyed by date, so a new date always
  starts fresh; Vehicles already stuck start working after the upgrade.
- **Notice periods now count.** A contract's notice period was collected
  but ignored, so reminders counted down to the end date — after the last
  day to cancel had already passed. For contracts with a notice period
  (other than fixed-term ones), reminders, the badge ("10d to give
  notice"), the expiry banner, the contract list and its "expiring" filter,
  dashboard counts, Needs attention, Upcoming and the iCal feed now work
  from the last day to give notice. Webhook payloads add `cancelBy` and
  `noticePeriodDays`; MCP and assistant contract data add `cancelBy`,
  `daysUntilCancelBy` and `daysUntilDeadline`, and MCP `upcoming_renewals`
  uses the deadline (#351, part 1 — auto-renew roll-forward follows with
  #353).
- Reminder emails described vehicle registration, insurance and service
  dates as contracts (#352).
- Signing in now returns you to the page that asked you to, limited to
  same-origin paths (#341).
- Escape closes the dashboard Add picker and focus is restored (#342).
- The app icon, service worker and map marker images load without a
  session (#343).
- Passkey sign-in is only offered when a passkey is registered (#344).
- The onboarding modules step can be completed without enabling a module
  (#345).
- "Look up product info" is hidden when barcode lookup is disabled (#349).
- The property map showed no tiles: CARTO now requires a key, so the
  default is OpenStreetMap (#338).
- Document delete confirmations said "This can't be undone" although
  documents go to Trash (#371).


## [0.19.2] - 2026-10-23

### Security

- **Dependency vulnerability sweep.** `npm audit` drops from 38 findings
  (6 critical, 19 high) to 3 low-severity entries in production
  dependencies (#340):
  - `next` 16.3.3 → 16.4.2: critical RCE in `next/og` `ImageResponse`,
    SSRF in Image Optimization, cache poisoning, and a further critical
    advisory against 16.0.0–16.4.0 that now blocks `next build`.
  - `nodemailer` 9 → 10: quadratic-time DoS in address parsing and a DNS
    cache cross-tenant credential leak.
  - `@capacitor/android` → 8.5.3: remote content could load at the app
    origin via the internal HTTP proxy path.
  - `yahoo-finance2` 3 → 4: drops the bundled `zod` 3, which carries a
    high-severity resource-exhaustion advisory with no fixed 3.x release.
  - `zod` → 4.6.7, `qs` → 6.16.1, `body-parser` → 2.4.0, `ip-address` →
    10.7.4, `@xmldom/xmldom` → 0.9.12, plus updated overrides for `hono`,
    `fast-uri`, `sharp`, `mysql2`, `proxy-addr`, `uuid`,
    `brace-expansion` and `source-map-js`.
  - `@modelcontextprotocol/sdk`, `prisma`, `@serwist/next` and
    `@libsql/client` brought up to date within their ranges.
  - Dev tooling: `vitest` 3 → 5 (critical prototype-pollution RCE in
    `tinypool`).
  - Docker image: base image repinned to Node 26.12.1 (`node:26-alpine`),
    fixing a critical out-of-bounds write and a high-severity TLS
    certificate host-mismatch validation issue in Node 26.8.1.

  The remaining low-severity entries come from `@simplewebauthn/server`
  9.x and don't apply to Hearth's passkey setup (no attestation is
  verified); the upgrade is tracked in #376.

## [0.19.1] - 2026-08-30

### Changed

- **In-app feedback simplified to a direct link.** The GitHub-API-backed
  feedback form (server action posting issues via a PAT) is replaced by a
  "Report a bug or suggest an enhancement" button on the Help page linking
  straight to GitHub's own bug/enhancement template chooser — no token, no
  server-side GitHub API call, and no admin configuration required.
  `GITHUB_FEEDBACK_TOKEN`/`GITHUB_FEEDBACK_REPOSITORY` and the feedback
  rate-limit rule are removed.

### Fixed

- **Warranty-to-property linking was undiscoverable when there was nothing
  to link to.** The Property picker on the warranty form was silently
  hidden whenever the household had zero properties, or the Property
  module was disabled, with no indication linking was even possible — it
  now shows an inline hint pointing to adding a property or enabling the
  module in each case (#239).

## [0.19.0] - 2026-08-29

### Added

- **Inventory items can link to a warranty product directly**, via a real
  foreign key (not a free-text ID) with a picker in the item form; a
  warranted product's detail page shows every inventory item registered
  against it (#241).
- **Field-level extraction review.** The one-click "Confirm details" action
  is replaced by a per-field editable view (value, source, confidence)
  whenever a document has pending extraction fields — a manual correction
  already made is never clobbered by re-confirming — falling back to the
  old one-click confirm for documents with no field-level rows (#331).
- **Import and Inbox review rows can link a filed contract/product to a
  home or vehicle at review time**, not only afterward via Edit (#327).
- **Completeness filters (missing date/reminder/identifier) now cover
  Vehicles and Inventory items**, with two new "missing info" dashboard
  stat cards linking into a narrower, non-noisy combined signal, and
  search results explaining why a record matched a filter (#328).

### Changed

- **Terminology.** Contracts/Products nav, headings, and page titles now
  read "Policies & contracts" / "Purchases & warranties"; Global Search
  recognizes both the old ("contract", "warranty") and new ("policy",
  "purchase") generic terms as "show me that whole section" (#332,
  supersedes #174).

### Fixed

- **`giflib`'s `CVE-2026-26740` (HIGH) actually resolved in the built
  image**, not just suppressed at the CI gate. The `only-fixed` Docker Scout
  exception added for this CVE in 0.18.0 (#256) turned out not to work:
  Scout still reports a fixed version exists upstream (`5.2.2-r2`), so
  `only-fixed` didn't exclude it — the gate kept failing on every build
  (#336). Alpine's `v3.24` stable repo still hasn't backported the fix as of
  2026-08-29, so the `Dockerfile` now pins `giflib` to `5.2.2-r2` from
  Alpine's `edge/main` repo specifically (soname-compatible with the
  `leptonica`/tesseract-ocr dependency that actually links it), alongside a
  routine base-image digest bump. Verified with a local `docker scout cves`
  scan: 0 critical/high/medium/low findings.
- **A contract card's swipe-to-delete action could be untappable on
  mobile.** The revealed delete button sat in normal document flow with no
  stacking context of its own, so for any card scrolled to where it visually
  overlapped the persistent bottom nav / upload FAB (both `fixed` at
  `z-30`), taps landed on the FAB instead — `SwipeableListItem` now lifts
  the row to `z-40` while swiped open.
- **E2E suite reliability**: Global Search's sidebar button opens its dialog
  via a client-only event listener that isn't wired up until React
  hydrates, so a test click landing right after navigation could silently
  no-op and time out waiting for the search input — the four affected specs
  now retry the click until the dialog actually opens. Also fixed a
  malformed hand-built PDF fixture (`30-camera-inbox-review.spec.ts`) with
  an invalid `endstream`/`endobj` boundary, and — the actual reason that
  spec's field-extraction assertions always saw an empty string —
  `e2e.yml` never installed `poppler-utils`/`tesseract-ocr` on the bare
  `ubuntu-latest` runner it runs `next dev` on, so every call into
  `textExtraction.ts`'s pdftotext/tesseract pipeline silently failed
  (by design — a missing binary must never block saving a document, so
  every failure mode there already collapsed to `""` rather than
  throwing). Those binaries are otherwise only installed inside the
  production Dockerfile's image, which this job never builds.

## [0.18.0] - 2026-08-27

### Added

- **Trash.** Deleting a contract, product, vehicle, property, trip, or
  inventory item now archives it to Settings → Trash with a 30-day retention
  window instead of deleting permanently, with restore and
  permanently-delete actions. Soft-deleted records are excluded from every
  surface — lists, detail pages, dashboard, the reminder scheduler, exports,
  calendar/iCal, global search, the MCP server's read-only tools, and the AI
  Assistant's chat tools (#287).
- **Configurable Wealth cost-basis method.** Each portfolio can now use FIFO
  (default) or average cost; cost basis is still computed from trade history
  on each view rather than stored (#275, #284, #301).
- **Household reminder delivery-health summary** in Settings, surfacing
  recent notification delivery status per channel (#292).
- **"Last changed by" attribution** on contracts, products, vehicles,
  properties, trips, and inventory items, including edits made through
  offline sync (#286).
- **Quick-create a pre-linked contract** directly from a property or vehicle
  detail page (#293).
- **Camera-first capture** from the mobile upload FAB (#299).
- **Upcoming view.** Calendar is now an "Upcoming" view with 30/60/90-day
  horizons (#288).
- **Optional AI egress-proxy support.** Document extraction and the chat
  Assistant's outbound calls to a configured AI provider can now be routed
  through [Pipelock](https://github.com/luckyPipewrench/pipelock), a local
  agent-firewall proxy that inspects traffic for secret exfiltration, SSRF,
  and prompt injection — a network-level complement to the existing
  prompt-level hardening. Opt-in via `AI_EGRESS_PROXY_URL` (#218, #219).
- **Dual-mode mobile apps.** The packaged iOS/Android apps can now run
  standalone — native SQLite-backed local storage, no server required — or
  connected to a self-hosted Hearth server, covering records, documents,
  search, Wealth, rentals, reminders, backups, and settings in both modes
  (#148, #214).
- **Durable, database-leased background job runner.** Reminders, backups,
  email ingestion, price refresh, and OCR now all run through one queue with
  atomic per-type dedup (a unique constraint claim, not a check-then-act
  race) and a lease that lets any instance pick up a stalled job — replacing
  four separate `cron.schedule()` registrations whose schedules were baked
  in at boot and couldn't pick up a Settings change without a restart.
  `/api/cron` now enqueues onto the same queue instead of running reminder
  checks directly (#250, #308).
- **Bounded Documents/Inbox browsing.** The Documents and Inbox pages now
  paginate instead of loading every row across all 9 document tables, inbox
  duplicate-hash lookups are batched into one query per table instead of one
  per row, and new indexes cover every high-frequency owner/date/status
  filter (#252).

### Changed

- **Document storage consolidated behind a shared `DocumentStore`.** All 9
  document kinds (contracts, products, trips, home, vehicles, rental
  statements, inventory, inbox, trades) now go through one class instead of
  9 near-duplicate save/read/delete implementations, with a reconciliation
  pass that flags orphaned files and DB rows pointing at missing files
  instead of failing silently (#251).
- **PDF and CSV exports now stream** instead of buffering the full result in
  memory before sending it.
- **Terminology unified** across the nav, dashboard, and module labels
  (#289).
- **Household-wide record visibility is now disclosed** at capture time and
  on record detail pages, rather than being implicit (#285).
- **Member-management roles are now explained** at assignment and removal
  time (#291).
- **The Docker Scout CI gate no longer blocks on `CVE-2026-26740`**
  (`giflib`, from the `node:26-alpine` base image), since Alpine has not
  shipped a fix and no `package.json` override can reach a base-image
  package — the finding is now an acknowledged exception rather than a
  perpetual red build (#256).

### Fixed

- **`/api/sync` could create duplicate records on a replayed or concurrent
  request** — offline devices replaying a queued operation after
  reconnecting, or two tabs syncing at once, could each create their own
  copy of the same record. Each operation now claims an idempotency receipt
  (a unique-constrained insert, not a check-then-act query) before it runs,
  so a retry of an already-applied operation is a no-op (#249).
- **A wrong-owned database file wasn't auto-repaired** — the startup
  ownership check only inspected the data directory's own uid, so a
  correctly-owned directory with a wrong-owned `app.db` inside it (e.g. from
  a `docker cp` done as root, or a restored backup) skipped the repair
  entirely and surfaced a raw Prisma stack trace instead of the actionable
  error the directory case already gave (#223, #224).
- **Expiry badges wrapped onto two lines**, and long unbreakable content
  (e.g. a long contract title in the dashboard's Needs Attention queue)
  could inflate the whole page shell past the viewport, on mobile.
- **Needs Attention row titles truncated unreadably** on mobile — the badge
  and action buttons competed with the title for the same line.
- **WCAG contrast, region/locale, and color-only auto-fill signaling**
  fixes; auto-filled fields now pair color with text and an "Auto" badge
  (#290, #295, #302).
- **Dashboard spend notice, list summary chips, and search
  accessibility/coverage bugs** (#294, #296, #300, #303, #305, #306).
- **The bulk-import review gate and an extraction-overwrite bug** where
  re-scanning a document silently discarded a user's prior correction
  (#284, #301).
- **Destructive confirm dialogs lacked a focus trap.** Added a shared
  focus-trap `Dialog` primitive, used by every destructive-confirm dialog
  (#297, #298).
- **Seven high-severity CVEs in transitive dependencies.** `mailparser` moves to
  3.9.16, which pins `html-to-text` 10.0.1 and so pulls `deepmerge-ts` off the
  vulnerable 7.1.5 (uncontrolled recursion) onto 8.0.2 — this one is reachable
  with attacker-controlled input, since `simpleParser` runs `html-to-text` over
  incoming email bodies on the ingestion path. `browserslist` is pinned to
  ^4.28.8 (prototype pollution, unthrottled allocation) and `fast-uri` to
  ^3.1.6 (four URL-parsing CVEs) — note the previous `fast-uri` override pinned
  the exact version that later became vulnerable, so it's now a range. Prisma
  pulls a second copy of `deepmerge-ts` through `@prisma/config`, which depends
  on exactly 7.1.5; a scoped override lifts that path to 8.0.2 as well, since
  the advisory is only fixed in 8.x and no current Prisma release has moved off
  7.1.5.
- **Docker Scout flagged `nanoid` 3.3.17 (CVE-2026-67213)** — an infinite-loop
  denial of service, fixed upstream in 3.3.18. It reaches the image as a
  build-time transitive of `postcss` (via `@tailwindcss/postcss`), so it's
  pinned through the existing `overrides` block rather than a direct
  dependency bump. `postcss` accepts `^3.3.16`, so the pin needs no other
  change.
- **Invitation/password-reset email links pointed to `http://localhost:3000`
  when `APP_URL` wasn't set** (#227). Inviting a user now fails loudly with an
  actionable error instead of silently sending a broken link; a warning also
  shows in Settings next to SMTP config when `APP_URL` isn't configured.
- **Deleting a Wealth portfolio or holding orphaned its trade documents**
  (#233). `deletePortfolio`/`deleteHolding` (and the equivalent offline-sync
  handler) now clean up each trade's document directory before the Prisma
  cascade removes the DB rows, matching the pattern already used for
  contracts/vehicles/properties/trips.
- **No way to reach previous chats in Assistant on mobile** (#234). The
  thread list was a desktop-only sidebar (`hidden md:block`) with no mobile
  equivalent — added a "Chats" toggle that opens the thread list in a bottom
  sheet on small viewports.
- **Docker Scout CVEs in npm's own vendored dependencies** (#225). Chasing
  `npm install -g npm@latest` in the runtime image didn't reliably stay
  ahead of CVEs in npm's *own* bundled deps (tar, brace-expansion,
  ip-address, undici) — the runner image now strips the npm CLI entirely,
  since nothing at runtime needs it once `docker-entrypoint.sh` calls the
  local `prisma` binary directly instead of going through `npx`.
- **Inaccurate Contract field autofill for uploaded rental/lease agreements**
  (#228). Contract extraction only used generic invoice-shaped heuristics;
  it now also falls back to the lease-specific date/rent/tenant heuristics
  already used for Property rental agreements, filling in any fields the
  generic pass missed.

### Security

- **CSV/PDF exports could carry a formula-injection payload.** A cell value
  starting with `=`, `+`, `-`, `@`, tab, or CR is now prefixed with a single
  quote before being written to any CSV export, the standard mitigation
  against a cell executing as a formula when opened in Excel/Sheets/
  LibreOffice.
- **Defense-in-depth CSRF check for the REST API surface.** Server Actions
  (the app's primary write path) already get same-origin enforcement from
  Next.js itself; state-changing `/api/*` routes now get the equivalent via
  `src/proxy.ts`, rejecting a request whose `Origin` header names a
  different host than it was sent to.
- **A new Security log** (Settings → Security, admin-only) records
  auth-relevant events — failed and throttled sign-ins, password/role
  changes, two-factor disablement, and account removal — so the household
  has an audit trail beyond scattered console output.
- **AI usage is now capped per day, not just per 5-minute burst window**, on
  both document extraction and chat, bounding total daily third-party API
  load/spend even across many separate burst windows. The one extraction
  route that had no rate limit at all (re-extracting from an already-scanned
  inbox document) now has one too.

## [0.17.0] - 2026-08-04

### Added

- **In-app feedback** (#196). Authenticated household members can report a bug or
  suggest an enhancement from Help & FAQ; configured GitHub Project automation
  routes the resulting labeled issue into the review queue.
- **Docker Scout CVE scanning in CI** (#216). A new workflow builds the image on
  every push/PR to `main` and blocks on critical/high-severity findings,
  reusing the existing `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets — no new
  configuration needed. Complements the existing Snyk container scan with
  Docker Hub-native findings and base-image update recommendations. Skipped
  entirely (same as Snyk) when the Docker Hub secrets aren't configured, so
  forks aren't left with a permanently red check.

### Security

- **LLM prompt-injection hardening** (#215). Document AI-extraction (BYOK cloud
  providers and the local Ollama fallback) now prefixes every extraction prompt
  with an explicit notice that the attached document/text is untrusted,
  user-supplied content to extract fields from, not instructions to follow.
  Extracted field values over 300 characters — well beyond what any legitimate
  title, date, amount, or name needs — are now dropped rather than passed to
  the review form. The household chat assistant's system prompt got the same
  treatment for tool results and record data. Chat writes were already gated
  behind an explicit user confirmation card before this, so this closes the
  content-manipulation gap rather than a write-authorization one.

## [0.16.0] - 2026-08-02

### Added

- **Copyable identifiers on detail pages** (#209, #210, #211). Policy
  numbers, serial numbers/barcodes, VIN and license plate, and flight/
  confirmation codes now have a copy-to-clipboard button, from one shared
  detail-field component reused across contracts, warranties, vehicles,
  and travel instead of duplicated per page. Module setup and Settings >
  Modules now also state that records are visible to the whole household,
  not just the person who added them.
- **Important flag, completeness filters, and search filter chips**
  (#205, #207, #208). Documents on a contract or product can be starred
  Important for quick retrieval later. The Contracts and Products list
  pages gained filter chips for Expiring soon, Expired, Needs review, and
  Missing document. Global search gained matching filter chips (plus
  Important), so a record can be found by state even without remembering
  its name.
- **Inbox duplicate detection and status filters** (#199, #206). Documents
  in the inbox are now tagged Needs classification, Needs review, Extraction
  failed, or Possible duplicate, with filter chips to jump straight to any
  of them. A likely duplicate (identical file content to something already
  filed) shows what it matches, with options to attach it as a new version,
  keep it as a separate document, or discard it. A contract's document list
  now groups re-uploads into a version history instead of listing them as
  unrelated files.
- **Never lose an upload** (#203). If a document can't be attached to a
  new contract or product for some reason, it's saved to the Documents
  inbox instead of silently disappearing, with a banner on the record
  pointing there. Global search now also finds documents still sitting in
  the inbox.
- **Reminder health** (#201). Contract, product, and vehicle detail pages
  show a Reminder health card — whether a reminder is enabled, the next
  reminder date, thresholds, delivery channel and status, last sent, last
  failure, and a "Send test reminder" action. The dashboard's needs-attention
  queue now also surfaces records with a failed reminder delivery.
- **Extraction confirmation** (#200). When a document scan auto-fills
  critical fields on a contract or product, saving without confirming them
  marks the record "Needs review" and holds its reminders until confirmed —
  either by checking "these look correct" on the form, or via a standalone
  "Confirm details" action on the detail page and dashboard.
- **Email ingestion** (#195). Configure an IMAP mailbox in Settings → System
  settings and forward or email a document to it — Hearth polls it on a
  schedule, guesses what type of document each attachment is (Contract,
  Product, or Inventory item) from the same heuristics already used for
  manual uploads, and drops it in the Documents inbox pre-classified for
  review. Nothing is ever filed without a human confirming it first;
  attachments are validated by content (not the claimed MIME type), same as
  every other upload path (#165).

## [0.15.0] - 2026-08-01

### Added

- **Dashboard is now a "needs attention" queue** (#170). The four separate
  expiring/expired card grids (contracts, warranties) plus the vehicle
  section are replaced by one urgency-sorted list, each row already carrying
  its next action (upload document / renew / mark cancelled) instead of
  leaving that to the reader. Stat cards link through to pre-filtered
  Contracts/Products lists rather than sitting inert.
- **Document inbox is a first-class workflow** (#171). `/documents` and
  `/documents/inbox` share an Inbox/Filed/All tab strip, so unfiled uploads
  read as one workflow instead of a side area reachable only via a small
  pill. Inbox rows also flag a contract missing its provider before you try
  to save it.
- **Mobile capture is a primary action** (#173). Documents is promoted into
  the primary bottom-nav slot (over Calendar), and a persistent one-tap
  upload FAB is reachable from any page — hidden on `/import` itself and on
  `/new`/`/edit` form routes, where it would otherwise cover the submit
  button.
- **Detail pages surface what needs doing** (#176). Contract and product
  detail pages show a status banner when the record is overdue or expiring
  within 30 days, with the renew/upload action already picked out.
- **Sparse lists get a summary and a real empty state** (#177). Contracts and
  Products list pages show an at-a-glance strip (expiring soon / expired /
  added this week), and the empty state offers "Add" and "Upload a document"
  actions instead of plain text.
- **Help & FAQ menu** (#191). A new `/help` page answers common questions
  (modules, invites, roles, AI extraction and privacy, notifications,
  backups, passkeys/TOTP, offline mode, troubleshooting), linked from the
  sidebar, mobile drawer, and bottom-nav "More" sheet next to Settings.

### Changed

- **Settings reorganized into user-facing categories** (#175). `/settings/app`
  is grouped into Notifications / AI and privacy / Advanced system settings;
  the `/settings/household` hub shows status summaries (member count, backup
  destination, webhook count, module count, notification status) instead of
  bare links; backup destination configuration is consolidated into
  `/settings/backups` rather than split across two pages.
- **Document extraction messaging is honest about confidence** (#172).
  Low-confidence results no longer contradict themselves; auto-filled fields
  are now visually distinguished as heuristic-matched (accent) vs
  AI-suggested (info), in both the contract form and the inbox review UI. A
  privacy notice now appears when a cloud AI provider is selected for
  extraction or the Assistant, naming which provider documents/data are sent
  to.

### Fixed

- **The dev-mode build-indicator badge no longer leaks into the app or its
  screenshots** (#178). It served no purpose in this UI and previously
  overlapped the sidebar account email in every published screenshot; it's
  now disabled at the Next.js config level rather than worked around per
  capture.

## [0.14.0] - 2026-07-31

### Breaking Changes

- **Existing iCal feed URLs stop working and must be regenerated** (#163).
  Feed tokens are now stored as a SHA-256 hash, so the plaintext values the
  migration found can't be converted and are cleared. Each user regenerates a
  feed from Settings; the new URL is shown once, at generation, and can't be
  displayed again.
- **Outstanding password-reset and invitation links are invalidated** by the
  same migration (#164) — those tokens are hashed now too. Affected users
  request a new link; the old ones expire within hours/days regardless.
- **Changing a password now signs out every session for that account**,
  including the one making the change (#168). That's the point: an attacker
  holding a stolen session is evicted. Users are redirected to /login with an
  explanation.
- **The Android app no longer connects over plain HTTP**, except to
  `localhost`, `*.local` and `*.home.arpa` (#166). Reaching a server by bare
  LAN IP over `http://` — e.g. `http://192.168.1.50:3000` — now fails, because
  Android's network security config can only allow-list domain suffixes, not
  IP ranges. Serve Hearth over HTTPS (a reverse proxy with a real certificate,
  a mesh VPN such as Tailscale, or a private CA imported from the connect
  screen), or reach it by an mDNS `.local` name. iOS already enforced this via
  App Transport Security. Android cloud backup and device-to-device transfer
  are also disabled now, so the stored server address, session cookie and any
  imported client certificate can't leave the device.

### Fixed

- **Household records are now genuinely household-wide** (#151). Several paths
  still enforced per-user ownership through `createdById`, so a member could
  see a record in the UI and then be refused when acting on it:
  - Editing or attaching a document to an inventory item created by another
    member returned "Item not found."
  - The calendar and the iCal feed only listed rows the viewing user had
    created, so each member saw a different, silently incomplete calendar.
  - Offline edits replayed through `/api/sync` were rejected for contracts,
    products, inventory items, properties, portfolios and holdings created by
    anyone else — the record synced fine for its creator and failed for
    everyone else.
  - Trade documents 404'd for members who didn't create the portfolio.

  `createdById` is retained on these rows purely as audit metadata and is no
  longer consulted for authorization. Chat threads remain private to their
  creator, unchanged.

- **The iCal feed was unreachable by actual calendar clients** (#163).
  `/api/ical` wasn't listed as a public path, so any request without a session
  — i.e. every calendar app — was redirected to `/login` instead of receiving
  the feed.

### Security

- **The container no longer runs as root** (#160). The app process runs as the
  unprivileged `node` user (uid 1000). The entrypoint still starts as root
  purely to adopt ownership of `/app/data` — earlier images ran everything as
  root, so an existing deployment's `./data` is root-owned on the host and
  would otherwise become unreadable on upgrade — then drops privileges with
  `su-exec` before running migrations or the server. That adoption is
  automatic and one-time; no action is needed on upgrade. Operators who prefer
  the container never to hold root can set `user: "1000:1000"` in
  `docker-compose.yml`, having first run `sudo chown -R 1000:1000 ./data`.
- **Base image and GitHub Actions are pinned by digest** (#160). `node:22-alpine`
  is now referenced by its multi-arch index digest, and all 12 workflow actions
  by commit SHA rather than a moving tag — whoever can move a tag can otherwise
  change what CI runs.
- **High-severity Snyk findings now block CI** (#160). Every step in the Snyk
  workflow carried `continue-on-error: true`, so it reported findings but could
  never fail. Dependency, code and container scans now gate on high severity;
  `monitor` and IaC steps stay non-blocking since they publish state rather
  than assert anything. The job is skipped entirely when `SNYK_TOKEN` isn't
  configured, so forks don't get a permanently red check.
- **Published images carry an SBOM and SLSA build provenance** (#160), via
  buildx's native attestations — inspect with
  `docker buildx imagetools inspect jaysbeekay/hearth:latest`.
- **Debug APKs are no longer published** (#160). A tagged build with no signing
  secrets configured used to fall back to attaching the *debug* APK to the
  public GitHub Release — an artifact signed with the universal Android debug
  key, which anyone can modify and re-sign, and built debuggable. Tagged builds
  without signing configured now fail loudly instead, and debug APKs are built
  only on manual `workflow_dispatch` runs.
- **Rate limiting, where there was none** (#155). Failed sign-ins, TOTP codes,
  recovery codes, password-reset requests and passkey challenge issuance are
  now throttled, along with the cost-bearing document-extraction and chat
  endpoints. Auth limits count failures only, keyed by account *and* client
  address, so guessing at one account can't lock out the household and a
  shared NAT egress doesn't either. In-memory and dependency-free: counters
  reset on restart and aren't shared across replicas, which is the right
  trade for a single-container deployment but is worth knowing.
- **Uploads are validated by content, not by the type the client claims**
  (#165). `file.type` is caller-controlled, and it decided whether a file was
  accepted, which extraction pipeline ran over it, and what Content-Type it
  was served back with. Leading bytes are now sniffed at both choke points —
  every `save*` in storage.ts and all eight extract routes. `/api/sync` also
  gained an aggregate body cap and a 200-operation limit; the per-file 15MB
  cap never bounded a request carrying many files.
- **Administrator-configurable outbound destinations are checked** (#167).
  Webhook, ntfy and Ollama URLs are validated before each request against the
  two things that are never legitimate from this app: a non-HTTP(S) scheme,
  and the cloud instance-metadata addresses (`169.254.169.254` and the
  equivalents for ECS, Alibaba, Oracle and AWS IPv6), including their
  IPv4-mapped IPv6 spellings in both dotted and hex form.

  Everything else is permitted, deliberately. Bare IP addresses and local
  hostnames are supported destinations, not suspicious ones —
  `http://192.168.1.50:8123`, `https://homeassistant.local:8123`,
  `http://ntfy:80`, `http://host.docker.internal:11434` and
  `http://localhost:11434` all work, as do link-local/APIPA and
  carrier-grade-NAT addresses. A hostname that doesn't resolve is also
  allowed through rather than refused: `.local` names need mDNS the runtime
  image doesn't have, and a service may simply be down when its webhook is
  saved. Operators with no local integrations can set
  `BLOCK_PRIVATE_NETWORK_TARGETS=true` to refuse local destinations too.
- **`importTrades` validated its input at compile time only** (#162). It took
  a `ParsedTrade[]` straight from the client with no runtime check, so NaN or
  Infinity units/prices reached the database and poisoned every downstream
  FIFO cost-basis calculation, and `type` was cast to an enum it was never
  checked against. It's now parsed with Zod, with finite-number and row-count
  limits. Chat history sent to the provider is capped at the most recent 60
  messages rather than the entire thread, and CSV imports are bounded at 5000
  rows.
- **Sessions are revalidated against the database on every read** (#168).
  Previously the role was copied into the JWT at sign-in and never revisited,
  so a demoted account kept admin rights — and a deleted account kept working
  entirely — until its token expired. A `sessionVersion` counter on User,
  bumped on password and role changes, invalidates outstanding tokens.
- Password-reset, invitation and iCal tokens are stored as SHA-256 hashes
  rather than in the clear, and are now 256-bit random values instead of
  UUIDs (#163, #164).
- Webhook signing secrets are encrypted at rest with `ENCRYPTION_KEY` (#164).
  Rows written before a key was configured keep working and are upgraded by a
  startup backfill once one is set.
- A missing `ENCRYPTION_KEY` now warns loudly at startup in production, and a
  malformed one fails fast at boot instead of at the first decrypt (#164).
- `NTFY_TOPIC` no longer defaults to `hearth-changeme-a1b2c3` in
  docker-compose (#164). Topics on the public ntfy.sh instance are
  world-readable, so a shared default meant anyone who guessed it received the
  household's reminders. Push stays off until a topic is set.
- The iCal feed sends `Cache-Control: no-store` and `Referrer-Policy:
  no-referrer`, keeping its token out of shared caches and Referer headers
  (#163).
- The unauthenticated redirect no longer copies the original query string onto
  `/login`, which had echoed bearer tokens into the login page's URL and
  history (#163).
- Added Content-Security-Policy (nonce-based, with `strict-dynamic`),
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and — on HTTPS requests only — HSTS to every response
  (#159). Served from `src/proxy.ts`, which now supplies its own
  unauthenticated redirect: NextAuth skips its `authorized` callback's redirect
  once a handler is present.
- First-run setup can be gated behind a new optional `SETUP_TOKEN` env var
  (#169). Until the first account exists, `/setup` is reachable by anyone who
  can reach the server, and whoever submits it first becomes the
  administrator; setting `SETUP_TOKEN` closes that window. The "no existing
  users" check also moved inside the write transaction, so two simultaneous
  requests can no longer both create an admin.
- `APP_URL` is now checked at startup and logs a warning in production when it
  isn't HTTPS (#166).
- Two published screenshots (`settings-totp-setup.png`,
  `settings-totp-codes.png`) exposed a scannable TOTP QR code, its manual
  secret, and eight recovery codes (#178). Both came from a throwaway
  scratch database, so nothing real was exposed, but they're regenerated
  with the QR, secret and codes all redacted, and without the development
  overlay that appeared on every screenshot in the set.

### Changed

- **One user-facing name per section** (#174). The warranties area called
  itself "Products" in its page title, heading and the Documents filter while
  the navigation said "Warranties"; it now says "Warranties" everywhere. The
  `/products` route, the Prisma model and the component names are unchanged —
  renaming those would break bookmarks and stored offline queues for no user
  benefit.
- **Date fields show the household's date format** (#174). A native date input
  is drawn by the platform and always uses the *browser's* locale, so a
  household set to DD/MM/YYYY still saw `07/29/2026` in every form while the
  rest of the app showed `29 Jul 2026`. Date fields now echo the chosen value
  underneath in the household's own format. The picker itself still follows
  the browser — that isn't something an attribute or CSS can change — but what
  you picked is no longer ambiguous.
- **Amounts show their currency code where a view can mix currencies** (#174).
  `Intl` already spells out non-local currencies, but the household's own
  currency collapsed to a bare `$`, which doesn't say which dollar it is. The
  Wealth pages and /spend — the views that can genuinely show several
  currencies at once — now render `AUD 1,234.50` rather than `$1,234.50`.
- Vercel no longer attempts to build this repository. `vercel.json` sets
  `git.deploymentEnabled: false`, and the README explains why serverless
  hosting isn't a target: the SQLite database, uploaded documents,
  `node-cron` schedulers and the `pdftotext`/`tesseract` extraction pipeline
  all need a long-lived process with its own disk. The deployment had been
  failing on every pull request — including ones that changed nothing but
  PNG files — which made the whole checks list easy to ignore.
- **`jaysbeekay/hearth:latest` on Docker Hub now only moves on a real
  release.** `docker-publish.yml` previously also ran on every push to
  `main` and tagged that build `latest`, so self-hosters pulling `:latest`
  got whatever had most recently merged — including in-progress or
  breaking work — rather than what a tagged version and its CHANGELOG
  entry actually describe. The workflow now runs only on a `vX.Y.Z` tag
  push (or a manual dispatch against one), tagging the image both `latest`
  and `vX.Y.Z` together.

- Setup screen's module checklist now lists Travel last, after Wealth, instead
  of first (#119). Also added a permanently-checked, disabled "Document
  management" row above the optional modules, clarifying that contract/
  warranty/document tracking is always included and isn't one of the
  toggleable modules — it isn't submitted as part of the form.

## [0.13.0] - 2026-07-30

### Breaking Changes

- **`Property.address` (a single free-text string) is replaced by structured
  `street`/`suburb`/`state`/`postcode`/`country` fields** (#128). Existing
  addresses are preserved by the migration — the full original text is
  copied into the new `street` field rather than parsed into the other
  parts, since address formats vary too much by country to split reliably.
  Re-pick a property's address via the autocomplete to populate the other
  fields precisely. Anything reading `property.address` directly (custom
  scripts, direct DB queries) will need to switch to the new fields or the
  new `formatPropertyAddress()` helper (`src/lib/utils.ts`).
- **AI document extraction and AI Assistant provider/API key/model are now
  household-wide settings, not per-user.** Previously each household member
  configured their own BYOK provider independently; now there is one shared
  configuration for the whole household, managed on System settings
  (`/settings/app`) by an admin, the same way SMTP/S3/Ollama/etc. already
  work. A migration copies any existing per-user configuration into the new
  household-wide setting (preferring an admin's config if more than one
  member had configured one) before dropping the now-unused `User` columns
  (`aiProvider`, `aiApiKeyEncrypted`, `aiModel`, `chatProvider`,
  `chatApiKeyEncrypted`, `chatModel`). Non-admin members can no longer
  configure their own provider/key — ask a household admin instead.
- **`INSURANCE` and `REGISTRATION` removed as vehicle item types** (#144) —
  redundant now that a vehicle can link directly to an insurance Contract
  (#143), with proper renewal/billing/reminder tracking. Existing
  `VehicleItem` rows of those two types are **automatically recoded to
  `OTHER`** by the migration, with the original type preserved as a
  `[Insurance]`/`[Registration]` prefix in the record's notes so nothing is
  silently relabeled without a trace. Any external tooling or exports that
  depended on those two type values will need to be updated.

### Added

- **Vehicles can now link to a Contract** (#143) — a new optional "Vehicle"
  field on the contract form (shown only when the Vehicles module is
  enabled and at least one vehicle exists), and a "Contracts & warranties
  linked to this vehicle" section on the vehicle detail page, mirroring the
  existing Property↔Contract linking (#114).
- A shared `BackLink` component, added to every "add a record" page that
  was missing a way back to the record/list it was launched from (#145):
  contracts/new, products/new, vehicles/new, vehicles/[id]/items/new,
  home/new, home/[id]/items/new, travel/new, and
  travel/[id]/segments/new.
- A warning next to the SMTP/ntfy/Ollama "Test connection" buttons in
  System settings clarifying they test the currently *saved* settings, not
  unsaved form edits (#122).
- A new **Household & System** page (`/settings/household`, admin-only)
  gathering every household-wide settings entry point (Manage household
  members, Database backups, Webhooks, Modules, System settings) in one
  place, separate from the personal Settings page.
- **Property occupancy status** (#129) — a new "Occupancy status" field
  (Owner-occupied / Rented / Vacant / Other) on the property form, settable
  at creation time instead of only discoverable via the separate rental
  tracking flow. Selecting "Rented" shows a prompt linking to rental
  tracking setup (or to the existing overview, if already set up) — this
  is additive and doesn't change how `isRented`/rental agreements work.
- **Local filesystem backup destination, and backups now use a single
  destination picker** (#137) — System settings now has one "Backup
  destination" dropdown (Local filesystem / S3-compatible storage / SFTP)
  instead of three independently-configurable sections; choosing a
  destination reveals only that destination's configuration fields, and
  only the chosen destination runs. OneDrive (also requested in #137)
  needs an OAuth-based upload flow and is deferred as a follow-up — #137
  stays open to track it.
- Preview/quick-view for product documents (#142) — previewable documents
  (images, PDFs) on a product's detail page now open in the same inline
  preview modal the Documents page already has, instead of only
  downloading/opening in a new tab. The shared modal was extracted into
  `src/components/DocumentPreviewModal.tsx` so both pages use one
  implementation.
- A worked ntfy.sh example in `docker-compose.yml`/README (#138): a
  concrete example topic with a note that public ntfy.sh topics are
  guessable and should be unguessable or token-protected, plus a
  commented-out self-hosted `binwiederhier/ntfy` service block.
- **Expiring invitation email for new household members** (#126) — with SMTP
  configured, adding a household member now sends a single-use invitation
  link (expires in 48 hours) instead of the admin choosing a password
  directly; the new member sets their own password on `/accept-invitation`.
  Without SMTP configured, admin-set passwords still work exactly as
  before. Reuses the existing password-reset token model with a new
  `purpose` field (`RESET`/`INVITE`) rather than a parallel table.
- **Optional "Sign in with GitHub"** (#116) — set `GITHUB_CLIENT_ID`/
  `GITHUB_CLIENT_SECRET` to show a GitHub sign-in button on the login page.
  Sign-up stays invite-only: a GitHub sign-in only succeeds for an email
  that already has an admin-invited Hearth account, matched by verified
  email — it never auto-creates an account. Existing TOTP/passkey
  second-factor and role model are unaffected, since GitHub sign-in is
  just a different way to establish the same session.

### Changed

- Property address is now entered as separate Street/Suburb/State/Postcode/
  Country fields instead of one free-text field (#128), still driven by the
  same OpenStreetMap autocomplete — picking a suggestion now populates all
  five fields. The Label field auto-fills from the suburb when left blank
  and a suggestion is picked (only if Label is still empty, so it never
  overwrites something you've already typed).
- The property map now loads tiles from CARTO's free basemap service
  instead of OpenStreetMap's own raw tile server, which its usage policy
  reserves for light/evaluation use rather than production embedding
  (#130). OpenStreetMap attribution is unchanged.
- Settings is now clearly split into two screens: the main Settings page
  (`/settings`) holds only settings that affect your own account —
  Profile, Notifications, Preferences, Security, iCal feed, Change
  password — while everything shared by the whole household lives on the
  new Household & System page and its sub-pages (#121).
- AI document extraction and AI Assistant settings moved from the personal
  Settings page to System settings (`/settings/app`), reflecting that
  they're now household-wide and admin-managed (see Breaking Changes
  above). Saving no longer requires re-entering the API key on every
  save — like every other secret in System settings, it's only
  overwritten when a new value is actually submitted.
- The AI document extraction and AI Assistant provider settings now show
  a persistent "Leave blank to use the default: `<model>`" hint under the
  Model field, instead of relying solely on a placeholder that disappears
  on focus and never confirms which model is actually in effect once
  saved (#123).
- Sidebar, mobile nav drawer, and bottom-nav "More" sheet now group nav
  items into "Modules" (Contracts, Warranties, plus enabled optional
  modules) and "Tools" (Documents, Assistant, Calendar, Spending)
  sections, with Dashboard standing alone above both (#125). The
  "Assistant" nav item is now hidden entirely for users who haven't
  configured an AI provider, instead of linking to a page that can't do
  anything (#135).
- Vehicle detail page: make/model/year/license plate moved out of an
  unlabeled subtitle above the page heading into the same labeled details
  card as Colour/VIN/Rego expiry/Insurance expiry (#146).
- `ContractForm`'s main field grid is now grouped under a "Contract /
  policy details" heading, matching the existing "Contact details
  (optional)" section directly below it (#133).
- Settings preferences and notification forms now surface a specific,
  visible error when a save fails, instead of silently discarding the
  whole submission on any single invalid field (#120). `FormMessage` now
  toasts on error as well as success, so an inline validation error (e.g.
  switching AI provider without an API key) is no longer easy to miss
  (#124).
- Product form: "Warranty end date" now auto-suggests 12 months after
  "Purchase date" when left blank, using the same auto-fill highlight
  styling as AI-extracted fields — only fills in if you haven't already
  entered your own warranty end date (#131).
- The dashboard's "Est. monthly spend" tile now shows a visible warning
  banner (not just a small `*` footnote) when contracts billed in a
  currency without a usable exchange rate are excluded from the total,
  and logs a server-side warning naming the affected currencies so it's
  diagnosable from logs (#132).

### Fixed

- **Contract, product, vehicle, travel, property, and wealth exports
  (CSV/PDF) only included records the current user personally created**,
  contradicting the app's household-wide data model — every other query
  for these entities has no such filter. A household member who didn't
  create the records they were exporting got a blank or near-empty file.
  Removed the filter from all 6 export routes (#140).
- Settings crashed with a raw, unhandled Prisma error if the signed-in
  user's account had been deleted elsewhere (JWT sessions don't
  re-validate against the database). Now redirects to `/login` instead
  (#141).
- Settings save actions for SMTP/ntfy/Ollama/barcode/S3/SFTP/schedule/
  flight-status had no error handling around their writes, so a
  misconfigured `ENCRYPTION_KEY` surfaced as a generic, unreadable Server
  Components error instead of a specific message (#118).
- Contracts' filter toolbar (search box, category/status selects, Filter
  button) used three different height rules and didn't visually line up.
  Standardized to one consistent height. The Products list toolbar had the
  identical mismatch and was fixed at the same time (#127).
- Barcode lookup failures (rate-limited, unreachable, not found) all
  looked identical — a silent no-op with no indication why. `lookupBarcode()`
  now returns a specific reason, surfaced as a specific message on the
  product form (#139). Keyless lookups already worked via UPCitemdb's
  rate-limited trial endpoint; this only improves diagnosability of
  failures, since the underlying "no API key required" behavior was
  already correct.

## [0.12.1] - 2026-07-29

### Fixed

- **The AI Assistant's own description text (Settings and the Assistant page
  header) still said it was strictly read-only** — stale since #68 shipped
  guarded write proposals. Updated both to describe the confirm-before-write
  behavior instead. Found during a routine screenshot-accuracy audit.
- Regenerated `docs/screenshots/settings-ai.png`, `spend.png`, and
  `assistant.png`, which were stale in ways beyond copy: `settings-ai.png`
  predated the current side-by-side desktop grid layout for the two AI
  cards, and `spend.png` still showed "Home"/"Home tax deductible" column
  headers from before the #114 rename.

## [0.12.0] - 2026-07-29

### Added

- **Contracts and Products (warranties) can now be linked directly to a
  Property** (#114) — a new optional Property field on both forms (shown
  only when the Property module is enabled), and a "Contracts & warranties
  linked to this property" section on the Property detail page listing
  everything linked to it. This is separate from the existing
  rental-agreement-to-contract link, which is specifically for the lease
  itself — a contract can now be tied to a property regardless of whether
  there's a rental agreement at all.

### Changed

- **The "Home" module is now labelled "Property"** throughout the UI (#114)
  — the underlying data model was already called `Property`
  (`prisma/schema.prisma`), so this just fixes the user-facing naming
  mismatch that was causing confusion. Updated: the module registry label,
  the property list page's heading ("Home" → "Properties"), the quick-add
  menu item, search result groups, the /spend table column header, the
  calendar event-type label, the documents type filter, and a few
  module-disabled API error messages. The `ModuleKey` enum value (`HOME`)
  and the `/home` route path are unchanged — renaming those would need a
  data migration and would break existing bookmarks for a purely cosmetic
  win, so that's left for a separate, explicit decision if ever wanted.

## [0.11.2] - 2026-07-29

### Added

- **A left-side navigation drawer, reachable by a left-edge swipe or a new
  menu button in the mobile top bar** (#112) — shows the full nav list
  (everything `Sidebar` shows on desktop, plus Settings) from any page, not
  just the bottom nav's 4 primary items or its "More" sheet. The edge-swipe
  only starts tracking a touch that begins within 24px of the screen's left
  edge and only opens past a deliberate drag threshold, so it can't be
  triggered from a mid-screen touch and doesn't collide with
  `SwipeableListItem`'s left-drag-to-reveal (opposite direction). Whether the
  OS's own back-gesture intercepts a touch in that same edge zone before this
  handler sees it depends on the platform/WebView and isn't verifiable
  without a real device — the visible menu button is the reliable fallback
  either way, and existing bottom-nav/tap navigation is unchanged.

### Fixed

- **The native app shell's pre-login "connect to your server" screen now
  matches the current design system's danger color** (#103) — its
  `--danger` token had drifted from `src/app/globals.css` after a rebrand
  pass updated one file and not the other. The web `/login` and `/setup`
  pages were already visually identical and needed no change.
- **Android: the on-screen keyboard now resizes the layout instead of
  panning/scrolling it** (#109) — added
  `android:windowSoftInputMode="adjustResize"` to `MainActivity`. Not
  verified against a real Android device/emulator in this environment.

### Closed

- **#91** (mobile-centric navigation) closed as substantially satisfied by
  the bottom-sheet overflow menu and touch-target work (#92), swipe-to-delete
  on contracts (#94), and this release's navigation drawer (#112).

## [0.11.1] - 2026-07-29

### Fixed

- **Mobile top bar and bottom nav now respect the device's safe-area insets**
  (#104, #105) — on Android edge-to-edge layouts they no longer overlap the
  status bar or get hidden behind the gesture bar, matching the pattern the
  "More" sheet already used.
- **The "← Back to contracts" link's arrow is now a properly flex-aligned
  icon** instead of a bare text glyph that could sit off-baseline (#110).

### Changed

- **The contract detail page's "Cancel"/"Reactivate" button is now labelled
  "Mark as cancelled"/"Mark as active"**, with a clearer confirmation message,
  so it reads unambiguously as a reversible status change rather than the
  permanent "Delete" action tucked in the overflow menu (#111).
- **The Dashboard's Documents section no longer shows "Uploaded this week"**
  (#107) — considered low-value clutter; "Needs review" and "Total documents"
  remain.
- **Dashboard stat tiles are now clickable** where there's a sensible
  destination (#106) — Active contracts, Est. monthly spend, Products
  tracked, Needs review, Total documents, and Vehicles needing attention all
  link through to the relevant filtered view. Tiles with no direct filter
  support (e.g. the 30-day-expiry counts) are left non-interactive rather
  than linking somewhere misleading.
- **The Dashboard's four contracts/warranties sub-sections are now grouped
  under a single "Contracts & Warranties" heading** (#108), matching the
  existing "Documents" section pattern.

## [0.11.0] - 2026-07-27

### Added

- **Records created while offline can now be edited or discarded before they
  sync** (#64). Contracts, Products, Vehicles, Travel, Home, and Inventory
  list pages now show a "Pending sync" card for anything created while
  offline — editing it updates the same queued entry in place instead of
  creating a duplicate, and discarding it removes the queued entry (and any
  staged files) entirely, with no server request ever sent. Wealth/portfolios
  doesn't have an equivalent list-client wrapper yet, so it's not covered by
  this pass.
- **The AI Assistant now streams its replies token-by-token** instead of
  waiting for the full answer (#67), across all five providers (Anthropic,
  OpenAI, Gemini, Ollama, OpenRouter) — each now parses its own streaming
  wire format (SSE or newline-delimited JSON) via a shared stream reader.
  Tool-calling rounds now also surface a brief "Checking …" status while a
  tool runs. Verified against each provider's documented wire format with
  synthetic fixtures, and end-to-end against a local mock streaming server;
  live testing against the real cloud providers wasn't possible in this
  environment (no outbound access/API keys), so keep an eye out for
  provider-specific streaming quirks in the wild.
- **The AI Assistant can now propose creating or updating a contract or
  product** (#68) — for Contracts and Products, the two always-on domains;
  Trips/Vehicles/Properties/Inventory aren't covered yet, but the same
  pattern (guarded `propose_*` tools + a confirm/cancel card) extends
  directly. A proposal never writes anything by itself: the model calls a
  `propose_create_*`/`propose_update_*` tool, which validates the fields
  against the same Zod schema the real form uses and returns them for
  display — the actual write only happens if the user explicitly confirms it
  in a card shown under the assistant's reply, via the same validated,
  `requireUser()`-gated action every form already uses. READONLY-role users
  never see these tools offered at all, and a write attempt is rejected even
  if one somehow reached them.
- **The overflow ("⋮") menu's mobile bottom-sheet redesign now extends to
  touch gestures** (#91 continued): contract cards on the Contracts list can
  be swiped left to reveal a quick Delete action (still routed through the
  same confirmation dialog used everywhere else) — a touch-only accelerator
  alongside the existing tap-through-to-detail-page path, not a replacement
  for it. Swipe-to-go-back wasn't added deliberately — modern mobile browsers
  already provide it natively, and a custom implementation would conflict
  with that. Other list pages don't have the swipe action yet; the pattern
  (`SwipeableListItem`) is reusable for them as a follow-up.

## [0.10.3] - 2026-07-27

### Added

- **The external MCP server (`/api/mcp`) now exposes products, trips, vehicles,
  properties, inventory, and net worth**, matching the breadth of read-only
  data the in-app AI Assistant already has — previously it only covered
  contracts. Six new tools: `list_products`, `list_trips`, `list_vehicles`,
  `list_properties`, `list_inventory_items`, and `net_worth`. Module-gated
  tools (everything but contracts/products) are only listed when the
  corresponding optional module (Travel, Vehicles, Home, Inventory, Wealth) is
  enabled for the household, mirroring the Assistant's behavior. Still
  strictly read-only — no new write capability.

### Changed

- The Assistant's chat tools and the MCP server's tools now share the same
  underlying Prisma query/serialization functions (`src/lib/domainQueries.ts`)
  instead of each re-deriving the same queries independently.

## [0.10.2] - 2026-07-27

### Changed

- **The overflow ("⋮") menu on detail pages (Contracts, Products, Vehicles,
  Inventory, Home, Travel) now opens as a full-width bottom sheet on mobile**
  instead of a small anchored dropdown, making its actions easier to hit with
  a thumb. Desktop keeps the existing dropdown. The menu's trigger button, and
  the mobile search/sign-out buttons in the top bar, were also enlarged to a
  44×44px minimum touch target.

## [0.10.1] - 2026-07-27

### Fixed

- **Pages required horizontal scrolling on mobile phone screens.** Two
  causes: the `/spend` page's "Actuals by financial year" table had no
  `overflow-x-auto` wrapper, and the detail-field grid used on Contracts,
  Products, Vehicles, Inventory, Home, Home rental, Travel, Wealth holdings,
  and Settings (Profile) didn't let a long unbroken value (a long email
  address, policy number, etc.) wrap or shrink, forcing the whole page wider
  than the screen. Both fixed; content now wraps or scrolls within its own
  container instead of the page.

## [0.10.0] - 2026-07-27

### Changed

- **Products now track Brand, Model, and Description separately**, matching
  how most retail invoices itemise a purchase. The previous single "Product
  name" field is now "Description" (e.g. "6kg Vented Dryer"); "Manufacturer"
  is now labelled "Brand"; and there's a new "Model" field (e.g. a model
  number/code). Existing products keep their data — the old name value
  becomes the new description. Search, exports, calendar/iCal feeds,
  warranty-reminder notifications, and the AI Assistant's product tool all
  updated to match.

## [0.9.1] - 2026-07-27

### Fixed

- **Spend and Wealth totals no longer silently sum different currencies as if
  they were the same currency.** The `/spend` page's summary tiles and
  monthly/yearly/category timelines, the dashboard's "Est. monthly spend"
  stat, and `getNetWorth()`'s share/property/inventory totals now convert
  amounts to a common currency using live exchange rates before aggregating,
  instead of adding raw numbers together (or, for the dashboard, silently
  excluding non-matching-currency contracts). Falls back to excluding an
  amount (with a small caveat note) only if a live rate genuinely can't be
  fetched.
- **Live equity price fetching for the Wealth module was silently broken** —
  `yahoo-finance2` v3 requires instantiating its default export
  (`new YahooFinance()`) rather than calling methods on it directly, so every
  price/historical-price request was failing and being swallowed by existing
  error handling. Fixed in `src/lib/prices.ts` (and used correctly in the new
  FX-rate module above).

Bump to 0.9.1.

### Added

- **Region setting** (Settings > Preferences) — a new per-user "Region" field
  controls number formatting conventions (decimal/thousands separators,
  currency symbol placement) throughout the app, independent of the existing
  date format, default currency, and timezone fields. This is a
  regionalisation-only change (part of #81); it does not add a language
  picker or translate any UI text — English strings are unchanged regardless
  of region. Defaults to the existing Australian convention, so behavior is
  unchanged for anyone who doesn't touch the new setting.

## [0.8.2] - 2026-07-25

### Fixed

- **Wealth module was scoped to whoever created each record, not the whole
  household** — a household member could only see the portfolios, holdings,
  and net worth they personally added, unlike every other module (Contracts,
  Trips, Vehicles, Home) which is already shared household-wide. Portfolios,
  holdings, trades, property valuations, and the `/spend` page's contract and
  home/vehicle spend totals are now visible and editable by every household
  member, matching the app's documented "household-wide, not per-user"
  data model.

## [0.8.1] - 2026-07-21

### Removed

- **Public demo mode**, added in 0.8.0. It was only ever intended for
  personal use running a sample instance on a personal website, not as a
  general self-hosting feature — since `DEMO_MODE` was a runtime toggle,
  anyone pulling the published Docker image could have turned it on
  themselves. Removed entirely rather than just left undocumented, so the
  capability doesn't exist in the image at all.

## [0.8.0] - 2026-07-21

### Added

- **AI chat assistant** — a new "Assistant" section where a household member
  can ask natural-language questions about their own contracts, warranties,
  trips, vehicles, home, inventory, and wealth, backed by their choice of
  Anthropic, OpenAI, Google Gemini, OpenRouter, or a local Ollama endpoint.
  It's read-only (it can look things up, but never creates, edits, or
  deletes anything) and uses its own independent BYOK provider/key/model
  settings, separate from the existing document-extraction AI settings.
- **Public demo mode** (`DEMO_MODE=true`) for running a separate, publicly
  reachable instance that lets visitors try the app with a single shared
  account (no signup) and realistic sample data, reset automatically every
  hour. Ships with its own `docker-compose.demo.yml` and a Caddy
  reverse-proxy example for running it alongside a real instance.

## [0.7.0] - 2026-07-15

### Added

- **Full offline support across every module** — offline entry, editing, and
  deletion now work for every household record type (previously only
  Contracts, Products, and Vehicles), including file/photo attachments
  staged locally and synced automatically on reconnect. Documents can also
  be explicitly downloaded for offline viewing (and deleted while offline),
  with a Settings panel to review and manage what's stored on-device.
- Conflict detection for offline edits — if a record changed elsewhere
  while you were editing it offline, the sync is flagged for review instead
  of silently overwriting the newer change.
- A unified Documents view across all modules, with search, filtering, and
  inline preview.
- Search now matches document content (extracted/OCR'd text), not just
  filenames and titles.
- AI-extraction confidence indicators and auto-filled-field highlighting
  when a document's fields are pre-filled.
- A first-run activation checklist and upload-first entry flow for new
  households.
- Document-count and last-updated metadata on list cards and detail pages.
- `PRIVACY.md`, documenting what data the app handles and exactly what each
  optional integration sends and where.
- CI now builds a signed Android App Bundle (`.aab`) for Play Store
  submission, alongside the existing debug/release APKs.

### Changed

- Warmer household color palette (new `info` token, warm-neutral retint).
- The Android and iOS app identifiers both changed to `com.hearth.app`
  (from `com.jaysbeekay.contracts`) for consistency between platforms.

### Fixed

- A corrupted iOS Xcode project reference that could crash project loading.
- A wrong `Certificate` import in the Android mTLS client-cert manager that
  broke compilation.
- Several moderate-severity transitive dependency vulnerabilities.

## [0.6.0] - 2026-07-11

### Added

- **Two-factor authentication (TOTP)** — optional authenticator-app-based 2FA,
  gated on `ENCRYPTION_KEY` being configured. Settings > Security walks through
  QR-code setup, confirms with a 6-digit code, and shows 8 one-time recovery
  codes for account recovery. Login prompts for a code (or a recovery code)
  after the password step when enabled.
- **Password reset via email** — "Forgot your password?" on the login page
  (shown only when SMTP is configured) sends a single-use, 1-hour link.
  Responses are identical whether or not the email matches an account, to
  avoid leaking which addresses have accounts.
- **Property address autocomplete + map** — property addresses now autocomplete
  against OpenStreetMap (via a server-side proxy), and the property detail page
  shows a Leaflet map when a location has been picked.
- **Link rental agreements to contracts** — a Rental-category contract can be
  linked to a property's rental agreement, surfacing tenant, lease dates, and
  rent on both records.
- **Ollama and OpenRouter as BYOK AI providers** — alongside Anthropic, Gemini,
  and OpenAI, for document field extraction. Ollama uses the existing
  system-wide connection instead of a per-user API key.
- **Read-only household role** — a third role (alongside Admin and Member)
  that can view all data but is blocked from creating, editing, or deleting
  records; admins manage member roles from Settings > Household members.
- **Yearly spend view + category breakdown** — the Spend page gains a
  Monthly/Yearly toggle and a per-category spend breakdown.
- **Currency dropdown** — currency fields across all forms are now a searchable
  dropdown of ~20 common currencies instead of free text.
- **Connection test buttons** — SMTP, ntfy, and Ollama settings each get a
  "test connection" button that reports success or failure inline.
- **Per-user preferences** — date format, default currency, and timezone are
  now configurable per user and applied throughout the app (lists, detail
  pages, exports).

### Changed

- Settings moved to the bottom of the sidebar, alongside sign-out.
- The `WARRANTY` contract category was removed from the "add contract" form
  (existing warranty contracts are unaffected).

### Fixed

- A blocked mutation (e.g. a read-only user attempting to save) no longer
  crashes to a raw browser error page — it now shows a friendly in-app message
  with a way back to the dashboard.

## [0.5.0] - 2026-07-05

### Added

- **Wealth module** — opt-in portfolio tracker and net worth dashboard. Track
  share, ETF, and crypto portfolios; add holdings and record buy/sell/split
  trades with attached documents. Live price feeds via Yahoo Finance (equities:
  ASX, NYSE, NASDAQ, LSE, TSX, etc.) and CoinGecko (crypto), cached with
  15-min/5-min TTLs and auto-refreshed every 15 minutes by a background cron.
  FIFO cost basis — BUY accumulates units and cost (including fees), SELL
  reduces proportionally, SPLIT adds units only — with unrealised gain/loss
  and gain% shown per holding and per portfolio.
- **CSV broker import** — upload a brokerage export and the app auto-detects
  CommSec, SelfWealth, Stake, or generic format, shows a preview of parsed
  rows, and imports on confirm. CommSec tickers get `.AX` suffix automatically;
  SelfWealth and Stake use the exchange/market field.
- **Net worth dashboard** — `/wealth` combines portfolio market value,
  property valuations (HOME module), and inventory items at purchase price
  (INVENTORY module) into a unified net worth figure with an inline SVG donut
  breakdown by asset class and a top-holdings grid.
- **Property valuations** — new section on each HOME property detail page to
  record estimated values (date, amount, currency, source, notes). An amber
  warning appears when no valuation exists or the latest is over 12 months old,
  and the most recent valuation feeds into the net worth calculation.
- **Wealth export** — download all portfolio trades as CSV or PDF from
  `/api/export/wealth`.

## [0.4.0] - 2026-07-04

### Added

- **Vehicles module** — track cars, motorbikes, and other vehicles with make,
  model, year, colour, licence plate, and VIN. Log service history, repairs,
  registration, roadworthy checks, insurance, and modifications against each
  vehicle with provider, date, cost, and attachable receipt/invoice. AI-assisted
  field extraction pre-fills record details from uploaded documents. Configurable
  expiry-date reminders for registration and insurance lapses — same
  threshold/channel system (email, ntfy, webhook) as contracts.
- **Offline write queue** — while offline, create and edit contracts, products,
  and vehicles; changes are queued in IndexedDB and replayed automatically
  via `/api/sync` when connectivity is restored. An amber/green sync strip
  shows queue status and lets you retry manually.
- **Android native wrapper** (`android/`) — thin Capacitor shell matching the
  iOS wrapper: server URL entry, camera permissions for barcode scanning, and
  full mTLS client-certificate support via a custom `BridgeWebViewClient`
  subclass that intercepts TLS challenges and responds with the imported PKCS12
  credential.

## [0.3.0] - 2026-07-03

### Added

- **Passkeys / WebAuthn** — register Face ID, Touch ID, or a security key as
  an alternative to your password from **Settings → Security**. Passkeys are
  per-user and opt-in; passwords continue to work as normal. Signing in with a
  passkey appears as a second button on the login page below the email/password
  form. Requires `APP_URL` to be set to the correct origin (its hostname
  becomes the WebAuthn Relying Party ID).
- **Offline read cache** — a service worker (via `@serwist/next`) caches
  navigation responses and RSC payloads using NetworkFirst strategies, so
  previously-visited pages are still browsable when your home server is
  unreachable. Each list page (contracts, products, travel, home) also
  persists the fetched data to IndexedDB on every successful load. When
  connectivity is lost an amber banner appears at the top of the screen and
  "Add" buttons are disabled until you reconnect.

## [0.2.1] - 2026-07-01

### Added

- **DB-backed application settings** — SMTP, ntfy push, Ollama, barcode
  lookup, S3/SFTP backup destinations, and cron schedules are now
  configurable from Settings > System in the admin UI, with no Docker
  restart required. Sensitive values (passwords, tokens, keys) are
  encrypted at rest with AES-256-GCM when `ENCRYPTION_KEY` is set.
  Environment variables remain as fallbacks for zero-migration upgrades.
- **Rental tracking** on Home properties — record rental agreements with
  weekly rent, tenant name, lease dates, and bond amount, then import
  monthly property-manager statements via file upload with AI-assisted
  extraction and automatic reconciliation against expected rent. Supports
  REIWA Form 1AA lease extraction.

## [0.2.0] - 2026-07-01

### Added

- **Opt-in module system** — admins choose which modules to enable at
  first-run setup and can toggle them on/off later from Settings > Modules.
  Nav items and all routes for disabled modules are hidden and redirect to
  the dashboard.
- **Travel module** — TripIt-style itinerary tracker with Flight, Lodging,
  and Activity segment types. Supports AI-assisted field extraction from
  uploaded confirmation documents (mirroring the existing Contract flow),
  manual entry, and per-segment document storage with authenticated download.
- **Home module** — property and maintenance/improvement/repair tracker.
  Track multiple properties with address, notes, and a full item history
  including provider, date, cost, and supporting documents. AI-assisted
  field extraction from uploaded invoices is supported.
- **Tax-deductible tracking** on home items — mark individual items as tax
  deductible and see a summary of tax-deductible spend broken down by AU
  financial year (1 Jul–30 Jun) on the Home list page.
- **Playwright e2e test suite** (28 tests) covering regression, module-toggle
  gating, Travel CRUD, upload security, and authorisation, running
  automatically on every push and pull request via GitHub Actions.

### Fixed

- Document upload body-size limits now consistently allow up to 15 MB across
  both Server Actions and API routes (previously the Server Action limit was
  1 MB, causing uploads over that size to hard-crash rather than show a
  friendly validation error).
- Heuristic field extraction: `findCost` no longer over-matches on the word
  "fee"; `findCompanyLine` skips lines containing dollar amounts or GST/total
  keywords so tax-summary lines are not mistaken for a company name.

## [0.1.0] - 2026-06-27

### Added

- Contract and product/warranty tracking with CRUD, list views, and expiry
  badges.
- Reminder notifications via email (SMTP) and push (ntfy) on configurable
  per-item thresholds, plus signed webhook delivery for integrations like
  Home Assistant or an MCP agent.
- Dashboard overview of upcoming expirations.
- Multi-user households with an admin setup flow and Auth.js-based
  authentication.
- Bring-your-own-key AI field extraction (Anthropic, Gemini, or OpenAI) to
  auto-fill contract/product details from an uploaded document; keys are
  encrypted at rest (AES-256-GCM).
- Barcode scanning for product entry.
- Read-only MCP server for querying contracts and products from an LLM.
- Encrypted offsite database backups to S3 and/or SFTP.
- Native iOS wrapper app (Capacitor) with mTLS client-certificate support.
- Self-hosting via Docker / docker-compose, with an nginx + mTLS
  access-lockdown guide.
