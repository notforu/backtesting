#!/usr/bin/env npx tsx
/**
 * PM Monte Carlo Null Hypothesis Test
 *
 * Determines whether the pm-mean-reversion strategy has real edge
 * or if random entries on bounded [0,1] PM prices produce comparable results.
 *
 * For each market with >= 500 real candles:
 *   1. Runs an inline simulation of pm-mean-reversion (same BB logic)
 *   2. Runs N random-entry simulations calibrated to same trade frequency
 *   3. Computes p-value = fraction of random sims >= real strategy Sharpe
 *
 * Usage:
 *   npx tsx scripts/pm-monte-carlo-test.ts [--simulations=500] [--min-candles=500] [--slippage=1.0] [--json]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getPool } from '../src/data/db.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  simulations: number;
  minCandles: number;
  slippagePct: number;
  jsonOnly: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const match = args.find(a => a.startsWith(`--${flag}=`));
    return match ? Number(match.split('=')[1]) : fallback;
  };
  return {
    simulations: get('simulations', 500),
    minCandles: get('min-candles', 500),
    slippagePct: get('slippage', 1.0),
    jsonOnly: args.includes('--json'),
  };
}

// ============================================================================
// Types
// ============================================================================

interface CandleRow {
  symbol: string;
  timestamp: number;
  close: number;
  volume: number;
}

interface SymbolData {
  symbol: string;
  slug: string;
  candles: CandleRow[];          // All candles (including forward-filled)
  realCandles: CandleRow[];      // Only candles with volume > 0
}

interface TradeResult {
  pnlPct: number;                // Signed P&L as fraction of entry value
  holdBars: number;
}

interface SimResult {
  sharpe: number;
  totalReturnPct: number;
  numTrades: number;
  winRate: number;
  trades: TradeResult[];
}

interface MarketMonteCarloResult {
  symbol: string;
  slug: string;
  realResult: SimResult;
  randomResults: SimResult[];
  pValue: number;                // Fraction of random sims with sharpe >= real
  randomMedianSharpe: number;
  randomP25Sharpe: number;
  randomP75Sharpe: number;
}

// ============================================================================
// Default PM Mean Reversion Parameters
// ============================================================================

const REAL_STRATEGY_PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2.0,
  exitStdDev: 0.5,
  positionSizePct: 25,
  maxPositionUSD: 5000,
  avoidExtremesPct: 5,           // Skip prices within 5% of 0 or 1
  cooldownBars: 3,
  minProfitPct: 4,               // Minimum expected profit to enter
  minBBWidth: 0.08,              // Minimum BB width to trade
};

const INITIAL_CAPITAL = 10000;

// ============================================================================
// Data Loading
// ============================================================================

async function loadMarkets(minCandles: number): Promise<SymbolData[]> {
  const pool = getPool();

  const summaryResult = await pool.query(
    `SELECT symbol,
            COUNT(*) as "totalCount",
            SUM(CASE WHEN volume > 0 THEN 1 ELSE 0 END) as "realCount"
     FROM candles
     WHERE exchange = 'polymarket' AND timeframe = '1h'
     GROUP BY symbol
     HAVING SUM(CASE WHEN volume > 0 THEN 1 ELSE 0 END) >= $1
     ORDER BY "realCount" DESC`,
    [minCandles]
  );

  const rows = summaryResult.rows.map((row) => ({
    symbol: row.symbol as string,
    totalCount: Number(row.totalCount),
    realCount: Number(row.realCount),
  }));

  const markets: SymbolData[] = [];

  for (const row of rows) {
    const candlesResult = await pool.query(
      `SELECT symbol, timestamp, close, volume
       FROM candles
       WHERE exchange = 'polymarket' AND timeframe = '1h' AND symbol = $1
       ORDER BY timestamp ASC`,
      [row.symbol]
    );

    const candles: CandleRow[] = candlesResult.rows.map((r) => ({
      symbol: r.symbol,
      timestamp: Number(r.timestamp),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    const realCandles = candles.filter(c => c.volume > 0);

    markets.push({
      symbol: row.symbol,
      slug: row.symbol.startsWith('PM:') ? row.symbol.slice(3) : row.symbol,
      candles,
      realCandles,
    });
  }

  return markets;
}

// ============================================================================
// Sharpe Ratio Calculation
// ============================================================================

/**
 * Compute annualised Sharpe from per-trade P&L percentages.
 * Uses per-trade returns (not equity curve), annualised assuming 1h bars.
 * Returns 0 if fewer than 2 trades.
 */
