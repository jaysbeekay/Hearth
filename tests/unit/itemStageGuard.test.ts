import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { assertDisposableTargets } from "../../scripts/itemStageGuard";

// #445 review — the backfills must not write to the live install by accident.
describe("item stage backfill target guard", () => {
  const live = mkdtempSync(path.join(tmpdir(), "hearth-live-"));
  mkdirSync(path.join(live, "uploads"));
  writeFileSync(path.join(live, "app.db"), "");
  const env = { DATABASE_URL: `file:${path.join(live, "app.db")}`, UPLOADS_DIR: path.join(live, "uploads") };
  const copy = mkdtempSync(path.join(tmpdir(), "hearth-copy-"));

  it("allows a scratch copy", () => {
    expect(() => assertDisposableTargets([path.join(copy, "app.db"), copy], env)).not.toThrow();
  });

  it("refuses the live database or uploads tree, or a folder inside it", () => {
    expect(() => assertDisposableTargets([path.join(live, "app.db")], env)).toThrow(/Refusing/);
    expect(() => assertDisposableTargets([path.join(live, "uploads")], env)).toThrow(/Refusing/);
    expect(() => assertDisposableTargets([path.join(live, "uploads", "items")], env)).toThrow(/Refusing/);
  });

  it("recognises a live DATABASE_URL that carries SQLite query parameters", () => {
    const withQuery = { ...env, DATABASE_URL: `file:${path.join(live, "app.db")}?mode=rwc` };
    expect(() => assertDisposableTargets([path.join(live, "app.db")], withQuery)).toThrow(/Refusing/);
  });

  it("allows the primary only with the explicit backup confirmation", () => {
    expect(() =>
      assertDisposableTargets([path.join(live, "app.db")], { ...env, ITEM_STAGE_PRIMARY: "yes" }),
    ).toThrow(/Refusing/);
    expect(() =>
      assertDisposableTargets([path.join(live, "app.db")], { ...env, ITEM_STAGE_PRIMARY: "yes-i-have-a-fresh-backup" }),
    ).not.toThrow();
  });

  it("allows a shell pointed at the copy itself only with the scratch-copy confirmation", () => {
    // The documented flow: DATABASE_URL exported to the copy for `prisma migrate deploy`.
    const copyEnv = { DATABASE_URL: `file:${path.join(copy, "app.db")}`, UPLOADS_DIR: path.join(copy, "uploads") };
    expect(() => assertDisposableTargets([path.join(copy, "app.db")], copyEnv)).toThrow(/ITEM_STAGE_COPY/);
    expect(() =>
      assertDisposableTargets([path.join(copy, "app.db")], { ...copyEnv, ITEM_STAGE_COPY: "yes-this-is-a-scratch-copy" }),
    ).not.toThrow();
  });

  it("never lets the scratch-copy confirmation unlock the documented live defaults", () => {
    expect(() =>
      assertDisposableTargets([path.resolve("./data/app.db")], { ITEM_STAGE_COPY: "yes-this-is-a-scratch-copy" }),
    ).toThrow(/Refusing/);
  });
});
