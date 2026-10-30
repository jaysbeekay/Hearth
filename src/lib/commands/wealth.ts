import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import { fetchHistoricalPrice } from "@/lib/prices";
import { isCryptoHolding } from "@/lib/priceSource";
import {
  updateUnlessStale,
  updateLiveUnlessStale,
  findExistingParent,
  requireExisting,
  requireLive,
  RecordNotFoundError,
  type UpdateOptions,
} from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { PortfolioInput, HoldingInput, TradeInput, ImportedTrade } from "@/lib/validation/wealth";
import { Prisma, type Holding } from "@/generated/prisma/client";

// Record commands for Portfolios, Holdings and Trades (#392, ADR 0003).
// Every write to `portfolio` / `holding` / `trade` goes through here: the
// server actions, the offline sync handler and CSV import. Callers own
// sign-in, role checks and Zod parsing; these own the WEALTH module gate,
// the write, Trade Document file cleanup and revalidation.
//
// Cost basis isn't stored: it's worked out from a Holding's Trades on every
// view (src/lib/wealth.ts), so nothing here recomputes or caches it.
//
// Only Trades have a Trash (#427). Deleting a Trade moves it to Trash, and
// a Trade in Trash leaves the Holding's units, cost basis and every Wealth
// total until it's restored; permanent delete (from Trash, or the 30-day
// purge) removes the row and its Documents' files. Portfolios and Holdings
// have no Trash: deleting one is permanent and takes every Trade under it
// (Trash ones included) and their files with it.
//
// A child write still checks its parent first (#428): a Holding needs its
// Portfolio and a Trade its Holding. For Portfolios and Holdings, with no
// Trash, that's findExistingParent / requireExisting in shared.ts ("still
// exists"). A Trade in Trash is read-only until it's restored: an update to
// it is refused as not found (requireLive, and `deletedAt: null` in the
// guarded write).

export class DuplicateHoldingError extends Error {
  constructor(ticker: string) {
    super(`${ticker} is already in this portfolio.`);
    this.name = "DuplicateHoldingError";
  }
}

function portfolioPath(portfolioId: string) {
  return `/wealth/portfolios/${portfolioId}`;
}

function holdingPath(portfolioId: string, holdingId: string) {
  return `${portfolioPath(portfolioId)}/holdings/${holdingId}`;
}

// The Wealth overview and the Portfolio list both total every Holding, so
// any write under a Portfolio refreshes them along with its own page.
function revalidatePortfolio(portfolioId: string) {
  revalidatePath("/wealth");
  revalidatePath("/wealth/portfolios");
  revalidatePath(portfolioPath(portfolioId));
}

function revalidateHolding(portfolioId: string, holdingId: string) {
  revalidatePortfolio(portfolioId);
  revalidatePath(holdingPath(portfolioId, holdingId));
}

// ── Portfolio ───────────────────────────────────────────────────────────────

// For a write to a Portfolio or under it, as `what`.
function findLivePortfolio(id: string, what = "Portfolio") {
  return findExistingParent(prisma.portfolio.findUnique({ where: { id } }), what);
}

// Portfolios record their creator only (there's no updatedById column), so
// only create takes the actor.
export async function createPortfolioCommand(input: PortfolioInput, actorId: string) {
  await assertModuleEnabled("WEALTH");
  const portfolio = await prisma.portfolio.create({ data: { ...input, createdById: actorId } });
  revalidatePortfolio(portfolio.id);
  return portfolio;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413). Changing costMethod
// changes how the Portfolio's cost basis is worked out from its Trades on
// the next view; the Trades themselves are untouched.
export async function updatePortfolioCommand(
  id: string,
  patch: ClearablePatch<PortfolioInput>,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("WEALTH");
  await findLivePortfolio(id);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.portfolio.updateMany({ where: { id, ...guard }, data: patch }),
  );
  revalidatePortfolio(id);
  return findLivePortfolio(id);
}

