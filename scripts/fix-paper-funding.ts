#!/usr/bin/env npx tsx
/**
 * Fix funding_income on existing paper trades.
 *
 * Background: all paper_trades have funding_income = 0 due to a bug in the paper
 * trading engine that prevented funding rates from being applied. This script
 * retroactively calculates and updates the correct funding income for close trades.
 *
 * Algorithm:
 *   For each close trade (close_long / close_short) with funding_income = 0:
 *     1. Find the matching open trade in the same session for the same symbol
 *        (most recent open trade before this close).
 *     2. Fetch funding rates from Bybit for the open→close time window.
 *     3. For each funding rate in the window:
 *          - long:  payment = -(amount * markPrice * fundingRate)
 *          - short: payment = +(amount * markPrice * fundingRate)
 *        (positive fundingRate = longs pay shorts, negative = shorts pay longs)
 *     4. Update paper_trades.funding_income with the calculated sum.
 *
 * Usage:
 *   npx tsx scripts/fix-paper-funding.ts            # dry-run (no DB writes)
 *   npx tsx scripts/fix-paper-funding.ts --apply    # write to DB
 *
 * Run on production inside the container:
 *   docker exec backtesting-api-1 npx tsx scripts/fix-paper-funding.ts
 *   docker exec backtesting-api-1 npx tsx scripts/fix-paper-funding.ts --apply
 */

import pg from 'pg';
import ccxt from 'ccxt';

// ============================================================================
// Config
// ============================================================================

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://backtesting:l6TvgOW6XNqSd1n3Uq5eFJiZ@postgres:5432/backtesting';

const DRY_RUN = !process.argv.includes('--apply');

// Delay between Bybit API calls to stay well within rate limits (100 ms = 10 req/s)
const API_DELAY_MS = 200;

// ============================================================================
// Types
// ============================================================================

interface PaperTradeRow {
  id: number;
  session_id: string;
  symbol: string;
  action: string;
  price: number;
  amount: number;
  timestamp: number; // Unix ms stored as BIGINT
  pnl: number | null;
  fee: number;
  funding_income: number;
  balance_after: number | null;
}

interface FundingRateRecord {
  timestamp: number;
  fundingRate: number;
  markPrice: number | undefined;
}

interface UpdateSummary {
  tradeId: number;
  sessionId: string;
  symbol: string;
  openTimestamp: number;
  closeTimestamp: number;
  openAmount: number;
  direction: 'long' | 'short';
  fundingRatesUsed: number;
  calculatedFundingIncome: number;
}

// ============================================================================
// Bybit funding rate fetcher
// ============================================================================

