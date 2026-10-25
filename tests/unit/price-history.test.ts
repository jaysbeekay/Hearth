// #432 — the price-history backfill must write in short batches, keep upsert
// semantics for dates already stored, and leave the database usable for
// other requests while it runs. Yahoo Finance is stubbed: no network.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";

interface StubRow {
  date: Date;
  close: number;
  adjClose: number;
}

const { historical } = vi.hoisted(() => ({
  historical: vi.fn<(ticker: string, opts: { period1: Date; period2: Date }) => Promise<StubRow[]>>(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    historical = historical;
    quote = vi.fn();
  },
}));

import {
  fetchAndStorePriceHistory,
  getPriceHistory,
  HISTORY_FETCH_TIMEOUT_MS,
  MAX_HISTORY_DAYS,
} from "@/lib/prices";
import { applyJournalMode, journalMode, resolveJournalMode } from "@/lib/prisma";

const db = setupTestDb();
const DAY = 24 * 60 * 60 * 1000;

function utcMidnight(d: Date): number {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out.getTime();
}

// One row per calendar day in [from, to], stamped mid-afternoon UTC the way
// Yahoo returns them, so the store has to normalise to midnight.
function dailyRows(from: Date, to: Date, price: (dayMs: number) => number): StubRow[] {
  const rows: StubRow[] = [];
  for (let t = utcMidnight(from); t <= to.getTime(); t += DAY) {
    const close = price(t);
    rows.push({ date: new Date(t + 14.5 * 60 * 60 * 1000), close, adjClose: close * 0.9 });
  }
  return rows;
}

const stubDaily = (price: (dayMs: number) => number) =>
  async (_ticker: string, { period1, period2 }: { period1: Date; period2: Date }) => dailyRows(period1, period2, price);

// Days the store should hold for [from, to]; `to` is the period2 the code
// itself asked Yahoo for, so the count can't drift across UTC midnight.
function daysBetween(from: Date, to: Date): number {
  return dailyRows(from, to, () => 0).length;
}

function call(n: number) {
  return historical.mock.calls[n][1];
}