export async function permanentlyDeletePortfolioCommand(id: string) {
  await assertModuleEnabled("WEALTH");
  const existing = await prisma.portfolio.findUnique({
    where: { id },
    include: { holdings: { select: { trades: { select: { id: true } } } } },
  });
  if (!existing) throw new RecordNotFoundError("Portfolio");
  // The row delete cascades to Holdings, Trades and the Trades' Document
  // rows (Trash ones included); their files on disk aren't FK-linked, so
  // they're removed straight after, leaving no files without a row (#413).
  await prisma.portfolio.delete({ where: { id } });
  for (const holding of existing.holdings) {
    for (const trade of holding.trades) {
      await removeOwnerDocumentFiles("TRADE", trade.id);
    }
  }
  revalidatePortfolio(id);
}

// ── Holding ─────────────────────────────────────────────────────────────────

export interface HoldingScope {
  // When given, the Holding must belong to this Portfolio, otherwise it's
  // reported as not found (the URL-scoped check the forms rely on).
  portfolioId?: string;
}

async function findHolding(id: string, scope: HoldingScope = {}) {
  const holding = await prisma.holding.findUnique({ where: { id } });
  if (!holding || (scope.portfolioId !== undefined && holding.portfolioId !== scope.portfolioId)) {
    throw new RecordNotFoundError("Holding");
  }
  return holding;
}

// A Holding that's still there under a Portfolio that's still there.
async function findLiveHolding(id: string, scope: HoldingScope = {}) {
  const holding = requireExisting(await findHolding(id, scope), "Holding");
  await findLivePortfolio(holding.portfolioId, "Holding");
  return holding;
}

// A Portfolio holds each ticker once (@@unique([portfolioId, ticker])).
async function assertTickerFree(portfolioId: string, ticker: string, exceptHoldingId?: string) {
  const clash = await prisma.holding.findUnique({
    where: { portfolioId_ticker: { portfolioId, ticker } },
    select: { id: true },
  });
  if (clash && clash.id !== exceptHoldingId) throw new DuplicateHoldingError(ticker);
}

// assertTickerFree is the friendly check; the unique index is the real one.
// Two writes racing past the check both reach the database, and the second
// fails there with P2002, which is the same clash and gets the same error.
async function withTickerGuard<T>(ticker: string | null | undefined, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (ticker && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateHoldingError(ticker);
    }
    throw error;
  }
}

export async function createHoldingCommand(portfolioId: string, input: HoldingInput) {
  await assertModuleEnabled("WEALTH");
  await findLivePortfolio(portfolioId);
  await assertTickerFree(portfolioId, input.ticker);
  const holding = await withTickerGuard(input.ticker, () =>
    prisma.holding.create({ data: { ...input, portfolioId } }),
  );
  revalidateHolding(portfolioId, holding.id);
  return holding;
}

// Partial patch, as for updatePortfolioCommand. A ticker change that would
// clash with another Holding in the Portfolio is refused, as on create.
export async function updateHoldingCommand(
  id: string,
  patch: ClearablePatch<HoldingInput>,
  options: UpdateOptions & HoldingScope = {},
) {
  await assertModuleEnabled("WEALTH");
  const existing = await findLiveHolding(id, options);
  if (patch.ticker !== undefined && patch.ticker !== existing.ticker) {
    await assertTickerFree(existing.portfolioId, patch.ticker, id);
  }
  await withTickerGuard(patch.ticker, () =>
    updateUnlessStale(options.baseUpdatedAt, (guard) =>
      prisma.holding.updateMany({ where: { id, ...guard }, data: patch }),
    ),
  );
  revalidateHolding(existing.portfolioId, id);
  return findHolding(id);
}

