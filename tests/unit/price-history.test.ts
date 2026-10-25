// #432 — the price-history backfill must write in short batches, keep upsert
// semantics for dates already stored, and leave the database usable for
// other requests while it runs. Yahoo Finance is stubbed: no network.
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { fetchAndStorePriceHistory, getPriceHistory, MAX_HISTORY_DAYS } from "@/lib/prices";

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

beforeEach(() => {
  historical.mockReset();
});

describe("fetchAndStorePriceHistory", () => {
  it("backfills several thousand rows without blocking a concurrent read", async () => {
    const user = await createTestUser();
    historical.mockImplementation(async (_ticker, { period1, period2 }) =>
      dailyRows(period1, period2, (t) => 100 + (t / DAY) % 50),
    );

    const now = Date.now();
    const started = performance.now();
    let done = false;
    const backfill = fetchAndStorePriceHistory("VAS.AX", "ASX", new Date(now - 20 * 365 * DAY)).then(() => {
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

    // The 20-year request is capped to MAX_HISTORY_DAYS.
    const [, opts] = historical.mock.calls[0];
    expect(Math.abs(opts.period1.getTime() - (now - MAX_HISTORY_DAYS * DAY))).toBeLessThan(60_000);

    const stored = await db.prisma.priceHistory.count({ where: { ticker: "VAS.AX" } });
    expect(stored).toBeGreaterThan(3000);
    expect(stored).toBe(dailyRows(opts.period1, opts.period2, () => 1).length);

    const maxRead = Math.max(...readLatencies);
    console.log(
      `[#432] stored ${stored} rows in ${elapsed.toFixed(0)} ms; ${readLatencies.length} concurrent reads, max ${maxRead.toFixed(1)} ms`,
    );
    expect(readLatencies.length).toBeGreaterThan(1);
    expect(maxRead).toBeLessThan(1000);
  }, 60_000);

  it("keeps upsert semantics: overlapping dates are updated, new dates added", async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * DAY);
    const from = new Date(now.getTime() - 30 * DAY);

    historical.mockImplementationOnce(async (_ticker, { period1 }) => dailyRows(period1, fiveDaysAgo, () => 10));
    await fetchAndStorePriceHistory("CBA.AX", "ASX", from);
    const first = await db.prisma.priceHistory.findMany({ where: { ticker: "CBA.AX" }, orderBy: { date: "asc" } });
    expect(first.length).toBe(dailyRows(from, fiveDaysAgo, () => 0).length);
    expect(first.every((r) => r.close === 10 && r.adjClose === 9 && r.source === "yahoo")).toBe(true);
    expect(first.every((r) => r.date.getTime() === utcMidnight(r.date))).toBe(true);
    const latest = first[first.length - 1].date;

    // Second pass re-fetches from two days before the latest stored date,
    // with revised prices.
    historical.mockImplementationOnce(async (_ticker, { period1, period2 }) => dailyRows(period1, period2, () => 20));
    await fetchAndStorePriceHistory("CBA.AX", "ASX", from);
    const [, opts] = historical.mock.calls[1];
    expect(opts.period1.getTime()).toBe(latest.getTime() - 2 * DAY);

    const second = await db.prisma.priceHistory.findMany({ where: { ticker: "CBA.AX" }, orderBy: { date: "asc" } });
    const overlapStart = utcMidnight(opts.period1);
    // Same rows (ids) for the dates stored before; no duplicate dates.
    expect(new Set(second.map((r) => r.date.getTime())).size).toBe(second.length);
    for (const row of first) {
      const after = second.find((r) => r.date.getTime() === row.date.getTime());
      expect(after?.id).toBe(row.id);
      expect(after?.close).toBe(row.date.getTime() >= overlapStart ? 20 : 10);
    }
    expect(second.length).toBe(dailyRows(from, now, () => 0).length);
    expect(second[second.length - 1].close).toBe(20);

    const points = await getPriceHistory("CBA.AX", new Date(utcMidnight(from)));
    expect(points.length).toBe(second.length);
    expect(points[0].price).toBe(9); // adjClose preferred
  });

  it("does nothing when the stored history is current, or for crypto", async () => {
    await db.prisma.priceHistory.create({
      data: { ticker: "BHP.AX", date: new Date(utcMidnight(new Date())), close: 1, source: "yahoo" },
    });
    await fetchAndStorePriceHistory("BHP.AX", "ASX", new Date(Date.now() - 30 * DAY));
    await fetchAndStorePriceHistory("bitcoin", "CRYPTO", new Date(Date.now() - 30 * DAY));
    expect(historical).not.toHaveBeenCalled();
  });

  it("shares one fetch between concurrent calls for the same ticker", async () => {
    historical.mockImplementation(async (_ticker, { period1, period2 }) => dailyRows(period1, period2, () => 5));
    const from = new Date(Date.now() - 60 * DAY);
    await Promise.all([
      fetchAndStorePriceHistory("WES.AX", "ASX", from),
      fetchAndStorePriceHistory("WES.AX", "ASX", from),
    ]);
    expect(historical).toHaveBeenCalledTimes(1);
    expect(await db.prisma.priceHistory.count({ where: { ticker: "WES.AX" } })).toBe(dailyRows(from, new Date(), () => 0).length);
  });

  it("swallows a failed fetch and leaves stored rows alone", async () => {
    historical.mockRejectedValue(new Error("network down"));
    await expect(fetchAndStorePriceHistory("NAB.AX", "ASX", new Date(Date.now() - 30 * DAY))).resolves.toBeUndefined();
    expect(await db.prisma.priceHistory.count()).toBe(0);
  });

  it("runs the database in WAL mode with a busy timeout", async () => {
    const [mode] = await db.prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    expect(mode.journal_mode.toLowerCase()).toBe("wal");
    const [timeout] = await db.prisma.$queryRawUnsafe<Record<string, bigint | number>[]>("PRAGMA busy_timeout");
    expect(Number(Object.values(timeout)[0])).toBe(5000);
  });
});