function computeSharpe(trades: TradeResult[]): number {
  if (trades.length < 2) return 0;

  const returns = trades.map(t => t.pnlPct);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;

  // Annualise: 8760 1h bars per year; scale by sqrt(trades_per_year_equivalent)
  // Use sqrt(8760 / avgHoldBars) as annualisation factor
  const avgHold = trades.reduce((s, t) => s + t.holdBars, 0) / trades.length;
  const tradesPerYear = 8760 / Math.max(avgHold, 1);
  const annFactor = Math.sqrt(tradesPerYear);

  return (mean / stddev) * annFactor;
}

function computeTotalReturn(trades: TradeResult[], initialCapital: number): number {
  let equity = initialCapital;
  for (const t of trades) {
    equity *= (1 + t.pnlPct);
  }
  return ((equity - initialCapital) / initialCapital) * 100;
}

function computeWinRate(trades: TradeResult[]): number {
  if (trades.length === 0) return 0;
  return trades.filter(t => t.pnlPct > 0).length / trades.length * 100;
}

// ============================================================================
// Real Strategy Simulation (inline BB logic)
// ============================================================================

function runRealStrategy(
  candles: CandleRow[],
  slippagePct: number
): SimResult {
  const p = REAL_STRATEGY_PARAMS;
  const slippageFraction = slippagePct / 100;

  const trades: TradeResult[] = [];

  // Track state
  let lastExitBar = -1000;
  const priceHistory: number[] = [];

  // Position tracking
  type Side = 'long' | 'short';
  let positionSide: Side | null = null;
  let entryPrice = 0;
  let entryBar = 0;

  const extremeLowerBound = p.avoidExtremesPct / 100;        // 0.05
  const extremeUpperBound = 1 - p.avoidExtremesPct / 100;    // 0.95

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close;

    // Skip forward-filled candles
    if (candle.volume === 0) {
      continue;
    }

    // Build price history
    priceHistory.push(price);
    if (priceHistory.length > p.bbPeriod) {
      priceHistory.shift();
    }

    // Need bbPeriod bars
    if (i < p.bbPeriod) continue;

    // Calculate Bollinger Bands
    const prices = priceHistory;
    const sma = prices.reduce((s, v) => s + v, 0) / prices.length;
    const variance = prices.reduce((s, v) => s + (v - sma) ** 2, 0) / prices.length;
    const stddev = Math.sqrt(variance);
    const upperBand = sma + p.bbStdDev * stddev;
    const lowerBand = sma - p.bbStdDev * stddev;
    const bbWidth = upperBand - lowerBand;

    // Filter: too narrow
    if (bbWidth < p.minBBWidth) continue;

    const isInExtremeZone = price < extremeLowerBound || price > extremeUpperBound;

    // === EXIT LOGIC ===
    if (positionSide === 'long') {
      const exitThreshold = sma - p.exitStdDev * stddev;
      if (price >= exitThreshold || price < extremeLowerBound) {
        // Apply slippage to exit (unfavourable: long exit = lower price)
        const exitPrice = price * (1 - slippageFraction);
        const pnlPct = (exitPrice - entryPrice) / entryPrice;
        trades.push({ pnlPct, holdBars: i - entryBar });
        positionSide = null;
        lastExitBar = i;
        continue;
      }
    }

    if (positionSide === 'short') {
      const exitThreshold = sma + p.exitStdDev * stddev;
      if (price <= exitThreshold || price > extremeUpperBound) {
        // Short exit: we sold at entry, buy back at exit
        // Slippage: unfavourable = higher repurchase price
        const exitPrice = price * (1 + slippageFraction);
        const pnlPct = (entryPrice - exitPrice) / entryPrice;
        trades.push({ pnlPct, holdBars: i - entryBar });
        positionSide = null;
        lastExitBar = i;
        continue;
      }
    }

    // === ENTRY LOGIC ===
    if (positionSide === null && !isInExtremeZone) {
      if (i - lastExitBar < p.cooldownBars) continue;

      // LONG entry
      if (price < lowerBand) {
        const expectedProfit = ((sma - price) / price) * 100;
        if (expectedProfit >= p.minProfitPct) {
          // Slippage on entry: unfavourable = higher purchase price for long
          entryPrice = price * (1 + slippageFraction);
          entryBar = i;
          positionSide = 'long';
        }
      }
      // SHORT entry
      else if (price > upperBand) {
        const expectedProfit = ((price - sma) / price) * 100;
        if (expectedProfit >= p.minProfitPct) {
          // Slippage on entry: unfavourable = lower sell price for short
          entryPrice = price * (1 - slippageFraction);
          entryBar = i;
          positionSide = 'short';
        }
      }
    }
  }

  // Close open position at last bar
  if (positionSide !== null && candles.length > 0) {
    const lastPrice = candles[candles.length - 1].close;
    if (positionSide === 'long') {
      const exitPrice = lastPrice * (1 - slippageFraction);
      trades.push({ pnlPct: (exitPrice - entryPrice) / entryPrice, holdBars: candles.length - 1 - entryBar });
    } else {
      const exitPrice = lastPrice * (1 + slippageFraction);
      trades.push({ pnlPct: (entryPrice - exitPrice) / entryPrice, holdBars: candles.length - 1 - entryBar });
    }
  }

  const sharpe = computeSharpe(trades);
  return {
    sharpe,
    totalReturnPct: computeTotalReturn(trades, INITIAL_CAPITAL),
    numTrades: trades.length,
    winRate: computeWinRate(trades),
    trades,
  };
}