export async function permanentlyDeleteHoldingCommand(id: string, scope: HoldingScope = {}) {
  await assertModuleEnabled("WEALTH");
  const existing = await findHolding(id, scope);
  const trades = await prisma.trade.findMany({ where: { holdingId: id }, select: { id: true } });
  // Cascades to the Holding's Trades and their Document rows; then the files go.
  await prisma.holding.delete({ where: { id } });
  for (const trade of trades) {
    await removeOwnerDocumentFiles("TRADE", trade.id);
  }
  revalidateHolding(existing.portfolioId, id);
  return { portfolioId: existing.portfolioId };
}

// ── Trade ───────────────────────────────────────────────────────────────────

export interface TradeScope {
  // When given, the Trade must belong to this Holding, otherwise it's
  // reported as not found.
  holdingId?: string;
}

async function findTrade(id: string, scope: TradeScope = {}) {
  const trade = await prisma.trade.findUnique({ where: { id } });
  if (!trade || (scope.holdingId !== undefined && trade.holdingId !== scope.holdingId)) {
    throw new RecordNotFoundError("Trade");
  }
  return trade;
}

// Records the market price on the Trade's date, for the Trade list's
// "market on the day" comparison. Crypto Holdings (isCryptoHolding: asset
// class CRYPTO, or exchange CRYPTO) have no daily price history to look up;
// before #404 a blank-exchange CRYPTO "BTC" got Yahoo's BTC ETF close. Runs
// in the background after a create: a failed or empty lookup leaves
// marketPriceOnDate blank and never fails the Trade.
function backfillMarketPrice(tradeId: string, holding: Pick<Holding, "ticker" | "exchange" | "assetClass">, date: Date) {
  if (isCryptoHolding(holding)) return;
  fetchHistoricalPrice(holding.ticker, date)
    .then((marketPrice) => (marketPrice == null ? false : saveTradeMarketPrice(tradeId, marketPrice)))
    .catch(() => {
      // A lookup is best-effort; the Trade is already saved.
    });
}

// A narrow write for the background price lookup, with no module gate and
// no revalidation (it runs after the request that created the Trade). It
// keeps the Trade's updatedAt as it was: that's what an offline edit's
// stale check compares against, and a looked-up price isn't an edit. The
// write is guarded on that same updatedAt, so a user edit landing between
// the read and the write wins and nothing is written. A Trade in Trash is
// read-only (#427), so nothing is saved for one. Returns whether the price
// was saved.
export async function saveTradeMarketPrice(id: string, marketPriceOnDate: number): Promise<boolean> {
  const current = await prisma.trade.findUnique({ where: { id }, select: { updatedAt: true, deletedAt: true } });
  if (!current || current.deletedAt) return false;
  const { count } = await prisma.trade.updateMany({
    where: { id, updatedAt: current.updatedAt, deletedAt: null },
    data: { marketPriceOnDate, updatedAt: current.updatedAt },
  });
  return count > 0;
}

// Returns the Trade with its Holding's portfolioId, for the caller's
// redirect back to the Holding page.
export async function createTradeCommand(holdingId: string, input: TradeInput) {
  await assertModuleEnabled("WEALTH");
  const holding = await findLiveHolding(holdingId);
  const trade = await prisma.trade.create({ data: { ...input, holdingId } });
  backfillMarketPrice(trade.id, holding, input.date);
  revalidateHolding(holding.portfolioId, holdingId);
  return { ...trade, portfolioId: holding.portfolioId };
}

// Partial patch, as for updatePortfolioCommand. The Holding's units and cost
// basis follow on the next view, since they're worked out from its Trades.
// Returns the Trade with its Holding's portfolioId, as createTradeCommand.
export async function updateTradeCommand(
  id: string,
  patch: ClearablePatch<TradeInput>,
  options: UpdateOptions & TradeScope = {},
) {
  await assertModuleEnabled("WEALTH");
  const existing = requireLive(await findTrade(id, options), "Trade");
  const holding = await findLiveHolding(existing.holdingId);
  // The Trade can't move Holding, so only its own Trash state can change
  // under the edit: the guarded write refuses one moved to Trash since.
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) => prisma.trade.updateMany({ where: { id, deletedAt: null, ...guard }, data: patch }),
    async () => requireLive(await findTrade(id, options), "Trade"),
  );
  revalidateHolding(holding.portfolioId, holding.id);
  return { ...(await findTrade(id)), portfolioId: holding.portfolioId };
}

