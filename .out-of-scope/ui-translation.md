# UI translation (i18n)

Hearth's interface is English only. We are not adding a message catalogue or
translating the UI into other languages for now.

Regional conventions are a separate matter and are already supported. Each
user picks a region in Settings → Preferences, and currency, numbers and dates
follow it through `Intl` (for example `1.234,56` for German, `1 234,56` for
French). This record covers only translating the interface text.

## Why this is out of scope

- **Size.** There is no i18n library in the app. Translating it would mean
  pulling 1,000+ hardcoded strings out of the components, plus email
  templates, notification copy and validation messages. Every later UI change
  would then need catalogue updates, and the hand-written phone shell
  (`ios-shell/www/app.js`) would need its own copy.
- **Translation quality.** Hearth holds contracts, insurance and financial
  records. Machine-translated copy for terms like Due, Renewal or Warranty can
  mislead a household, and the project has no native-speaker reviewers to
  check it.
- **Cost against benefit.** Hearth is self-hosted by one household at a time.
  The ongoing cost of keeping a catalogue in step with every UI change falls on
  every contributor. The benefit only reaches households that need another
  language, and none has asked for one beyond #81.

## If this is reconsidered

The lower-risk route recorded during triage: use `next-intl` with the language
chosen by a cookie (no `/en/…` URL prefixes, so the `(app)` route tree and
`PUBLIC_PATHS` don't change). Fold its middleware into the single `auth()`
handler in `src/proxy.ts`. Pilot one Latin-script language end to end before
committing to more.

## Prior requests

- #81: "Add language translation and regionalisation options"