// ============================================================================
// Random Entry Simulation
// ============================================================================

/**
 * Generate a random integer in [min, max] inclusive.
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function runRandomStrategy(
  candles: CandleRow[],
  pEntry: number,
  medianHoldBars: number,
  slippagePct: number
): SimResult {
  const slippageFraction = slippagePct / 100;
  const maxHold = Math.max(2, Math.round(medianHoldBars * 2));
  const extremeLowerBound = REAL_STRATEGY_PARAMS.avoidExtremesPct / 100;
  const extremeUpperBound = 1 - REAL_STRATEGY_PARAMS.avoidExtremesPct / 100;

  const trades: TradeResult[] = [];

  let positionSide: 'long' | 'short' | null = null;
  let entryPrice = 0;
  let entryBar = 0;
  let holdBarsTarget = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close;

    // Skip forward-filled candles (same as real strategy)
    if (candle.volume === 0) continue;

    // Apply the same avoidExtremes filter on entries
    const isInExtremeZone = price < extremeLowerBound || price > extremeUpperBound;

    // Exit when target hold reached
    if (positionSide !== null) {
      const barsHeld = i - entryBar;
      if (barsHeld >= holdBarsTarget) {
        if (positionSide === 'long') {
          const exitPrice = price * (1 - slippageFraction);
          trades.push({ pnlPct: (exitPrice - entryPrice) / entryPrice, holdBars: barsHeld });
        } else {
          const exitPrice = price * (1 + slippageFraction);
          trades.push({ pnlPct: (entryPrice - exitPrice) / entryPrice, holdBars: barsHeld });
        }
        positionSide = null;
        continue;
      }
    }

    // Random entry
    if (positionSide === null && !isInExtremeZone && Math.random() < pEntry) {
      const side: 'long' | 'short' = Math.random() < 0.5 ? 'long' : 'short';
      holdBarsTarget = randInt(1, maxHold);
      if (side === 'long') {
        entryPrice = price * (1 + slippageFraction);
      } else {
        entryPrice = price * (1 - slippageFraction);
      }
      entryBar = i;
      positionSide = side;
    }
  }

  // Close open position at last bar
  if (positionSide !== null && candles.length > 0) {
    const lastPrice = candles[candles.length - 1].close;
    const barsHeld = candles.length - 1 - entryBar;
    if (positionSide === 'long') {
      const exitPrice = lastPrice * (1 - slippageFraction);
      trades.push({ pnlPct: (exitPrice - entryPrice) / entryPrice, holdBars: barsHeld });
    } else {
      const exitPrice = lastPrice * (1 + slippageFraction);
      trades.push({ pnlPct: (entryPrice - exitPrice) / entryPrice, holdBars: barsHeld });
    }
  }

  const sharpe = computeSharpe(trades);
  return {
    sharpe,
    totalReturnPct: computeTotalReturn(trades, INITIAL_CAPITAL),
    numTrades: trades.length,
    winRate: computeWinRate(trades),
    trades,
  };
}

// ============================================================================
// Median Helper
// ============================================================================

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(pct * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ============================================================================
// Run Monte Carlo for one market
// ============================================================================

function runMarketMonteCarlo(
  market: SymbolData,
  numSimulations: number,
  slippagePct: number,
): MarketMonteCarloResult {
  // Run real strategy
  const realResult = runRealStrategy(market.candles, slippagePct);

  // Calibrate random strategy
  const totalBarsWithVolume = market.realCandles.length;
  // Entry probability = trades / bars (with minimum floor to avoid zero)
  const pEntry = totalBarsWithVolume > 0
    ? Math.max(realResult.numTrades / totalBarsWithVolume, 0.001)
    : 0.01;

  // Median hold from real trades
  const realHoldBars = realResult.trades.map(t => t.holdBars);
  const medianHold = Math.max(1, Math.round(median(realHoldBars.length > 0 ? realHoldBars : [5])));

  // Run N random simulations
  const randomResults: SimResult[] = [];
  for (let s = 0; s < numSimulations; s++) {
    randomResults.push(runRandomStrategy(market.candles, pEntry, medianHold, slippagePct));
  }

  // Compute p-value: fraction of random simulations with sharpe >= real
  const realSharpe = realResult.sharpe;
  const betterOrEqualCount = randomResults.filter(r => r.sharpe >= realSharpe).length;
  const pValue = betterOrEqualCount / numSimulations;

  const randomSharpes = randomResults.map(r => r.sharpe);
  const randomMedianSharpe = percentile(randomSharpes, 0.5);
  const randomP25Sharpe = percentile(randomSharpes, 0.25);
  const randomP75Sharpe = percentile(randomSharpes, 0.75);

  return {
    symbol: market.symbol,
    slug: market.slug,
    realResult,
    randomResults,
    pValue,
    randomMedianSharpe,
    randomP25Sharpe,
    randomP75Sharpe,
  };
}

// ============================================================================
// Console Output
// ============================================================================

function stars(pValue: number): string {
  if (pValue <= 0.01) return '***';
  if (pValue <= 0.05) return '**';
  if (pValue <= 0.10) return '*';
  return '';
}

function printReport(
  results: MarketMonteCarloResult[],
  numSimulations: number,
  slippagePct: number,
): void {
  const sorted = [...results].sort((a, b) => a.pValue - b.pValue);

  console.log('\n' + '='.repeat(70));
  console.log('=== MONTE CARLO NULL HYPOTHESIS TEST ===');
  console.log('='.repeat(70));
  console.log(`Markets tested:         ${results.length}`);
  console.log(`Simulations per market: ${numSimulations}`);
  console.log(`Slippage:               ${slippagePct}%`);
  console.log(`Strategy:               pm-mean-reversion (default params)`);

  // Summary counts
  const sig05 = results.filter(r => r.pValue < 0.05).length;
  const sig10 = results.filter(r => r.pValue < 0.10).length;
  const worseRandom = results.filter(r => r.pValue > 0.95).length;
  const noTrades = results.filter(r => r.realResult.numTrades === 0).length;

  // Aggregate real vs random Sharpes
  const withTrades = results.filter(r => r.realResult.numTrades > 0);
  const meanRealSharpe = withTrades.length > 0
    ? withTrades.reduce((s, r) => s + r.realResult.sharpe, 0) / withTrades.length
    : 0;
  const meanRandomSharpe = results.length > 0
    ? results.reduce((s, r) => s + r.randomMedianSharpe, 0) / results.length
    : 0;
  const sharpeImprovement = meanRealSharpe - meanRandomSharpe;
  const sharpeImprovementPct = meanRandomSharpe !== 0
    ? (sharpeImprovement / Math.abs(meanRandomSharpe)) * 100
    : 0;

  console.log('\n' + '='.repeat(70));
  console.log('=== RESULTS ===');
  console.log('='.repeat(70));
  console.log(
    `Markets where real strategy significantly beats random (p < 0.05): ` +
    `${sig05}/${results.length} (${((sig05 / Math.max(results.length, 1)) * 100).toFixed(1)}%)`
  );
  console.log(
    `Markets where real strategy significantly beats random (p < 0.10): ` +
    `${sig10}/${results.length} (${((sig10 / Math.max(results.length, 1)) * 100).toFixed(1)}%)`
  );
  console.log(
    `Markets where strategy is worse than random (p > 0.95):            ` +
    `${worseRandom}/${results.length} (${((worseRandom / Math.max(results.length, 1)) * 100).toFixed(1)}%)`
  );
  console.log(
    `Markets with no trades:                                             ` +
    `${noTrades}/${results.length}`
  );
  console.log('');
  console.log(`Mean Sharpe (real strategy, trades > 0): ${meanRealSharpe.toFixed(2)}`);
  console.log(`Mean Sharpe (random entries, median):    ${meanRandomSharpe.toFixed(2)}`);
  const sign = sharpeImprovement >= 0 ? '+' : '';
  console.log(
    `Sharpe improvement:                      ${sign}${sharpeImprovement.toFixed(2)} ` +
    `(${sign}${sharpeImprovementPct.toFixed(0)}% vs random)`
  );

  // Top 15 markets by p-value (most significant)
  console.log('\n' + '='.repeat(70));
  console.log('=== TOP 15 MARKETS BY P-VALUE (most significant) ===');
  console.log('='.repeat(70));
  console.log(
    'Rank  Market (slug)                           Real Sharpe  Rand Median  p-value   Trades'
  );
  sorted.slice(0, 15).forEach((r, i) => {
    const rank = String(i + 1).padEnd(5);
    const slug = r.slug.slice(0, 39).padEnd(40);
    const realSharpe = r.realResult.sharpe.toFixed(2).padStart(11);
    const randSharpe = r.randomMedianSharpe.toFixed(2).padStart(11);
    const pVal = r.pValue.toFixed(3).padStart(8);
    const trades = String(r.realResult.numTrades).padStart(7);
    const sig = stars(r.pValue);
    console.log(`${rank} ${slug} ${realSharpe} ${randSharpe} ${pVal} ${trades} ${sig}`);
  });

  // Bottom 5 markets (worst: real strategy loses to random)
  const bottom = sorted.slice(-5).reverse();
  if (bottom.length > 0 && bottom[0].pValue > 0.5) {
    console.log('\n--- WORST 5 MARKETS (strategy underperforms random) ---');
    bottom.forEach((r, i) => {
      const slug = r.slug.slice(0, 45);
      console.log(
        `  ${i + 1}. ${slug}: Real Sharpe ${r.realResult.sharpe.toFixed(2)}, ` +
        `Random median ${r.randomMedianSharpe.toFixed(2)}, p=${r.pValue.toFixed(3)}, ` +
        `trades=${r.realResult.numTrades}`
      );
    });
  }

  // Distribution of real Sharpes
  const realSharpes = results.map(r => r.realResult.sharpe);
  console.log('\n--- DISTRIBUTION OF REAL STRATEGY SHARPES ---');
  console.log(`  Min:    ${Math.min(...realSharpes).toFixed(2)}`);
  console.log(`  P25:    ${percentile(realSharpes, 0.25).toFixed(2)}`);
  console.log(`  Median: ${percentile(realSharpes, 0.50).toFixed(2)}`);
  console.log(`  P75:    ${percentile(realSharpes, 0.75).toFixed(2)}`);
  console.log(`  Max:    ${Math.max(...realSharpes).toFixed(2)}`);

  const randAllSharpes = results.map(r => r.randomMedianSharpe);
  console.log('\n--- DISTRIBUTION OF RANDOM MEDIAN SHARPES ---');
  console.log(`  Min:    ${Math.min(...randAllSharpes).toFixed(2)}`);
  console.log(`  P25:    ${percentile(randAllSharpes, 0.25).toFixed(2)}`);
  console.log(`  Median: ${percentile(randAllSharpes, 0.50).toFixed(2)}`);
  console.log(`  P75:    ${percentile(randAllSharpes, 0.75).toFixed(2)}`);
  console.log(`  Max:    ${Math.max(...randAllSharpes).toFixed(2)}`);

  // Conclusion
  console.log('\n' + '='.repeat(70));
  console.log('=== CONCLUSION ===');
  console.log('='.repeat(70));

  const sig05Pct = (sig05 / Math.max(results.length, 1)) * 100;
  const expectedByChance = 5; // Expected ~5% of markets to pass p<0.05 by chance

  if (sig05Pct > 25) {
    console.log(
      `STRONG EVIDENCE OF REAL EDGE: ${sig05Pct.toFixed(1)}% of markets show p < 0.05 ` +
      `(expected ~5% by chance). The strategy significantly outperforms random entries ` +
      `on a large fraction of markets.`
    );
  } else if (sig05Pct > 10) {
    console.log(
      `MODERATE EVIDENCE OF REAL EDGE: ${sig05Pct.toFixed(1)}% of markets show p < 0.05 ` +
      `(expected ~5% by chance). The strategy outperforms random on more markets than ` +
      `expected, but the edge may be concentrated in specific market types.`
    );
  } else if (sig05Pct >= expectedByChance) {
    console.log(
      `WEAK EVIDENCE OF REAL EDGE: ${sig05Pct.toFixed(1)}% of markets show p < 0.05 ` +
      `(expected ~5% by chance). Results are borderline - may reflect limited sample ` +
      `size or concentrated edge rather than broad strategy effectiveness.`
    );
  } else {
    console.log(
      `NO CLEAR EVIDENCE OF REAL EDGE: Only ${sig05Pct.toFixed(1)}% of markets show p < 0.05 ` +
      `(expected ~5% by chance). The strategy does not appear to systematically outperform ` +
      `random entries with calibrated holding periods. Consider reviewing strategy parameters ` +
      `or the structural assumptions about PM price dynamics.`
    );
  }

  if (sharpeImprovement > 0) {
    console.log(
      `\nMean Sharpe improvement over random: +${sharpeImprovement.toFixed(2)} ` +
      `(${sharpeImprovementPct.toFixed(0)}%). Even if not statistically significant per-market, ` +
      `the aggregate improvement suggests some systematic benefit.`
    );
  } else {
    console.log(
      `\nMean Sharpe vs random: ${sharpeImprovement.toFixed(2)} (no improvement). ` +
      `The strategy does not improve average Sharpe ratio over random entries.`
    );
  }

  console.log('\n  Significance key: *** p<0.01  ** p<0.05  * p<0.10');
  console.log('='.repeat(70));
}

// ============================================================================
// Save JSON Report
// ============================================================================

function saveJsonReport(
  results: MarketMonteCarloResult[],
  numSimulations: number,
  slippagePct: number,
  durationMs: number,
): void {
  const outputDir = join(process.cwd(), 'results', 'pm-pipeline');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'monte-carlo-report.json');

  // Compute summary
  const sig05 = results.filter(r => r.pValue < 0.05).length;
  const sig10 = results.filter(r => r.pValue < 0.10).length;
  const worseRandom = results.filter(r => r.pValue > 0.95).length;
  const withTrades = results.filter(r => r.realResult.numTrades > 0);
  const meanRealSharpe = withTrades.length > 0
    ? withTrades.reduce((s, r) => s + r.realResult.sharpe, 0) / withTrades.length
    : 0;
  const meanRandomSharpe = results.length > 0
    ? results.reduce((s, r) => s + r.randomMedianSharpe, 0) / results.length
    : 0;

  const report = {
    timestamp: new Date().toISOString(),
    config: {
      strategy: 'pm-mean-reversion',
      params: REAL_STRATEGY_PARAMS,
      numSimulations,
      slippagePct,
      exchange: 'polymarket',
      timeframe: '1h',
    },
    summary: {
      marketsTestedTotal: results.length,
      marketsWithTrades: withTrades.length,
      significant05: sig05,
      significant05Pct: Number(((sig05 / Math.max(results.length, 1)) * 100).toFixed(1)),
      significant10: sig10,
      significant10Pct: Number(((sig10 / Math.max(results.length, 1)) * 100).toFixed(1)),
      worseThanRandom: worseRandom,
      worseThanRandomPct: Number(((worseRandom / Math.max(results.length, 1)) * 100).toFixed(1)),
      meanRealSharpe: Number(meanRealSharpe.toFixed(3)),
      meanRandomMedianSharpe: Number(meanRandomSharpe.toFixed(3)),
      sharpeDifference: Number((meanRealSharpe - meanRandomSharpe).toFixed(3)),
      durationSeconds: Number((durationMs / 1000).toFixed(1)),
    },
    markets: results.sort((a, b) => a.pValue - b.pValue).map(r => ({
      slug: r.slug,
      symbol: r.symbol,
      pValue: Number(r.pValue.toFixed(4)),
      significant: r.pValue < 0.05,
      realSharpe: Number(r.realResult.sharpe.toFixed(3)),
      realTotalReturnPct: Number(r.realResult.totalReturnPct.toFixed(2)),
      realNumTrades: r.realResult.numTrades,
      realWinRate: Number(r.realResult.winRate.toFixed(1)),
      randomMedianSharpe: Number(r.randomMedianSharpe.toFixed(3)),
      randomP25Sharpe: Number(r.randomP25Sharpe.toFixed(3)),
      randomP75Sharpe: Number(r.randomP75Sharpe.toFixed(3)),
    })),
  };

  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report saved to: ${outputPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { simulations, minCandles, slippagePct, jsonOnly } = parseArgs();

  if (!jsonOnly) {
    console.log('PM Monte Carlo Null Hypothesis Test');
    console.log(`Loading polymarket markets with >= ${minCandles} real candles...`);
  }

  const startTime = Date.now();

  // Load markets from DB
  const markets = await loadMarkets(minCandles);

  if (markets.length === 0) {
    console.log(`No markets found with >= ${minCandles} real candles.`);
    console.log('Run pm-discover-and-cache.ts first to cache market data.');
    process.exit(0);
  }

  if (!jsonOnly) {
    console.log(`Found ${markets.length} markets. Running Monte Carlo test...`);
    console.log(`Configuration: ${simulations} simulations per market, ${slippagePct}% slippage`);
    console.log('');
  }

  // Run Monte Carlo for each market
  const results: MarketMonteCarloResult[] = [];
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const result = runMarketMonteCarlo(market, simulations, slippagePct);
    results.push(result);

    if (!jsonOnly) {
      const realSharpe = result.realResult.sharpe.toFixed(2);
      const pValStr = result.pValue.toFixed(3);
      const sig = stars(result.pValue);
      process.stdout.write(
        `[${i + 1}/${markets.length}] ${market.slug.slice(0, 45).padEnd(46)}` +
        ` Real Sharpe: ${realSharpe.padStart(6)}, p-value: ${pValStr} ${sig}\n`
      );
    }
  }

  const durationMs = Date.now() - startTime;

  if (!jsonOnly) {
    printReport(results, simulations, slippagePct);
  }

  saveJsonReport(results, simulations, slippagePct, durationMs);

  if (!jsonOnly) {
    console.log(`\nTotal runtime: ${(durationMs / 1000).toFixed(1)}s`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