// #427 — soft delete: moves the Trade to Trash. Its Documents and their
// files stay as they are (each keeps its own Trash state), so
// restoreTradeCommand brings it back as it was. Already in Trash is a
// no-op, so a replayed offline delete doesn't restart its 30 days. Returns
// where the Trade lives, for the caller's redirect.
export async function deleteTradeCommand(id: string, scope: TradeScope = {}) {
  await assertModuleEnabled("WEALTH");
  const existing = await findTrade(id, scope);
  const holding = await findHolding(existing.holdingId);
  if (!existing.deletedAt) {
    await prisma.trade.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  revalidateTrade(holding);
  return { holdingId: holding.id, portfolioId: holding.portfolioId };
}

// Holdings and Portfolios have no Trash, so there's no parent to restore
// first: a Trade whose Holding is gone was deleted with it.
export async function restoreTradeCommand(id: string) {
  await assertModuleEnabled("WEALTH");
  const existing = await findTrade(id);
  const holding = await findHolding(existing.holdingId);
  await prisma.trade.update({ where: { id }, data: { deletedAt: null } });
  revalidateTrade(holding);
  return { holdingId: holding.id, portfolioId: holding.portfolioId };
}

export async function permanentlyDeleteTradeCommand(id: string) {
  await assertModuleEnabled("WEALTH");
  const holding = await purgeTrade(id);
  revalidateTrade(holding);
  return { holdingId: holding.id, portfolioId: holding.portfolioId };
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render and from the scheduler, and purges whether or not the
// module is on. Returns the Trade's Holding.
export async function purgeTrade(id: string) {
  const existing = await findTrade(id);
  const holding = await findHolding(existing.holdingId);
  // Cascades to the Trade's Document rows (Trash ones included); then the
  // files go.
  await prisma.trade.delete({ where: { id } });
  await removeOwnerDocumentFiles("TRADE", id);
  return holding;
}

function revalidateTrade(holding: { id: string; portfolioId: string }) {
  revalidateHolding(holding.portfolioId, holding.id);
  revalidatePath("/settings/trash");
}

// ── CSV import ──────────────────────────────────────────────────────────────

// Imports rows already validated against importedTradesSchema. Each row's
// ticker finds or creates its Holding in the Portfolio (a new one with the
// row's inferred asset class, CRYPTO or SHARE, #404); a row with an unreadable date, or one matching an existing Trade
// on the same Holding (date, type, units and price), is skipped.
export async function importTradesCommand(portfolioId: string, rows: ImportedTrade[]) {
  await assertModuleEnabled("WEALTH");
  await findLivePortfolio(portfolioId);

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) {
      skipped++;
      continue;
    }

    const holding = await prisma.holding.upsert({
      where: { portfolioId_ticker: { portfolioId, ticker: row.ticker } },
      create: { portfolioId, ticker: row.ticker, assetClass: row.assetClass ?? "SHARE" },
      update: {},
    });

    const duplicate = await prisma.trade.findFirst({
      // A Trade in Trash doesn't count: it's out of the Holding until it's
      // restored, so importing it again brings it back as a new Trade.
      where: {
        holdingId: holding.id,
        date,
        type: row.type,
        units: row.units,
        pricePerUnit: row.pricePerUnit,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      skipped++;
      continue;
    }

    const trade = await prisma.trade.create({
      data: {
        holdingId: holding.id,
        type: row.type,
        date,
        units: row.units,
        pricePerUnit: row.pricePerUnit,
        fees: row.fees || null,
        currency: row.currency,
      },
    });
    backfillMarketPrice(trade.id, holding, date);
    imported++;
  }

  revalidatePortfolio(portfolioId);
  return { imported, skipped };
}
