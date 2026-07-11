# Repo instructions for Claude Code

## Screenshots

`docs/screenshots/*.png` (referenced from README.md's "## Screenshots" section)
must stay in sync with the UI. Whenever a change in this session materially
alters the visual appearance of a page that already has a screenshot (layout,
new fields/sections, restyling), or adds a page worth documenting, regenerate
the affected screenshot(s) before considering the change complete:

1. Spin up an isolated scratch SQLite DB + `next dev` instance — fresh DB,
   `npx prisma migrate deploy`, seed via the app's own setup/login flow, never
   the real `/data` DB.
2. Use Playwright (`playwright-core`, launched with `executablePath:
   process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium"`) to drive the
   flow and capture the relevant page(s) at 1280x900.
3. Visually check each screenshot with the Read tool before replacing the
   existing file — don't trust the script ran correctly without looking.
4. Update `README.md`'s Screenshots table if a new page was added.
5. Clean up the scratch DB, dev server process, and any scratch scripts —
   nothing scratch should be committed.
6. This still respects the standing rule: don't push to `main` without
   explicit user confirmation for that specific push.

Skip this for changes that don't affect page appearance (pure backend logic,
copy-only tweaks with no layout impact, etc.) — use judgement.