beforeEach(() => {
  historical.mockReset();
  // Belt and braces: nothing in here may reach the network.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network access in a unit test"))));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchAndStorePriceHistory", () => {
  it("backfills several thousand rows without blocking a concurrent read", async () => {
    const user = await createTestUser();
    historical.mockImplementation(stubDaily((t) => 100 + ((t / DAY) % 50)));

    const started = performance.now();
    let done = false;
    const backfill = fetchAndStorePriceHistory("VAS.AX", "ASX", new Date(Date.now() - 10 * 365 * DAY)).then(() => {
      done = true;
    });

    const readLatencies: number[] = [];
    while (!done) {
      const t0 = performance.now();
      const found = await db.prisma.user.findUnique({ where: { id: user.id } });
      readLatencies.push(performance.now() - t0);
      expect(found?.id).toBe(user.id);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
    await backfill;
    const elapsed = performance.now() - started;

    const stored = await db.prisma.priceHistory.count({ where: { ticker: "VAS.AX" } });
    expect(stored).toBeGreaterThan(3000);
    expect(stored).toBe(daysBetween(call(0).period1, call(0).period2));

    const maxRead = Math.max(...readLatencies);
    console.log(
      `[#432] journal_mode ${journalMode}: stored ${stored} rows in ${elapsed.toFixed(0)} ms; ${readLatencies.length} concurrent reads, max ${maxRead.toFixed(1)} ms`,
    );
    expect(readLatencies.length).toBeGreaterThan(1);
    expect(maxRead).toBeLessThan(1000);
  }, 60_000);

  it("caps the history it asks for at MAX_HISTORY_DAYS", async () => {
    historical.mockResolvedValue([]);
    const now = Date.now();
    await fetchAndStorePriceHistory("OLD.AX", "ASX", new Date(now - 50 * 365 * DAY));
    expect(MAX_HISTORY_DAYS).toBeGreaterThanOrEqual(30 * 365);
    expect(Math.abs(call(0).period1.getTime() - (now - MAX_HISTORY_DAYS * DAY))).toBeLessThan(60_000);
  });

  it("keeps upsert semantics: overlapping dates are updated, new dates added", async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * DAY);
    const from = new Date(now.getTime() - 30 * DAY);

    historical.mockImplementationOnce(async (_ticker, { period1 }) => dailyRows(period1, fiveDaysAgo, () => 10));
    await fetchAndStorePriceHistory("CBA.AX", "ASX", from);
    const first = await db.prisma.priceHistory.findMany({ where: { ticker: "CBA.AX" }, orderBy: { date: "asc" } });
    expect(first.length).toBe(daysBetween(from, fiveDaysAgo));
    expect(first.every((r) => r.close === 10 && r.adjClose === 9 && r.source === "yahoo")).toBe(true);
    expect(first.every((r) => r.date.getTime() === utcMidnight(r.date))).toBe(true);
    const latest = first[first.length - 1].date;

    // Second pass re-fetches from two days before the latest stored date,
    // with revised prices.
    historical.mockImplementationOnce(stubDaily(() => 20));
    await fetchAndStorePriceHistory("CBA.AX", "ASX", from);
    expect(historical).toHaveBeenCalledTimes(2);
    expect(call(1).period1.getTime()).toBe(latest.getTime() - 2 * DAY);

    const second = await db.prisma.priceHistory.findMany({ where: { ticker: "CBA.AX" }, orderBy: { date: "asc" } });
    const overlapStart = utcMidnight(call(1).period1);
    // Same rows (ids) for the dates stored before; no duplicate dates.
    expect(new Set(second.map((r) => r.date.getTime())).size).toBe(second.length);
    for (const row of first) {
      const after = second.find((r) => r.date.getTime() === row.date.getTime());
      expect(after?.id).toBe(row.id);
      expect(after?.close).toBe(row.date.getTime() >= overlapStart ? 20 : 10);
    }
    expect(second.length).toBe(daysBetween(from, call(1).period2));
    expect(second[second.length - 1].close).toBe(20);

    const points = await getPriceHistory("CBA.AX", new Date(utcMidnight(from)));
    expect(points.length).toBe(second.length);
    expect(points[0].price).toBe(9); // adjClose preferred
  });

  it("backfills backwards when an earlier fromDate arrives, then stops asking", async () => {
    historical.mockImplementation(stubDaily(() => 7));
    const recent = new Date(Date.now() - 30 * DAY);
    await fetchAndStorePriceHistory("WOW.AX", "ASX", recent);
    const firstEarliest = (await db.prisma.priceHistory.findFirstOrThrow({ where: { ticker: "WOW.AX" }, orderBy: { date: "asc" } })).date;

    // A second Holding of the same ticker (or an older Trade) from 90 days ago.
    const older = new Date(Date.now() - 90 * DAY);
    await fetchAndStorePriceHistory("WOW.AX", "ASX", older);
    expect(historical).toHaveBeenCalledTimes(2);
    expect(call(1).period1.getTime()).toBe(older.getTime());
    expect(call(1).period2.getTime()).toBe(firstEarliest.getTime());

    const rows = await db.prisma.priceHistory.findMany({ where: { ticker: "WOW.AX" }, orderBy: { date: "asc" } });
    expect(rows[0].date.getTime()).toBe(utcMidnight(older));
    expect(new Set(rows.map((r) => r.date.getTime())).size).toBe(rows.length);
    expect(rows.length).toBe(daysBetween(older, call(0).period2));

    // Everything is stored now: no further fetch either way.
    await fetchAndStorePriceHistory("WOW.AX", "ASX", older);
    expect(historical).toHaveBeenCalledTimes(2);
  });

  it("asks only once for older history Yahoo doesn't have", async () => {
    // Yahoo's history for this ticker starts 20 days ago, after the Trade.
    const listed = Date.now() - 20 * DAY;
    historical.mockImplementation(async (_ticker, { period1, period2 }) =>
      dailyRows(new Date(Math.max(period1.getTime(), listed)), period2, () => 3),
    );
    await db.prisma.priceHistory.create({
      data: { ticker: "IPO.AX", date: new Date(utcMidnight(new Date(listed))), close: 3, source: "yahoo" },
    });
    await db.prisma.priceHistory.create({
      data: { ticker: "IPO.AX", date: new Date(utcMidnight(new Date())), close: 3, source: "yahoo" },
    });
    const from = new Date(Date.now() - 60 * DAY);
    await fetchAndStorePriceHistory("IPO.AX", "ASX", from);
    await fetchAndStorePriceHistory("IPO.AX", "ASX", from);
    expect(historical).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the stored history is current, or for crypto", async () => {
    await db.prisma.priceHistory.create({
      data: { ticker: "BHP.AX", date: new Date(utcMidnight(new Date())), close: 1, source: "yahoo" },
    });
    await fetchAndStorePriceHistory("BHP.AX", "ASX", new Date(utcMidnight(new Date())));
    await fetchAndStorePriceHistory("bitcoin", "CRYPTO", new Date(Date.now() - 30 * DAY));
    expect(historical).not.toHaveBeenCalled();
  });

  it("shares one fetch between concurrent calls for the same ticker and start", async () => {
    historical.mockImplementation(stubDaily(() => 5));
    const from = new Date(Date.now() - 60 * DAY);
    await Promise.all([
      fetchAndStorePriceHistory("WES.AX", "ASX", from),
      fetchAndStorePriceHistory("WES.AX", "ASX", from),
    ]);
    expect(historical).toHaveBeenCalledTimes(1);
    expect(await db.prisma.priceHistory.count({ where: { ticker: "WES.AX" } })).toBe(daysBetween(from, call(0).period2));
  });

  it("gives a caller with an earlier start its own run", async () => {
    historical.mockImplementation(stubDaily(() => 5));
    const recent = new Date(Date.now() - 20 * DAY);
    const older = new Date(Date.now() - 80 * DAY);
    await Promise.all([
      fetchAndStorePriceHistory("TLS.AX", "ASX", recent),
      fetchAndStorePriceHistory("TLS.AX", "ASX", older),
    ]);
    const rows = await db.prisma.priceHistory.findMany({ where: { ticker: "TLS.AX" }, orderBy: { date: "asc" } });
    expect(rows[0].date.getTime()).toBe(utcMidnight(older));
    expect(new Set(rows.map((r) => r.date.getTime())).size).toBe(rows.length);
  });

  it("swallows a failed fetch and leaves stored rows alone", async () => {
    historical.mockRejectedValue(new Error("network down"));
    await expect(fetchAndStorePriceHistory("NAB.AX", "ASX", new Date(Date.now() - 30 * DAY))).resolves.toBeUndefined();
    expect(await db.prisma.priceHistory.count()).toBe(0);
  });

  it("gives up on a hung fetch and clears it so the next call can try again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    historical.mockImplementationOnce(() => new Promise(() => {}));
    const from = new Date(Date.now() - 30 * DAY);
    const hung = fetchAndStorePriceHistory("ANZ.AX", "ASX", from);
    await vi.waitFor(() => {
      expect(historical).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(HISTORY_FETCH_TIMEOUT_MS + 10);
    await expect(hung).resolves.toBeUndefined();
    vi.useRealTimers();

    historical.mockImplementationOnce(stubDaily(() => 4));
    await fetchAndStorePriceHistory("ANZ.AX", "ASX", from);
    expect(historical).toHaveBeenCalledTimes(2);
    expect(await db.prisma.priceHistory.count({ where: { ticker: "ANZ.AX" } })).toBeGreaterThan(0);
  });
});

