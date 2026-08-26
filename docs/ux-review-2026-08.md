# Hearth — UX, accessibility and product-experience review

**Date:** 2026-08-26
**Method:** Full repository review (navigation, components, actions, validation, e2e specs, screenshots) plus a hands-on run of the app against a scratch SQLite database — first-run setup, record creation, bulk import, search, and page-by-page walkthrough at 1280×900 (desktop) and 375×812 (mobile) using Playwright. Contrast ratios were computed from the design tokens in `src/app/globals.css`. No automated axe scan was run; WCAG findings below are from manual inspection and measurement, and no compliance claim is made either way.

Findings are labelled **[Observed]** (reproduced in the running app or directly evidenced in code) or **[Hypothesis]** (inferred; needs user research or testing to confirm).

---

## A. Executive summary

Hearth's UX maturity is **high for a self-hosted personal project — comparable to a good early-stage commercial product**. The codebase shows deliberate, iterative UX work: a dashboard "Needs attention" queue with pre-decided next actions (#170), a reminder-health card per record, copy-to-clipboard on identifiers (#210), completeness filter chips (#207), an extraction-confirmation gate so auto-filled dates can't silently drive reminders (#200), offline capture with pending-sync cards, 44px touch targets, a skip link, visible focus styles, and an e2e spec file dedicated to UX regressions. The floor is unusually solid. The remaining problems are mostly **seams between good subsystems**, not missing subsystems.

The five most important experience problems:

1. **The bulk "Upload documents" flow silently produces crippled records.** `/import` extracts dates from the document but throws them away — its quick-save form has only title/provider/category/cost — and it skips the extraction-review gate that `/contracts/new` enforces. A new user who migrates their paperwork through the most prominent onboarding path ("Add your first document") ends up with contracts that have **no end date, therefore no expiry tracking and no reminders**, and no "Needs review" flag telling them anything is missing. The app's core promise (never miss a renewal) fails exactly for the users who adopted it fastest. *(F1)*

2. **Keyboard access breaks in the most important control: global search.** The ⌘K dialog deliberately traps Tab between the input and the Close button, which makes the four filter chips (Expiring soon / Needs review / No document attached / Important) completely unreachable and inoperable by keyboard — confirmed in the running app. Results are reachable only by arrow keys, which is fine, but the filters are simply lost. *(F2, WCAG 2.1.1)*

3. **Extraction can destroy what the user just typed.** In `ContractForm`, every extracted field except `title` overwrites a non-empty input when a document is scanned after fields were filled. Combined with auto-fill being signalled by colour alone, a user can lose their corrections without noticing. *(F3, F20)*

4. **Household-wide visibility is never stated where it matters.** All records are visible to every household member; the only place this is said is a paragraph on the first-run setup screen — the one screen invited (non-admin) members never see. There is no cue at upload or record creation, and the one deliberate exception (private chat threads) is stated nowhere in the UI. For an app whose brand is privacy, visibility of sensitive financial documents is under-communicated. *(F5)*

5. **A layer of low-contrast, colour-only and semantics-free details undermines otherwise good accessibility.** Opacity-derived text (`text-foreground/50` ≈ 3.4:1, `/40` ≈ 2.5:1) fails WCAG 1.4.3 on detail labels, section headings and hints; calendar urgency is a coloured ring with no text; menus use `role="menu"` with no menuitem/arrow-key behaviour; validation errors appear only as a single message at the bottom of the form. Each is small; together they define the gap between "conscientious" and "conformant". *(F4, F13, F9, F11)*

---

## B. User and mental-model analysis

**User groups**

1. **The self-hosting administrator** (primary, per `PRODUCT.md`): technically confident, privacy-motivated, sets up Docker, SMTP, backups. Mental model: "system of record I own". Tolerates env-var configuration; expects visibility into what leaves the network (the app serves this well: PRIVACY.md, extraction-source messages, egress proxy option).
2. **The invited household member** (partner/family): possibly non-technical, arrives via an invitation link, never sees `/setup` or the README. Mental model: "shared filing cabinet + reminders". Needs recognition-over-recall everywhere; is the main victim of terminology drift and of the un-communicated visibility model.
3. **The read-only member** (e.g. an older relative or accountant-style viewer): consumes records and documents; needs retrieval and copyable identifiers, not forms.
4. **The stressed retriever** — any of the above during an insurance claim, a breakdown, a border crossing or a dispute. Time-boxed, on a phone, needs *one* document or number. This is a situation, not a persona, and it is the situation the product is really for.

**Goals and stress situations**

- Steady state: capture paperwork with minimal typing; trust that reminders will fire.
- Stress state: find the policy number / warranty receipt / confirmation code *now*. The app supports this well (global search reaches document text, copy-to-clipboard, Important star) — provided the record was captured completely, which loops back to problem A1.

**Probable points of confusion**

- **[Hypothesis]** "Is my insurance policy a *contract*?" The nav says Contracts; insurance lives there as a category. The form subtitle ("Contracts are ongoing agreements — leases, subscriptions, insurance") mitigates this, but the nav label alone doesn't.
- **[Observed]** "Products" vs "Warranties": the nav and onboarding say *Warranties*, the dashboard says *Products tracked*, the route is `/products`, the entity is `Product`. Two names for one concept in one viewport (dashboard).
- **[Observed]** "Needs review" means two different things: an unclassified inbox document (`/documents/inbox`) and a record with unconfirmed extracted fields (`extractionPending`). The dashboard stat "Needs review" links to the inbox; the contracts filter chip "Needs review" filters extraction-pending records.
- **[Hypothesis]** "Who can see this?" — every member sees everything, but nothing in the capture flow says so (F5).
- **[Hypothesis]** "Where did my uploaded file go?" is handled *well* (Documents tool with Inbox/Filed/All, "Belongs to" column); the distinction between the stored document and the structured record derived from it is one of the app's IA strengths.

**Assumptions requiring user research:** which module names members actually reach for ("Property" vs "Home" vs "House"); whether members expect per-record privacy; whether the 30-day expiring window matches renewal behaviour for annual policies (insurers often notify 6+ weeks out).

---

## C. Information-architecture review

**Current structure** (`src/components/nav-items.ts`): Dashboard / *Modules:* Contracts, Warranties, [Travel, Property, Vehicles, Inventory, Wealth] / *Tools:* Documents, Assistant, Calendar, Spending — plus Settings and Help in the footer. Mobile: 4 fixed slots (Dashboard, Contracts, Warranties, Documents) + "More" sheet (#173).

**Verdict: the skeleton is right.** Record types as modules, cross-cutting views as tools, and a Documents tool that spans modules is exactly the recognition-over-recall structure this data needs. Global search across all modules (with document-content matching) means users don't have to remember which module holds a record — the single most important IA property for this product, and it's present.

Issues, in order of importance:

1. **Naming, not structure** (F14): pick one name per concept and use it everywhere. Recommendation: keep routes, change labels — "Warranties" everywhere (dashboard stat → "Warranties tracked"), and either "Property" everywhere or "Home" everywhere (nav says Property, route is `/home`, README says Home module). Rename the inbox-vs-extraction "Needs review" collision (see H).
2. **"Expiring" has no home** (F21): expiry is *the* core concept, yet it exists only as a dashboard stat (30 days, fixed), a filter chip (30 days, fixed), and the Calendar list. A user asked "what's expiring in the next 90 days?" has no answer surface. Recommendation: make Calendar the canonical "Upcoming" view — rename it **Upcoming**, add 30/60/90-day window chips and overdue/soon text labels, and point the dashboard stat cards at it. This is a re-labelling plus small filters, not new architecture.
3. **Assistant appears only when configured** (F17): reasonable minimalism, but an admin who would benefit never learns it exists. A single dimmed entry ("Assistant — set up") visible to admins only, linking to Settings → AI, resolves discovery without cluttering members' nav.

A deeper restructure (e.g. merging Contracts/Warranties into one "Agreements" list) is **not** recommended: the split matches real-world documents (ongoing service vs purchased item) and the cross-links ("add a warranty instead" on the contract form) already handle misrouting cheaply.

---

## D. Journey analysis

**1. New user adds their first home-insurance policy from a PDF**
- *Current:* Setup → forced re-login (F15) → dashboard onboarding card "Add your first document" → either `/contracts/new` (drop PDF → fields fill → confirm-extraction checkbox → save; the good path) or `/import` (drop PDF → title/provider/category/cost only → save; the broken path, F1). Without OCR results, category stays "Other" and must be recalled from a 12-option select.
- *Friction:* Two capture paths with different guarantees; `/import` drops dates and skips review gating; re-login after setup; extraction failure message ("Couldn't confidently detect anything…") is honest but offers no "what next".
- *Proposed:* Make `/import` rows structurally equivalent to the single-record path: include start/end dates (pre-filled from extraction), set `extractionPending` when auto-filled, and show a per-row "No end date — this record won't get reminders" warning before save. After setup, sign the user in directly.
- *Success criteria:* ≥90% of records created via `/import` have an end/warranty date or an explicit "no end date" acknowledgement; zero silent no-reminder records; time-to-first-record < 3 min from container start.

**2. Record a product purchase and warranty from an invoice**
- *Current:* `/products/new` mirrors the contract form well (invoice upload with auto-fill, separate photo upload, barcode scan). `/import` → "Product" captures description/manufacturer/price but not purchase/warranty dates (same F1 class).
- *Friction:* Warranty end date is the one field that makes the record useful, and the bulk path can't capture it.
- *Proposed:* Add purchase date + warranty end to the import row; nudge with "Warranty ends [30 days before nothing]" style helper.
- *Success criteria:* % of products with warranty end date; warranty reminders actually scheduled.

**3. Link several policies and documents to one home**
- *Current:* `ContractForm` shows a Property select when properties exist; property detail aggregates linked contracts and rental agreements; documents attach to each record.
- *Friction:* One-directional discovery — from a property you can't *create* a linked contract pre-filled with that property; the Property select only appears if a property already exists (correct), but there's no hint that linking exists until then. **[Hypothesis]** users file the policy first and never revisit to link.
- *Proposed:* On the property detail page, an "Add contract for this property" action that opens `/contracts/new?propertyId=…`; show linked-records count chips on property cards.
- *Success criteria:* % of INSURANCE/RENTAL/UTILITY contracts linked to a property in multi-property households.

**4. Household with multiple homes and vehicles**
- *Current:* Works: property/vehicle lists, per-asset detail with service history, contract linking to either, calendar merges everything.
- *Friction:* No asset-scoped view of *contracts + documents + expiries* in one place ("everything about 12 Main St") — property detail comes close; vehicles show rego/insurance expiry natively. Minor.
- *Success criteria:* Users with 2+ properties can answer "which policies cover this house?" from one screen (property detail already lists linked contracts — verify completeness with documents).

**5. Urgent search for a policy number or warranty receipt**
- *Current:* ⌘K / toolbar search → grouped results, matches inside attached document text flagged, detail pages expose copyable identifiers. Strong.
- *Friction:* No loading indicator while the (measured ~1s) search runs — blank panel; filters unusable by keyboard (F2); no result-count announced to screen readers (F16); on mobile, search is a magnifier icon with no keyboard shortcut equivalent (fine) but the dialog is top-anchored at 15vh which is fine.
- *Proposed:* Add "Searching…" state, live-region result count, real Tab order (input → chips → close, arrows for results).
- *Success criteria:* Search-to-open-record < 10s; zero keyboard dead-ends; search success rate (see J).

**6. Identify everything expiring in 30/60/90 days**
- *Current:* Dashboard (30 days, contracts+warranties+vehicles), contracts/products lists (chip: 30 days), Calendar (chronological, unlabelled urgency rings).
- *Friction:* No 60/90-day view; calendar urgency is colour-only (F13); expired items show in the calendar without an "Expired" label.
- *Proposed:* "Upcoming" view with 30/60/90 chips and text labels ("Expired 10d ago", "12d left" — the ExpiryBadge already renders exactly this; reuse it in the calendar).
- *Success criteria:* One screen answers the 90-day question; badge text present on every urgency-coloured element.

**7. Correct inaccurate auto-extracted information**
- *Current:* Auto-filled fields highlighted (colour tint); "N fields filled from the document" message names the source (heuristic vs your AI provider); explicit confirm checkbox; unconfirmed records flagged "Needs review" with reminders held; detail-page banner offers "Confirm details". Genuinely excellent pattern.
- *Friction:* Re-scanning overwrites manual corrections (F3); the highlight is colour-only and vanishes on edit with no list of "what was auto-filled" (F20); confirm-checkbox copy is a double negative ("Leave this unchecked to save anyway…").
- *Proposed:* Never overwrite a dirty field (offer "Replace with scanned value?" per conflict); add a per-field "auto-filled" pill that is also in the accessibility tree; simplify the checkbox copy (see H).
- *Success criteria:* Extraction correction rate measurable; zero lost-edit reports; % of extraction-pending records confirmed within 7 days.

**8. Share or retrieve a document for another household member**
- *Current:* Implicit — everything is shared; a member just opens the record. Retrieval is good (search, Documents tool, preview modal, download).
- *Friction:* The *sharing model itself* is invisible (F5). "Retrieve for someone outside the household" (email a PDF to the insurer) ends at download — acceptable for scope, but the app could state it ("Download to share — links require sign-in").
- *Proposed:* One-line visibility note on upload/create surfaces + a Help entry; per-record "Visible to all N household members" line in `RecordMeta`.
- *Success criteria:* Members can answer "who can see this?" correctly without asking the admin (test with 5 users).

**9. Find records with missing documents/dates/reminders**
- *Current:* Completeness chips (Missing document, Needs review), dashboard queue rows with "Upload document" actions, reminder-health card per record, "reminders not configured" nudge for admins. Strong.
- *Friction:* No "missing end date" filter — the one gap that matters most given F1; list summary chips look like the filters above them but aren't clickable (F12).
- *Proposed:* Add "No end date" chip; make summary-strip counts act as filters.
- *Success criteria:* % complete records (see J) visible and improving.

**10. Mobile user photographs and uploads a document**
- *Current:* Camera FAB on every list screen → `/import`; file input accepts `image/*` (mobile browsers offer camera); bottom nav promotes Documents; offline queue covers dead zones in the home. Well designed.
- *Friction:* `/import` on mobile still defaults every photo to "Contract" (F10) — a photographed receipt should likely default to Product/Inventory or "Not sure yet"; FAB slightly overlaps the last stat card on short screens (cosmetic).
- *Proposed:* Default mobile captures to "Not sure yet" (inbox) unless extraction confidently classifies; or add the email-ingest type-guesser (`inboxIntake`) to this path.
- *Success criteria:* Upload completion rate on mobile; % of mobile captures that end up correctly typed without later re-classification.

**11. Archive, restore, replace or delete a sensitive record**
- *Current:* Delete is permanent, confirmed by a dialog ("This cannot be undone"), swipe-to-delete on mobile lists, offline delete queued. Contracts can be marked Cancelled (a good soft-archive for that type). Documents support versioning only via the inbox duplicate flow ("attach as new version").
- *Friction:* No undo, no archive for products/vehicles/properties, no trash, no edit history (only `RecordMeta`'s created-by/updated-at), and `ConfirmForm`'s button says just "Confirm" while focus lands on the destructive action (F8). For irreplaceable financial documents, permanent single-click-plus-confirm deletion is a sharp edge.
- *Proposed:* Phase 1: name the action on the button ("Delete contract"), focus Cancel by default. Phase 3: soft-delete with a 30-day trash for records *and* their document files, surfaced in Settings; extend "replace as new version" to record-attached documents.
- *Success criteria:* Zero unrecoverable accidental deletions; destructive dialogs name the object and consequence.

**12. A less technical member tries to understand the app unaided**
- *Current:* Invitation email → set password → dashboard. Sidebar labels are mostly plain words; Help & FAQ exists with feedback form; empty states explain themselves ("No contracts yet. Add one manually, or upload a document…").
- *Friction:* Jargon leaks: "Needs review", "Est. monthly spend" excluding non-converted currencies (explained only when it happens — actually good), "Rego" (AU-specific, fine for the household but appears in generic copy), role names rendered raw (`ADMIN` on the settings profile card), "extraction" never defined; terminology drift (F14) costs this user most.
- *Proposed:* Terminology pass (H); first-login tour is *not* needed — the onboarding checklist already does this well.
- *Success criteria:* New-member task test: add a warranty and find a policy number without help.

---

## E. Prioritised findings

Priority = severity × user frequency × strategic impact. Ranked table, then details.

| # | Finding | Area | Severity | Confidence | Priority |
|---|---|---|---|---|---|
| F1 | Bulk import drops dates and skips review gating → silent no-reminder records | `/import` | Critical | High | P0 |
| F2 | Search filter chips unreachable by keyboard (focus trapped input↔close) | Global search | High | High (reproduced) | P0 |
| F3 | Document scan overwrites user-typed field values (all but title) | Record forms | High | High | P0 |
| F4 | Opacity-derived text fails contrast (3.36:1 / 2.52:1 / 4.48:1); dark accent 4.16:1 | Global styles | High | High (measured) | P1 |
| F5 | Household-wide visibility not stated at capture; chat privacy exception unstated | Trust/privacy | High | Medium | P1 |
| F11 | No field-level validation errors; single message + toast only | Forms | Medium | High | P1 |
| F8 | Destructive dialogs: generic "Confirm", destructive autofocus, no focus trap; no undo/archive/history | Destructive actions | Medium | High | P1 |
| F6 | Cost without billing frequency → "Est. monthly spend $0.00", unexplained | Dashboard/Spend | Medium | High (reproduced) | P2 |
| F14 | Terminology drift: Warranties/Products, Property/Home, "Needs review" ×2 | Content | Medium | High | P2 |
| F10 | Import defaults every file to "Contract"; no type guessing on this path | `/import` | Medium | High | P2 |
| F7 | Reminder thresholds are comma-separated free text | Record forms | Medium | High | P2 |
| F13 | Calendar urgency is colour-only ring; expired items unlabelled | Calendar | Medium | High | P2 |
| F12 | Summary-strip counts styled as chips but not interactive | Lists | Medium | High (reproduced) | P2 |
| F9 | `role="menu"` without menuitem semantics or arrow keys | Menus | Medium | High | P2 |
| F15 | Setup → forced re-login with just-created credentials | Onboarding | Medium | High (reproduced) | P2 |
| F16 | Search: no loading state; results not announced; groups unassociated | Global search | Medium | High | P2 |
| F21 | No 60/90-day expiring view anywhere | Expiry mgmt | Medium | Medium | P2 |
| F20 | Auto-fill indicated by colour only; not in accessibility tree | Extraction | Medium | High | P2 |
| F17 | Assistant (and other env-gated features) invisible until configured | Navigation | Low | Medium | P3 |
| F18 | Toasts fixed 4s, no pause on hover/focus; errors same duration | Feedback | Low | High | P3 |
| F19 | No `prefers-reduced-motion` handling | Global styles | Low | High | P3 |
| F22 | Field hints not linked via `aria-describedby` | Forms | Low | High | P3 |
| F23 | Category defaults to "Other"; extraction never proposes a category | Record forms | Low | High (reproduced) | P3 |
| F26 | Extraction-confirm checkbox copy is a double negative | Extraction | Low | High | P3 |

### Finding details

**F1 — Bulk import produces records that can't remind.**
*Area:* `/import` (`src/components/ImportClient.tsx`, `src/lib/actions/import.ts`).
*Problem:* The extract API returns `startDate`/`endDate` (contract) and date fields (product), but `ImportClient` keeps only title/provider/category/cost (rows at `ImportClient.tsx:110–158`) and `importContract`/`importProduct` neither accept dates from this flow nor set `extractionPending`. The single-record forms (`ContractForm`) treat the same situation as "Needs review" and hold reminders; the bulk path doesn't.
*Evidence:* Code paths above; live run: imported contract saved with no dates, no review flag; quick-form shows 4 fields (screenshot).
*Impact:* Core value proposition (reminders before expiry) silently fails for bulk-migrated records; user believes they're covered.
*Journeys:* 1, 2, 9. *Severity:* Critical. *Confidence:* High.
*Recommendation:* Add date fields to import rows (pre-filled from extraction, highlighted like other auto-fills); mark auto-filled rows `extractionPending`; warn inline before saving a record with no end date.
*Example:* Below the row fields: ⚠ "No end date — Hearth can't remind you about this one. Add a date, or save anyway."
*Complexity:* Medium.

**F2 — Search keyboard trap.**
*Area:* `src/components/GlobalSearch.tsx:159–178`.
*Problem:* Tab from the input jumps to Close (preventDefault), Tab from Close returns to the input — by design ("only the input and the close button are real tab stops") — but the four filter chips are focusable buttons that can now never receive keyboard focus, and `aria-activedescendant` options are the only other reachable content.
*Evidence:* Reproduced: focus cycle logged input → Close → input over three Tabs with results present.
*Impact:* Keyboard and switch users cannot filter search at all. WCAG 2.1.1 (Keyboard).
*Journeys:* 5, 6, 9. *Severity:* High. *Confidence:* High.
*Recommendation:* Include the chips in the trap's tab order (input → chips → close → wrap), keep arrows for options.
*Complexity:* Small.

**F3 — Scan overwrites typed values.**
*Area:* `src/components/ContractForm.tsx:120–162` (`applyExtractedFields`); same pattern in product/trip/vehicle forms.
*Problem:* Only `title` checks `!titleRef.current.value` before writing; provider, dates, cost, contacts overwrite whatever is present.
*Impact:* User types corrections → attaches the PDF afterwards → corrections replaced by extraction output, highlighted as if new.
*Journeys:* 1, 7. *Severity:* High. *Confidence:* High (code-evidenced; not runtime-reproduced since OCR tooling was absent in the review environment).
*Recommendation:* Apply extracted values only to empty fields; where a non-empty field differs, show a per-field affordance.
*Example:* Small pill next to Provider: "Scanned: 'AGL Energy' — Use".
*Complexity:* Small.

**F4 — Contrast failures in derived text colours.**
*Area:* Global (`src/app/globals.css` tokens; ~40 usages of `text-foreground/40|50|60`, e.g. `DetailField` labels, sidebar "MODULES/TOOLS" headings, `RecordMeta`, back-links).
*Problem/Evidence (measured):* on surface `#fffdf9`: `foreground/50` = **3.36:1**, `/40` = **2.52:1**, `/60` = **4.48:1** (just under 4.5). Dark mode: accent `#8f7afe` on surface `#242760` = **4.16:1** (used for links/nav text), danger `#ef5a89` = **4.23:1**. Core tokens (`--muted` 5.3:1, warning 6.5:1, etc.) pass.
*Impact:* Low-vision users lose exactly the scaffolding text (labels, hints, meta) that explains records. WCAG 1.4.3.
*Journeys:* all. *Severity:* High. *Confidence:* High.
*Recommendation:* Replace `/40`–`/60` opacities with the existing `--muted` token (passes at 5.3–5.7:1); nudge dark `--accent`/`--danger` one step lighter for text usage.
*Complexity:* Small–Medium (sweep + visual check).

**F5 — Visibility model under-communicated.**
*Area:* Capture surfaces (`/import`, record forms, document upload), `RecordMeta`, Assistant.
*Problem:* "Records in every module are visible to your whole household" appears once — on `/setup` (`SetupForm.tsx:87`), which invited members never see. No copy states that chat threads are the one private exception (repo-wide grep found none).
*Impact:* A member may upload a payslip/statement assuming personal storage; trust damage when discovered. Conversely, chat privacy is an invisible benefit.
*Journeys:* 8, 12. *Severity:* High (trust), frequency low. *Confidence:* Medium — actual user expectation needs research.
*Recommendation:* One quiet line on upload/create surfaces and in `RecordMeta` ("Visible to all 4 household members"); "Private to you" label on chat thread list; Help entry.
*Complexity:* Small.

**F6 — Spend shows $0.00 when billing frequency is unset.**
*Evidence:* Reproduced: two contracts with costs ($1,420, $89), frequency "Not set" → dashboard "Est. monthly spend **$0.00**" with no explanation (`monthlyEquivalent` returns nothing without a frequency — `src/lib/utils.ts`, `dashboard/page.tsx:80–88`).
*Recommendation:* Count unknown-frequency costs nowhere but *say so* (same pattern as the existing FX-exclusion notice), and nudge in-form: selecting a cost without frequency → hint "Choose a billing frequency so this counts toward monthly spend."
*Severity:* Medium. *Confidence:* High. *Complexity:* Small. *Journeys:* 1, 12.

**F7 — Reminder thresholds as comma-separated text.** `ContractForm.tsx:475–486` ("Remind me before expiry (days, comma-separated)", placeholder `30,14,7,1`). Error-prone free text for a core setting; no visible validation of malformed input at the field. *Recommendation:* Preset chips (30/14/7/1 toggles) + "custom…" input; or at minimum inline validation with example. *Severity:* Medium. *Confidence:* High. *Complexity:* Small–Medium. *Journeys:* 1, 9.

**F8 — Destructive-action pattern.** `ConfirmForm.tsx`: the confirm button is labelled "Confirm" (not the action), receives `autoFocus` (Enter/double-tap deletes), the dialog has no accessible name (only `aria-describedby`), and Tab is not trapped inside the portal. No undo/trash/audit history exists for records (journey 11).
*Recommendation:* Phase 1: pass an action label ("Delete contract", "Remove Alex"), focus Cancel, add `aria-labelledby` title, trap focus. Phase 3: soft-delete + trash.
*Severity:* Medium (data-loss adjacency). *Confidence:* High. *Complexity:* Small (phase 1) / Large (trash).

**F9 — Menu semantics.** `DetailOverflowMenu.tsx` and the Export `<details>` menu (`ContractListClient.tsx:137–146`) expose `role="menu"` (or none) with plain buttons/links: no `role="menuitem"`, no arrow-key movement, no focus move on open. WCAG 4.1.2. *Recommendation:* Either drop `role="menu"` (plain disclosure of buttons is fine) or implement full menu keyboard behaviour; move focus into the sheet on open and restore on close. *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F10 — Import type default.** Every dropped file becomes "Contract" (`ImportClient.tsx:161–179`), though an email-ingested document gets a type guess (`computeInboxIntake`). Receipts and photos are mis-defaulted; changing the select re-scans (good). *Recommendation:* Run the same guesser on this path, or default to "Not sure yet" when extraction finds nothing. *Severity:* Medium. *Journeys:* 1, 10. *Complexity:* Medium.

**F11 — Field-level errors.** All forms surface only `firstIssueMessage` — one message at the bottom (`FormMessage`) plus a toast; the offending field isn't marked (`aria-invalid`), described, or focused. Reproduced on import ("Provider/company is required" at row bottom). WCAG 3.3.1/3.3.3 are arguably met minimally (error identified in text) but usability on long forms suffers; on `/contracts/new` the message can be off-screen below the fold.
*Recommendation:* Map Zod issues to fields: mark input `aria-invalid`, render the message under the field, focus the first invalid field on failed submit.
*Severity:* Medium. *Confidence:* High. *Complexity:* Medium.

**F12 — Summary chips look interactive.** `ListSummaryStrip.tsx` renders "1 expiring within 30 days / 1 expired / 2 added this week" as rounded-full bordered pills — visually identical to the clickable filter chips directly above (reproduced in screenshots). *Recommendation:* Make them buttons that apply the matching filter (best), or restyle as plain text. *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F13 — Calendar colour-only urgency.** `calendar/page.tsx` `URGENCY_RING` = red/amber ring, nothing textual; past-dated events show without an "Expired" label. WCAG 1.4.1. *Recommendation:* Reuse `ExpiryBadge` ("Expired 10d ago" / "12d left") on calendar rows. *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F14 — Terminology drift.** Evidence: nav "Warranties" (`nav-items.ts:24`) vs dashboard "Products tracked" (`dashboard/page.tsx:219`) vs route `/products`; nav "Property" (module registry) vs route `/home` vs README "Home"; "Needs review" = inbox docs (dashboard stat, `DocumentsTabs`) *and* extraction-pending records (filter chips, detail banner). *Recommendation:* One-pass glossary (see H). *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F15 — Post-setup re-login.** Reproduced: `POST /setup` → 303 → `/login`, where the user re-types the credentials created seconds earlier. First impression of friction, worst for the least technical. *Recommendation:* Auto-sign-in after successful setup (credentials are in hand server-side). *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F16 — Search feedback.** No "Searching…" indicator (measured ~1.1s first search → blank panel); result changes not announced (`aria-live`); group headings are visual only (`<p>` above options, not `role="group"`/`aria-label`). *Recommendation:* Add status row + polite live region ("8 results in 3 groups"). *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F17 — Env-gated invisibility.** Assistant is filtered out of nav unless chat is configured (`nav-items.ts:35`); backups/AI extraction sections similarly appear only when `ENCRYPTION_KEY` is set. Correct for members, but admins never discover the features in-app. *Recommendation:* Admin-only dimmed entries with "Set up" links (the existing `UnconfiguredNotice` component is the right vehicle). *Severity:* Low. *Confidence:* Medium. *Complexity:* Small.

**F18 — Toast behaviour.** Fixed 4s dismissal for success *and* error, no pause on hover/focus, no manual dismiss (`Toast.tsx:44–47`). Errors that arrive while the user looks elsewhere are lost; the inline `FormMessage` mitigates for forms. *Recommendation:* Errors persist until dismissed; pause timer on hover/focus. *Severity:* Low. *Confidence:* High. *Complexity:* Small.

**F19 — Reduced motion.** No `prefers-reduced-motion` query in `globals.css`; spinners and transitions are mild, so impact is low — but a one-liner disables non-essential animation. *Severity:* Low. *Complexity:* Small.

**F20 — Auto-fill provenance is colour-only.** `markAutoFilled` tints the input (accent ring); `ImportClient.fieldClass` likewise; nothing enters the accessibility tree, and the tint silently clears on edit. WCAG 1.4.1. *Recommendation:* Add visually-hidden "(auto-filled from document)" text or an `aria-description`, plus a visible "auto" pill. *Severity:* Medium. *Confidence:* High. *Complexity:* Small.

**F21 — Expiring windows.** Only 30-day views exist (dashboard stat, list chip); no 60/90. *Recommendation:* See C.2 ("Upcoming" view). *Severity:* Medium. *Confidence:* Medium (frequency assumption). *Complexity:* Small–Medium.

**F22 — Hints unassociated.** `FormField.tsx` renders `hint` as a sibling `<p>` without `aria-describedby`. Screen readers skip the hint. *Complexity:* Small.

**F23 — Category "Other" debt.** Both live-run contracts landed as "Other" (screenshots); extraction never proposes a category, and the 12-option select is easy to skip. *Recommendation:* Have extraction/heuristics propose category (keywords: "insurance", "lease", "energy"); show "Other" as a warning-tinted value in lists to invite correction. *Severity:* Low. *Complexity:* Medium.

**F26 — Confirm-checkbox copy.** "Leave this unchecked to save anyway — the record will be marked Needs review…" reads as instruction to not act. See H for rewrite. *Complexity:* Small.

### Grouped

- **Quick wins (days):** F2, F3, F6, F12, F13, F15, F16, F18, F19, F20, F22, F26, F9, F8-phase-1, F4 (token sweep).
- **Near-term (1–2 sprints):** F1, F5, F7, F10, F11, F17, F21, F23, F14 (glossary pass).
- **Larger structural:** F8-trash/undo + audit history; "Upcoming" as canonical expiry surface; extraction provenance model (per-field source + confidence retained on the record).

---

## F. Screen-level recommendations

**Onboarding (`/setup`, `OnboardingChecklist`)**
- Auto-sign-in after setup (F15).
- Keep the checklist — it's good. Add a fourth step "Add your first record" that checks off automatically, so progress is visible.
- The module-visibility sentence on setup is the only place the sharing model is stated — repeat it in the invitation email and on first login for members (F5).

**Dashboard (`dashboard/page.tsx`)**
- Keep the Needs-attention queue as the hero; consider moving it *above* the stat grids — it's the actionable half (stats are counts; the queue is work). **[Hypothesis — A/B if measurable]**
- Explain $0.00 spend when costs exist but frequencies don't (F6), same pattern as the existing FX notice (which is a model of how to do this).
- "Needs review" document stat: retitle "Inbox" to break the collision with extraction review (F14/H).

**Global search (`GlobalSearch.tsx`)**
- Fix tab order (F2); add loading + live-region states (F16); associate group headers.
- Add identifier-type hints in results ("Policy № POL-88231-X") so number searches confirm the match before navigation — the API already searches `contractNumber`.

**Records lists (`ContractListClient` et al.)**
- Make summary-strip counts filter on click (F12).
- Add "No end date" completeness chip (F1 companion).
- The dual search (list-level `q` + global ⌘K) is fine; keep list search scoped, it's labelled clearly.

**Record details (`contracts/[id]/page.tsx`)**
- Already strong (status banner, reminder health, copyable IDs, meta). Add household-visibility line to `RecordMeta` (F5).
- "Renew policy" links to the edit form — consider a purpose-built renew action later (pre-fills new dates, archives the old term) — Phase 3.

**Add/edit forms (`ContractForm`, `ProductForm`, …)**
- Never overwrite dirty fields on scan (F3); announce auto-fill (F20); per-field errors (F11); hint association (F22); threshold chips (F7); frequency nudge (F6).
- The "add a warranty instead" cross-link under the title is exactly right; mirror it on the product form ("tracking an ongoing service? add a contract").

**Document upload & review (`/import`, `InboxReviewClient`)**
- Parity with single-record forms: dates + `extractionPending` (F1); type guessing (F10); keep the per-row scan messages — they're honest and set expectations well.
- Inbox flow (classify/attach-as-version/discard, duplicate detection) is a differentiator; surface it more: after "Not sure yet" saves, toast with "View inbox" action.

**Homes & vehicles**
- "Add contract for this property/vehicle" from the asset page (D3).
- Vehicles list already leads with rego/insurance urgency — good; ensure the same ExpiryBadge text treatment as contracts everywhere.

**Household access & sharing (`settings/users`)**
- Show role for *all* members (currently only your own row shows the role inline; others' roles are in the edit control — make the current role scannable as text).
- State what each role means at the point of assignment: one line under the select ("Read-only: can see everything, can't change anything").
- Deletion of a member: say what happens to records they created (they remain — household-owned; currently unstated).

**Settings & reminders**
- The reminder-health card is excellent. Add a household-level equivalent in Settings ("Reminders: email ✓ / push — / last run 08:00 ✓ 3 sent") so admins can verify the pipeline without picking a record.
- Security log and session-revocation are strong trust features; link the security log from the profile card, not only for admins to find by browsing.

**Mobile**
- Bottom nav + More sheet + FAB are well executed (44px targets throughout, safe-area insets handled).
- Default mobile FAB captures to inbox/type-guess (F10).
- Swipe-to-delete is touch-only with tap-path alternatives (documented in code) — acceptable; ensure the revealed Delete button is ≥44px wide (it is, 88px).

---

## G. Accessibility audit (WCAG 2.2 AA, evidence-based; no conformance claim)

Tested by code inspection, live keyboard walkthrough, and token-level contrast measurement. No assistive-technology or axe pass was run — the below is what the evidence supports.

**Failures / likely failures**

| Concern | SC | Evidence | Fix |
|---|---|---|---|
| Search filter chips unreachable by keyboard | 2.1.1 Keyboard | Reproduced (focus log); `GlobalSearch.tsx:159–178` | Include chips in dialog tab order |
| Text contrast: `text-foreground/50` 3.36:1, `/40` 2.52:1, `/60` 4.48:1 (light); accent-on-surface 4.16:1, danger 4.23:1 (dark) | 1.4.3 Contrast (Minimum) | Computed from `globals.css` tokens; used for detail labels (`DetailField`), nav group headings, hints, meta | Use `--muted`+ tokens; adjust dark accent/danger for text |
| Calendar urgency conveyed by ring colour only | 1.4.1 Use of Color | `calendar/page.tsx` `URGENCY_RING` | Add ExpiryBadge text |
| Auto-filled state conveyed by tint only | 1.4.1 | `autoFillHighlight.ts`, `ImportClient.fieldClass` | Pill + SR text |
| `role="menu"`/`role="listbox"` without required semantics/keyboard | 4.1.2 Name, Role, Value | `DetailOverflowMenu` (no menuitems), search listbox options nested in non-group divs | Fix roles or remove them |
| Confirm dialog lacks accessible name; focus not trapped; destructive autofocus | 2.4.3 Focus Order / 4.1.2 | `ConfirmForm.tsx` | `aria-labelledby`, trap, focus Cancel |
| Errors not associated with fields (`aria-invalid`/`describedby` absent), first invalid field not focused | 3.3.1 / 3.3.3 (partial), best practice | `FormMessage`, all forms | Field-level mapping |
| Hints not programmatically associated | 1.3.1 Info and Relationships | `FormField.tsx` | `aria-describedby` |
| No reduced-motion media query | 2.3.3 (AAA — advisory) | `globals.css` | One media query |

**Positives worth preserving**

- Global `:focus-visible` outline (2px accent) and a working skip link (`sr-only-focusable`, layout.tsx:37).
- Status badges pair colour with text everywhere ("Expired 10d ago", "Needs review") — lists never rely on colour alone.
- `aria-pressed` on all filter chips; `role="status"`/`aria-live` on scan progress; toasts in a polite live region.
- Dialogs (`role="dialog"`, `aria-modal`, labelled) for search, preview, nav drawer; Escape closes consistently; search restores focus on close.
- 44px (`min-h-11`) touch/click targets across buttons, nav items and settings links (2.5.8 Target Size — largely met by design).
- Combobox pattern in search uses `aria-activedescendant`/`aria-controls` correctly for options.
- `required` attributes on required fields; labels are real `<label htmlFor>` throughout; date inputs are native.

**Not assessed:** screen-reader behaviour in practice, zoom/reflow at 400%, Windows High Contrast, the Capacitor shells. Recommend one pass with axe-core in the e2e suite (`@axe-core/playwright` drops into the existing specs cheaply) plus a manual NVDA/VoiceOver session on: contract create with scan, search, inbox review.

---

## H. Content-design review

**Glossary to enforce (one name per concept):**

| Concept | Use everywhere | Currently also called | Where |
|---|---|---|---|
| Product under warranty | **Warranty** | "Products tracked", `/products` | dashboard stat, routes (keep route) |
| Home/property module | **Property** | "Home" | README, route `/home` (keep route) |
| Unfiled uploaded document | **Inbox** | "Needs review" | dashboard stat, docs subtitle |
| Record with unconfirmed auto-filled fields | **Needs review** | (collides with inbox) | keep — it owns the term |
| Bulk upload page | **Upload documents** | "Import" (route, nav intent) | fine; keep route |

**Copy replacements**

| Location | Current | Problem | Suggested |
|---|---|---|---|
| Dashboard doc stat (`dashboard/page.tsx:160`) | "Needs review" → links to inbox | Term collision | "Inbox" with sub "2 documents to file" |
| Extraction confirm (`ContractForm.tsx:514–519`) | "I've checked the highlighted fields above and they're correct. Leave this unchecked to save anyway — the record will be marked Needs review and reminders will be held until it's confirmed." | Double negative; 3 clauses | "The auto-filled details are correct." + helper: "Not sure? Save anyway — we'll mark it *Needs review* and hold reminders until you confirm." |
| Confirm dialog button (`ConfirmForm.tsx`) | "Confirm" | Names nothing | "Delete contract" / "Remove Alex" / "Mark as cancelled" (per call site) |
| Delete confirm text | "Delete this contract and all its documents? This cannot be undone." | Good — keep; add the record name | "Delete **Home & Contents Insurance** and its 2 documents? This can't be undone." |
| Import scan failure | "Couldn't confidently detect anything in this document — fill the fields in manually." | Honest but dead-ends | append: "…or choose *Not sure yet* to file it in your Inbox for later." |
| Settings role display (`settings/page.tsx`) | "ADMIN" | Raw enum | "Admin" (ROLE_LABELS exists — use it here) |
| Reminder field label (`ContractForm.tsx:476`) | "Remind me before expiry (days, comma-separated)" | Format burden in label | "Remind me before expiry" + chips; if text kept: hint "Days before, e.g. 30,14,7,1" |
| Spend stat when frequencies missing | "$0.00" | Silent wrongness | add note: "2 contracts have a cost but no billing frequency — they're not counted yet." |
| Assistant nav (admin, unconfigured) | *(absent)* | Invisible feature | dimmed "Assistant — set up" |
| Upload surfaces | *(nothing about visibility)* | F5 | "Everything you add is visible to your whole household." (one line, muted) |
| Chat thread list | *(nothing)* | Hidden privacy benefit | "Chats are private to you — the only thing in Hearth that is." |

**Tone:** the existing voice (plain, first-person-neutral, explains *why* — e.g. the ntfy topic warning, the FX exclusion note) is a strength; extend it rather than formalising it.

---

## I. Proposed design system (codify what exists, fill gaps)

Most primitives already exist and are good; the proposal is mostly *promotion to a documented, single implementation*:

- **Record card** (`ContractCard` as reference): category eyebrow, title, provider, ExpiryBadge top-right, footer meta (end date / cost / doc count). Adopt for vehicles/properties/trips where they diverge. Cards are single links; secondary actions live on detail pages (keep — avoids nested-interactive a11y traps).
- **Detail field** (`DetailField`): label/value with optional copy button — already shared (#210). Add `copyable` to every identifier (VIN, rego, serial, confirmation code) as a rule.
- **Status badge** (`ExpiryBadge`): text + tone, never colour alone. Extend with `variant="cancelled|needsReview|pendingSync"` so all list badges come from one component (needs-review and pending-sync chips are currently bespoke).
- **Filter chip**: interactive, `aria-pressed`, accent when active (exists in three places — extract one `<FilterChip>`; non-interactive stats must *not* use this shape → fixes F12).
- **Document preview** (`DocumentPreviewModal` + `DocumentLink`): keep; add "open in new tab" and file-size in the modal header; always render the preview action as a labelled button (already done).
- **Empty state**: dashed-border card with one-line explanation + up to two actions (exists on lists — standardise the "explanation + primary + secondary" recipe; every empty state should name the fastest path, usually upload).
- **Confirmation dialog** (`ConfirmForm` v2): named title, consequence sentence with object name, Cancel focused, destructive button carries the verb, focus trapped (F8).
- **Notification/toast**: success auto-dismiss 4s; error sticky with dismiss ×; pause on hover; always paired with inline `FormMessage` on forms (F18).
- **Validation message**: field-level, `aria-invalid` + message under field + submit-time focus to first error; form-level summary only for cross-field issues (F11).
- **Auto-filled input**: tint + "auto" pill + SR text + "restore my value" on conflict (F3/F20) — this pattern is Hearth's signature interaction; it deserves the most polish.

---

## J. Measurement plan

Self-hosted and privacy-sensitive → no third-party analytics. Two viable layers: (a) local, aggregate-only counters stored in SQLite and shown to the household itself on a Settings page ("your setup health"), (b) structured e2e/synthetic checks in CI. Both avoid phoning home.

| Indicator | Definition | Instrument | Target |
|---|---|---|---|
| Time to first record | container start → first contract/product saved | timestamp delta, local | < 10 min |
| Upload completion rate | files added to `/import` queue → saved or inboxed (not removed/abandoned) | local counter | > 90% |
| Extraction acceptance | auto-filled fields kept vs edited before save | diff at save, local | track trend |
| Extraction confirmation lag | records `extractionPending` → confirmed | timestamps exist already (`extractionConfirmedAt`) | < 7 days median |
| Record completeness | % records with end/warranty date; % with ≥1 document; % non-"Other" category | nightly query, shown on Settings | > 85% dated |
| Reminder coverage | % expiring-within-90d records with a working channel + thresholds | reuses `getReminderHealth` | 100% |
| Search success | searches followed by a result click within 30s | local counter | > 80% |
| Time to retrieve document | search open → document opened | local timing | < 15 s |
| Reminder setup rate | households with SMTP or ntfy configured within 7 days of setup | boolean | — |
| Task completion (qualitative) | journeys 1, 5, 7, 12 with 3–5 household members | moderated test | — |

The completeness/coverage rows double as *user-facing* value ("your records are 92% reminder-ready"), which suits the product better than telemetry.

---

## K. Recommended roadmap

**Phase 1 — low-risk fixes (days–2 weeks):**
F2 search tab order · F3 no-overwrite · F4 contrast token sweep · F6 spend explanation · F8-p1 confirm dialogs · F9 menu semantics · F12 summary chips → filters · F13 calendar badges · F15 auto-sign-in after setup · F16 search states · F18 toast behaviour · F19 reduced motion · F20 auto-fill SR text · F22 hint association · F26 + H copy replacements · F14 label unification (Warranties/Property/Inbox).

**Phase 2 — workflow improvements (1–2 sprints):**
F1 import parity (dates + review gating + no-end-date warning) · F10 type guessing on `/import` and mobile FAB captures · F11 field-level validation errors · F7 threshold chips · F5 visibility copy across capture surfaces + chat privacy label · F17 admin-only setup hints for gated features · F21 "Upcoming" view with 30/60/90 · F23 category proposals · axe-core in e2e + one screen-reader pass · asset-scoped "add contract for this property/vehicle".

**Phase 3 — structural (quarter):**
Soft-delete/trash with 30-day retention for records + document files, and restore UI · per-record change history (who/what/when) surfaced in `RecordMeta` · renewal flow (roll a contract to a new term keeping history) · extraction provenance retained per field (source, confidence) powering both the review UI and the correction-rate metric · document versioning generalised beyond the inbox duplicate flow.

Each phase preserves the product's self-hosted, local-first character: nothing above requires external services, and the measurement plan keeps all data in the household's own database.

---

## Appendix — review artefacts

- Live-run evidence screenshots were captured to a scratch directory (not committed): setup, empty dashboard, populated dashboard, contract form, contract detail, import scan/save-error states, search overlay with focus-trace log, documents/inbox/calendar/settings, mobile dashboard/list/More-sheet/detail.
- Environment notes: `next dev --webpack` in the review sandbox mis-bundled server-only modules (`ssh2`, `imapflow`) into a browser compile via `src/instrumentation.ts`; worked around locally by stubbing instrumentation (not committed, not a UX finding, possibly environment-specific — worth a quick check on a clean clone).
- No OCR binaries (`pdftotext`/`tesseract`) existed in the sandbox, so extraction's *failure* paths were exercised live; extraction *success* paths were reviewed in code only.
