---
name: hearth
description: Working conventions for the Hearth repo. Use before writing, fixing, testing or reviewing code in Hearth.
---

# Hearth development

`CLAUDE.md` at the repo root is the source of truth. This skill only points into it,
so the two can't drift apart.

Before changing code, read these sections of `CLAUDE.md`:
- **Engineering rules and Definition of Done**: workflow, risk class, test-first bug
  fixes, sibling sweep, quality-gate rules, security negative-path tests, and the DoD
  checklist that goes in every PR body.
- **Architecture** and **Conventions**: server actions, auth and roles, opt-in
  modules, storage, and the mobile shell parity rule.
- **Commands**: type-check, lint, unit tests with coverage, e2e and the standalone
  suite.

Tests:
- Unit: Vitest, in `tests/unit/**/*.test.ts`. Run with `npm run test:unit` or
  `npm run test:coverage`. For real database writes, use `setupTestDb()` from
  `tests/helpers/testDb.ts`.
- E2E: Playwright, in `e2e/specs/*.spec.ts`. Run with `npm run test:e2e`, or one spec
  with `npx playwright test e2e/specs/<file>`.
- Logic in `src/lib` and `src/app/api` gets unit tests, including failure paths. UI
  behaviour gets Playwright coverage. Neither one replaces the other.