describe("SQLite connection settings", () => {
  it("defaults to DELETE and accepts WAL", () => {
    expect(resolveJournalMode(undefined)).toBe("DELETE");
    expect(resolveJournalMode("")).toBe("DELETE");
    expect(resolveJournalMode("wal")).toBe("WAL");
    expect(resolveJournalMode(" WAL ")).toBe("WAL");
    expect(resolveJournalMode("delete")).toBe("DELETE");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveJournalMode("truncate")).toBe("DELETE");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("runs the app database in the default DELETE mode with a short busy timeout", async () => {
    expect(journalMode).toBe("DELETE");
    const [mode] = await db.prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    expect(mode.journal_mode.toLowerCase()).toBe("delete");
    const [timeout] = await db.prisma.$queryRawUnsafe<Record<string, bigint | number>[]>("PRAGMA busy_timeout");
    expect(Number(Object.values(timeout)[0])).toBe(1000);
  });

  it("switches a file to WAL and back to DELETE, reporting the effective mode", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hearth-journal-"));
    const client = createClient({ url: `file:${path.join(dir, "j.db")}` });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await client.execute("CREATE TABLE t (x INTEGER)");
      expect(await applyJournalMode(client, "WAL")).toBe("WAL");
      expect(String((await client.execute("PRAGMA journal_mode")).rows[0].journal_mode)).toBe("wal");
      expect(await applyJournalMode(client, "DELETE")).toBe("DELETE");
      expect(String((await client.execute("PRAGMA journal_mode")).rows[0].journal_mode)).toBe("delete");
    } finally {
      log.mockRestore();
      client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns when SQLite reports a different mode than asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = { execute: vi.fn().mockResolvedValue({ rows: [{ journal_mode: "memory" }] }) };
    expect(await applyJournalMode(fake as never, "WAL")).toBe("MEMORY");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reports MEMORY"));
    warn.mockRestore();
  });
});