const bybit = new ccxt.bybit({
  enableRateLimit: false, // We handle our own delays
  options: {
    defaultType: 'swap',
  },
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch funding rate history from Bybit for a symbol in a time window.
 * Paginates automatically.
 */
async function fetchFundingRates(
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<FundingRateRecord[]> {
  const allRates: FundingRateRecord[] = [];
  let since = startMs;

  while (since < endMs) {
    await sleep(API_DELAY_MS);

    let rates: ccxt.FundingRateHistory[];
    try {
      rates = await bybit.fetchFundingRateHistory(symbol, since, 200);
    } catch (err) {
      if (err instanceof ccxt.RateLimitExceeded) {
        console.warn(`  [bybit] Rate limit hit, waiting 60s...`);
        await sleep(60_000);
        continue;
      }
      if (err instanceof ccxt.NetworkError) {
        console.warn(`  [bybit] Network error, retrying in 5s: ${(err as Error).message}`);
        await sleep(5_000);
        continue;
      }
      throw err;
    }

    if (!rates || rates.length === 0) break;

    for (const rate of rates) {
      if (rate.timestamp !== null && rate.timestamp !== undefined && rate.timestamp <= endMs) {
        const rateAny = rate as unknown as Record<string, unknown>;
        allRates.push({
          timestamp: rate.timestamp,
          fundingRate: rate.fundingRate,
          markPrice:
            typeof rateAny['markPrice'] === 'number'
              ? (rateAny['markPrice'] as number)
              : undefined,
        });
      }
    }

    const lastTs = rates[rates.length - 1].timestamp;
    if (rates.length < 200 || lastTs === null) break;
    since = lastTs + 1;
  }

  // Sort ascending, deduplicate
  allRates.sort((a, b) => a.timestamp - b.timestamp);
  const unique: FundingRateRecord[] = [];
  let lastTs = -1;
  for (const r of allRates) {
    if (r.timestamp !== lastTs) {
      unique.push(r);
      lastTs = r.timestamp;
    }
  }
  return unique;
}

// ============================================================================
// Funding income calculation
// ============================================================================

/**
 * Calculate total funding income for a position held from openMs to closeMs.
 *
 * Bybit funding is paid at timestamps aligned to 8-hour intervals.
 * A funding event at timestamp T is paid if the position was open during T.
 * We include all funding rates where openMs < rateTs <= closeMs.
 *
 * For long positions:  payment = -(amount * markPrice * fundingRate)
 * For short positions: payment = +(amount * markPrice * fundingRate)
 *
 * When fundingRate > 0, longs pay shorts (payment is negative for longs).
 * When fundingRate < 0, shorts pay longs (payment is negative for shorts).
 *
 * Falls back to closePrice as mark price if markPrice is not available.
 */
function calculateFundingIncome(
  rates: FundingRateRecord[],
  direction: 'long' | 'short',
  amount: number,
  openMs: number,
  closeMs: number,
  closePriceAsFallback: number,
): number {
  let total = 0;

  for (const rate of rates) {
    // Only count funding events strictly after open and up to (inclusive) close
    if (rate.timestamp <= openMs || rate.timestamp > closeMs) continue;

    const markPrice = rate.markPrice ?? closePriceAsFallback;
    const positionValue = amount * markPrice;

    if (direction === 'long') {
      total -= positionValue * rate.fundingRate;
    } else {
      total += positionValue * rate.fundingRate;
    }
  }

  return total;
}

// ============================================================================
// DB helpers
// ============================================================================

/**
 * Find the most recent open trade for the same session + symbol that occurred
 * strictly before the given close trade timestamp.
 *
 * To handle multiple open/close cycles correctly we look at trades in
 * chronological order, find all open trades for this symbol before closeTs,
 * and then pick the one that is not already "consumed" by a prior close.
 *
 * Simpler equivalent: the last open trade for this symbol before closeTs
 * that has no subsequent close trade between it and closeTs.
 */
async function findMatchingOpenTrade(
  pool: pg.Pool,
  sessionId: string,
  symbol: string,
  closeAction: string,
  closeTimestamp: number,
  closeTradeId: number,
): Promise<PaperTradeRow | null> {
  const openAction = closeAction === 'close_long' ? 'open_long' : 'open_short';
  const closeCounterAction = closeAction; // same action as current close

  // Get all open trades for this session/symbol before this close, newest first
  const openRes = await pool.query<PaperTradeRow>(
    `SELECT id, session_id, symbol, action, price, amount, timestamp,
            pnl, fee, funding_income, balance_after
     FROM paper_trades
     WHERE session_id = $1
       AND symbol     = $2
       AND action     = $3
       AND timestamp  < $4
     ORDER BY timestamp DESC, id DESC`,
    [sessionId, symbol, openAction, closeTimestamp],
  );

  if (openRes.rows.length === 0) return null;

  // Walk backwards through open trades and find the first one that does not have
  // an intervening close trade between it and our closeTimestamp.
  for (const openTrade of openRes.rows) {
    const interveningClose = await pool.query(
      `SELECT id FROM paper_trades
       WHERE session_id = $1
         AND symbol     = $2
         AND action     = $3
         AND timestamp  > $4
         AND timestamp  < $5
         AND id         < $6
       LIMIT 1`,
      [
        sessionId,
        symbol,
        closeCounterAction,
        openTrade.timestamp,
        closeTimestamp,
        closeTradeId,
      ],
    );

    if (interveningClose.rows.length === 0) {
      // No intervening close → this open trade is the matching one
      return openTrade;
    }
    // There was an intervening close, so this open was already paired. Try the next older open.
  }

  return null;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('=== fix-paper-funding ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY MODE (writing to DB)'}`);
  console.log(`Database: ${DATABASE_URL.replace(/:([^:@]+)@/, ':***@')}`);
  console.log('');

  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

  try {
    // ------------------------------------------------------------------
    // Step 1: Fetch all close trades with funding_income = 0
    // ------------------------------------------------------------------
    const closeRes = await pool.query<PaperTradeRow>(
      `SELECT id, session_id, symbol, action, price, amount, timestamp,
              pnl, fee, funding_income, balance_after
       FROM paper_trades
       WHERE action IN ('close_long', 'close_short')
         AND funding_income = 0
       ORDER BY session_id, symbol, timestamp ASC, id ASC`,
    );

    const closeTrades = closeRes.rows;
    console.log(`Found ${closeTrades.length} close trade(s) with funding_income = 0\n`);

    if (closeTrades.length === 0) {
      console.log('Nothing to fix.');
      return;
    }

    // ------------------------------------------------------------------
    // Step 2: Process each close trade
    // ------------------------------------------------------------------
    const updates: UpdateSummary[] = [];
    const skipped: Array<{ tradeId: number; reason: string }> = [];

    // Cache funding rates per symbol per time range to avoid redundant API calls
    // Key: `${symbol}:${startDay}:${endDay}`
    const frCache = new Map<string, FundingRateRecord[]>();

    for (let i = 0; i < closeTrades.length; i++) {
      const close = closeTrades[i];
      const direction: 'long' | 'short' = close.action === 'close_long' ? 'long' : 'short';

      process.stdout.write(
        `[${i + 1}/${closeTrades.length}] Trade #${close.id} ` +
          `(${close.session_id.slice(0, 8)}... ${close.symbol} ${close.action}) -> `,
      );

      // Find matching open trade
      const openTrade = await findMatchingOpenTrade(
        pool,
        close.session_id,
        close.symbol,
        close.action,
        Number(close.timestamp),
        close.id,
      );

      if (!openTrade) {
        console.log('SKIP: no matching open trade found');
        skipped.push({ tradeId: close.id, reason: 'no matching open trade' });
        continue;
      }

      const openTs = Number(openTrade.timestamp);
      const closeTs = Number(close.timestamp);

      if (closeTs <= openTs) {
        console.log('SKIP: close timestamp <= open timestamp (data anomaly)');
        skipped.push({ tradeId: close.id, reason: 'close ts <= open ts' });
        continue;
      }

      // Fetch funding rates (with cache)
      const cacheKey =
        `${close.symbol}:` +
        `${Math.floor(openTs / 86_400_000)}:` +
        `${Math.ceil(closeTs / 86_400_000)}`;

      let rates = frCache.get(cacheKey);
      if (!rates) {
        try {
          rates = await fetchFundingRates(close.symbol, openTs, closeTs);
          frCache.set(cacheKey, rates);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`SKIP: failed to fetch funding rates: ${msg}`);
          skipped.push({ tradeId: close.id, reason: `FR fetch error: ${msg}` });
          continue;
        }
      }

      // Filter rates to the exact position window
      const windowRates = rates.filter((r) => r.timestamp > openTs && r.timestamp <= closeTs);

      if (windowRates.length === 0) {
        console.log(`SKIP: no funding rates found in window`);
        skipped.push({ tradeId: close.id, reason: 'no funding rates in window' });
        continue;
      }

      const amount = Number(openTrade.amount);
      const fundingIncome = calculateFundingIncome(
        windowRates,
        direction,
        amount,
        openTs,
        closeTs,
        Number(close.price),
      );

      console.log(
        `income=${fundingIncome.toFixed(6)} ` +
          `(${windowRates.length} rates, ` +
          `amount=${amount}, dir=${direction}, ` +
          `open=${new Date(openTs).toISOString().slice(0, 10)} -> ` +
          `close=${new Date(closeTs).toISOString().slice(0, 10)})`,
      );

      updates.push({
        tradeId: close.id,
        sessionId: close.session_id,
        symbol: close.symbol,
        openTimestamp: openTs,
        closeTimestamp: closeTs,
        openAmount: amount,
        direction,
        fundingRatesUsed: windowRates.length,
        calculatedFundingIncome: fundingIncome,
      });
    }

    // ------------------------------------------------------------------
    // Step 3: Apply updates (unless dry-run)
    // ------------------------------------------------------------------
    console.log('');
    console.log('=== Summary ===');
    console.log(`Trades to update: ${updates.length}`);
    console.log(`Trades skipped:   ${skipped.length}`);

    if (skipped.length > 0) {
      console.log('\nSkipped trades:');
      for (const s of skipped) {
        console.log(`  Trade #${s.tradeId}: ${s.reason}`);
      }
    }

    if (updates.length > 0) {
      console.log('\nProposed updates:');
      let totalFundingIncome = 0;
      for (const u of updates) {
        console.log(
          `  Trade #${u.tradeId} (${u.symbol} ${u.direction}): ` +
            `funding_income = ${u.calculatedFundingIncome.toFixed(6)} ` +
            `(${u.fundingRatesUsed} rates)`,
        );
        totalFundingIncome += u.calculatedFundingIncome;
      }
      console.log(`\nTotal funding income across all trades: ${totalFundingIncome.toFixed(6)}`);

      if (DRY_RUN) {
        console.log('\nDRY RUN - no changes written. Run with --apply to apply updates.');
      } else {
        console.log('\nApplying updates...');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const u of updates) {
            await client.query(
              `UPDATE paper_trades SET funding_income = $1 WHERE id = $2`,
              [u.calculatedFundingIncome, u.tradeId],
            );
          }
          await client.query('COMMIT');
          console.log(`Successfully updated ${updates.length} trade(s).`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
