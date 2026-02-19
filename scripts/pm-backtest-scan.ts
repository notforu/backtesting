#!/usr/bin/env npx tsx
/**
 * PM Backtest Scan - Phase 2 of PM Pipeline
 *
 * Loads cached Polymarket markets, runs backtests with multiple strategies,
 * discovers correlated pairs, runs walk-forward validation, and produces
 * a ranked report.
 *
 * Usage: npx tsx scripts/pm-backtest-scan.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runBacktest } from '../src/core/engine.js';
import { runPairsBacktest } from '../src/core/pairs-engine.js';
import { getPool, getCandles, getCandleDateRange } from '../src/data/db.js';
import type { PairsBacktestConfig } from '../src/core/types.js';

// ============================================================================
// Configuration
// ============================================================================

const MANIFEST_PATH = join(process.cwd(), 'results', 'pm-pipeline', 'manifest.json');
const REPORT_PATH = join(process.cwd(), 'results', 'pm-pipeline', 'report.json');
const EXCHANGE = 'polymarket';
const TIMEFRAME = '1h' as const;
const INITIAL_CAPITAL = 10000;
const SLIPPAGE_PERCENT = 1;
const MIN_CANDLE_COUNT = 500;
const STRATEGIES = ['pm-mean-reversion', 'pm-information-edge'] as const;
const PAIRS_STRATEGY = 'pm-correlation-pairs';
const TOP_N_WALKFORWARD = 20;
const MIN_CORRELATION = 0.85;
const MIN_OVERLAP_BARS = 500;

// Walk-forward split
const TRAIN_SPLIT = 0.7;

// Engine config - skip fee fetching, no DB save to speed up scan
const ENGINE_CONFIG = {
  skipFeeFetch: true,
  saveResults: false,
  enableLogging: false,
  broker: {
    slippagePercent: SLIPPAGE_PERCENT,
    commissionPercent: 0,
    feeRate: 0.02, // 2% fee for PM markets (worst case)
  },
};

// ============================================================================
// Types
// ============================================================================

interface ManifestMarket {
  slug: string;
  question: string;
  volume: string;
  category: string;
  endDate: string;
  cacheStatus: 'cached' | 'pending' | 'error' | 'skipped';
  candleCount: number;
  realCandleCount: number;
  dataSpanDays: number;
  errorMessage: string | null;
}

interface Manifest {
  timestamp: string;
  discoveredTotal: number;
  afterScreening: number;
  markets: ManifestMarket[];
}

interface CachedMarket {
  slug: string;
  question: string;
  symbol: string;
  candleCount: number;
  realCandleCount: number;
  dataSpanDays: number;
  startDate: number;
  endDate: number;
}

interface SingleAssetResult {
  slug: string;
  question: string;
  strategy: string;
  totalReturn: number;
  sharpe: number;
  adjustedSharpe: number;
  trades: number;
  winRate: number;
  maxDD: number;
  profitFactor: number;
  dataSpanDays: number;
  tier: 'high_confidence' | 'promising' | 'low_confidence' | 'no_trades';
}

interface PairsResult {
  slugA: string;
  slugB: string;
  questionA: string;
  questionB: string;
  correlation: number;
  totalReturn: number;
  sharpe: number;
  adjustedSharpe: number;
  trades: number;
  winRate: number;
  maxDD: number;
  profitFactor: number;
}

interface WalkForwardResult {
  slug: string;
  question: string;
  strategy: string;
  isSharpe: number;
  oosSharpe: number;
  isReturn: number;
  oosReturn: number;
  oosTrades: number;
  degradation: number;
  passed: boolean;
}

// ============================================================================
// Step 1: Load manifest and discover cached markets
// ============================================================================

async function loadCachedMarkets(): Promise<CachedMarket[]> {
  console.log('=== Step 1: Loading cached markets ===');

  const pool = getPool();

  // Query all polymarket 1h candle groups from DB
  const queryResult = await pool.query(
    `SELECT symbol,
            COUNT(*) as "candleCount",
            SUM(CASE WHEN volume > 0 THEN 1 ELSE 0 END) as "realCandleCount",
            MIN(timestamp) as "minTs",
            MAX(timestamp) as "maxTs"
     FROM candles
     WHERE exchange = $1 AND timeframe = $2
     GROUP BY symbol
     ORDER BY "candleCount" DESC`,
    [EXCHANGE, TIMEFRAME]
  );
  const rows = queryResult.rows.map((row) => ({
    symbol: row.symbol as string,
    candleCount: Number(row.candleCount),
    realCandleCount: Number(row.realCandleCount),
    minTs: Number(row.minTs),
    maxTs: Number(row.maxTs),
  }));

  // Try to load manifest for question text
  let manifestMap = new Map<string, string>();
  if (existsSync(MANIFEST_PATH)) {
    try {
      const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      for (const m of manifest.markets) {
        manifestMap.set(`PM:${m.slug}`, m.question);
      }
      console.log(`  Manifest loaded: ${manifest.markets.length} markets in manifest`);
    } catch (err) {
      console.log('  Warning: Could not parse manifest, using slugs as questions');
    }
  } else {
    console.log('  No manifest found at', MANIFEST_PATH, '- using DB-only discovery');
  }

  // Filter to markets with enough real candles
  const markets: CachedMarket[] = [];
  for (const row of rows) {
    if (row.realCandleCount < MIN_CANDLE_COUNT) continue;

    const slug = row.symbol.startsWith('PM:') ? row.symbol.slice(3) : row.symbol;
    const question = manifestMap.get(row.symbol) || slug;
    const dataSpanDays = Math.round((row.maxTs - row.minTs) / (86400 * 1000));

    markets.push({
      slug,
      question,
      symbol: row.symbol,
      candleCount: row.candleCount,
      realCandleCount: row.realCandleCount,
      dataSpanDays,
      startDate: row.minTs,
      endDate: row.maxTs,
    });
  }

  console.log(`  Total PM symbols cached in DB: ${rows.length}`);
  console.log(`  Markets with >= ${MIN_CANDLE_COUNT} real candles: ${markets.length}`);
  markets.forEach(m => {
    console.log(`    - ${m.slug}: ${m.realCandleCount} real candles, ${m.dataSpanDays} days`);
  });

  return markets;
}

// ============================================================================
// Step 2: Run single-asset backtests
// ============================================================================

async function runSingleAssetBacktests(markets: CachedMarket[]): Promise<SingleAssetResult[]> {
  console.log('\n=== Step 2: Single-asset backtests ===');

  const results: SingleAssetResult[] = [];
  const total = markets.length * STRATEGIES.length;
  let completed = 0;

  for (const market of markets) {
    for (const strategy of STRATEGIES) {
      completed++;
      process.stdout.write(
        `  [${completed}/${total}] ${strategy} @ ${market.slug.slice(0, 40)}... `
      );

      try {
        const result = await runBacktest(
          {
            id: uuidv4(),
            strategyName: strategy,
            params: {},
            symbol: market.symbol,
            timeframe: TIMEFRAME,
            startDate: market.startDate,
            endDate: market.endDate,
            initialCapital: INITIAL_CAPITAL,
            exchange: EXCHANGE,
          },
          ENGINE_CONFIG
        );

        const m = result.metrics;
        const trades = result.trades.length;
        const adjustedSharpe = m.sharpeRatio * Math.min(1.0, trades / 10);

        let tier: SingleAssetResult['tier'];
        if (trades >= 10 && adjustedSharpe > 1.0) {
          tier = 'high_confidence';
        } else if (trades >= 5 && adjustedSharpe > 0.5) {
          tier = 'promising';
        } else if (trades > 0) {
          tier = 'low_confidence';
        } else {
          tier = 'no_trades';
        }

        const r: SingleAssetResult = {
          slug: market.slug,
          question: market.question,
          strategy,
          totalReturn: m.totalReturnPercent,
          sharpe: m.sharpeRatio,
          adjustedSharpe,
          trades,
          winRate: m.winRate,
          maxDD: m.maxDrawdownPercent,
          profitFactor: m.profitFactor ?? 0,
          dataSpanDays: market.dataSpanDays,
          tier,
        };

        results.push(r);
        console.log(
          `Sharpe=${m.sharpeRatio.toFixed(2)}, Ret=${m.totalReturnPercent.toFixed(1)}%, Trades=${trades}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`ERROR: ${msg.slice(0, 60)}`);
      }
    }
  }

  console.log(`\n  Completed ${results.length} backtests`);
  return results;
}

// ============================================================================
// Step 3: Pairs discovery and backtesting
// ============================================================================

function computePearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;

  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }

  const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  if (denom === 0) return 0;
  return (n * sumAB - sumA * sumB) / denom;
}

interface TimestampedPrices {
  symbol: string;
  slug: string;
  question: string;
  priceMap: Map<number, number>; // timestamp -> close price
}

async function runPairsDiscovery(markets: CachedMarket[]): Promise<PairsResult[]> {
  console.log('\n=== Step 3: Pairs discovery ===');

  if (markets.length < 2) {
    console.log('  Not enough markets for pairs discovery (need >= 2)');
    return [];
  }

  // Load all price series
  console.log('  Loading price series for all markets...');
  const priceSeries: TimestampedPrices[] = [];

  for (const market of markets) {
    const candles = await getCandles(EXCHANGE, market.symbol, TIMEFRAME, market.startDate, market.endDate);
    const priceMap = new Map<number, number>();
    for (const c of candles) {
      if (c.volume > 0) {
        priceMap.set(c.timestamp, c.close);
      }
    }
    priceSeries.push({
      symbol: market.symbol,
      slug: market.slug,
      question: market.question,
      priceMap,
    });
  }

  // Find high-correlation pairs
  console.log(`  Computing pairwise correlations for ${priceSeries.length} markets...`);
  const qualifyingPairs: Array<{
    a: TimestampedPrices;
    b: TimestampedPrices;
    correlation: number;
    overlapBars: number;
  }> = [];

  for (let i = 0; i < priceSeries.length; i++) {
    for (let j = i + 1; j < priceSeries.length; j++) {
      const seriesA = priceSeries[i];
      const seriesB = priceSeries[j];

      // Find overlapping timestamps
      const alignedA: number[] = [];
      const alignedB: number[] = [];

      for (const [ts, priceA] of seriesA.priceMap) {
        const priceB = seriesB.priceMap.get(ts);
        if (priceB !== undefined) {
          alignedA.push(priceA);
          alignedB.push(priceB);
        }
      }

      if (alignedA.length < MIN_OVERLAP_BARS) continue;

      const corr = computePearsonCorrelation(alignedA, alignedB);

      if (corr >= MIN_CORRELATION) {
        console.log(
          `    Found pair: ${seriesA.slug.slice(0, 35)} / ${seriesB.slug.slice(0, 35)} corr=${corr.toFixed(3)} overlap=${alignedA.length}`
        );
        qualifyingPairs.push({ a: seriesA, b: seriesB, correlation: corr, overlapBars: alignedA.length });
      }
    }
  }

  console.log(`  Found ${qualifyingPairs.length} pairs with correlation >= ${MIN_CORRELATION}`);

  if (qualifyingPairs.length === 0) {
    return [];
  }

  // Run pairs backtests
  const results: PairsResult[] = [];
  let completed = 0;

  for (const pair of qualifyingPairs) {
    completed++;
    process.stdout.write(
      `  [${completed}/${qualifyingPairs.length}] Pairs backtest: ${pair.a.slug.slice(0, 25)} / ${pair.b.slug.slice(0, 25)}... `
    );

    try {
      // Get overlapping date range
      const tsA = Array.from(pair.a.priceMap.keys()).sort((a, b) => a - b);
      const tsB = Array.from(pair.b.priceMap.keys()).sort((a, b) => a - b);
      const startDate = Math.max(tsA[0], tsB[0]);
      const endDate = Math.min(tsA[tsA.length - 1], tsB[tsB.length - 1]);

      const config: PairsBacktestConfig = {
        id: uuidv4(),
        strategyName: PAIRS_STRATEGY,
        params: {},
        symbolA: pair.a.symbol,
        symbolB: pair.b.symbol,
        timeframe: TIMEFRAME,
        startDate,
        endDate,
        initialCapital: INITIAL_CAPITAL,
        exchange: EXCHANGE,
        leverage: 1,
      };

      const result = await runPairsBacktest(config, ENGINE_CONFIG);

      const m = result.metrics;
      const trades = result.trades.length;
      const adjustedSharpe = m.sharpeRatio * Math.min(1.0, trades / 10);

      results.push({
        slugA: pair.a.slug,
        slugB: pair.b.slug,
        questionA: pair.a.question,
        questionB: pair.b.question,
        correlation: pair.correlation,
        totalReturn: m.totalReturnPercent,
        sharpe: m.sharpeRatio,
        adjustedSharpe,
        trades,
        winRate: m.winRate,
        maxDD: m.maxDrawdownPercent,
        profitFactor: m.profitFactor ?? 0,
      });

      console.log(
        `Sharpe=${m.sharpeRatio.toFixed(2)}, Ret=${m.totalReturnPercent.toFixed(1)}%, Trades=${trades}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg.slice(0, 60)}`);
    }
  }

  return results;
}

// ============================================================================
// Step 4: Walk-forward validation
// ============================================================================

async function runWalkForward(
  markets: CachedMarket[],
  singleAssetResults: SingleAssetResult[],
  pairsResults: PairsResult[]
): Promise<WalkForwardResult[]> {
  console.log('\n=== Step 4: Walk-forward validation ===');

  // Build candidates: top 20 by adjustedSharpe from single-asset + profitable pairs
  const candidateMap = new Map<string, { market: CachedMarket; strategy: string; adjSharpe: number }>();

  // Sort single-asset results by adjustedSharpe descending
  const sortedSingle = [...singleAssetResults].sort((a, b) => b.adjustedSharpe - a.adjustedSharpe);
  let count = 0;
  for (const r of sortedSingle) {
    if (count >= TOP_N_WALKFORWARD) break;
    const key = `${r.slug}|${r.strategy}`;
    if (!candidateMap.has(key)) {
      const market = markets.find(m => m.slug === r.slug);
      if (market) {
        candidateMap.set(key, { market, strategy: r.strategy, adjSharpe: r.adjustedSharpe });
        count++;
      }
    }
  }

  console.log(`  Running walk-forward on ${candidateMap.size} candidates (top ${TOP_N_WALKFORWARD} by adjusted Sharpe)`);

  const results: WalkForwardResult[] = [];
  let completed = 0;
  const total = candidateMap.size;

  for (const [key, candidate] of candidateMap) {
    completed++;
    const { market, strategy } = candidate;
    process.stdout.write(
      `  [${completed}/${total}] WF: ${strategy} @ ${market.slug.slice(0, 35)}... `
    );

    try {
      const totalDuration = market.endDate - market.startDate;
      const trainEnd = market.startDate + Math.floor(totalDuration * TRAIN_SPLIT);

      // In-sample backtest
      const isResult = await runBacktest(
        {
          id: uuidv4(),
          strategyName: strategy,
          params: {},
          symbol: market.symbol,
          timeframe: TIMEFRAME,
          startDate: market.startDate,
          endDate: trainEnd,
          initialCapital: INITIAL_CAPITAL,
          exchange: EXCHANGE,
        },
        ENGINE_CONFIG
      );

      // Out-of-sample backtest
      const oosResult = await runBacktest(
        {
          id: uuidv4(),
          strategyName: strategy,
          params: {},
          symbol: market.symbol,
          timeframe: TIMEFRAME,
          startDate: trainEnd + 1,
          endDate: market.endDate,
          initialCapital: INITIAL_CAPITAL,
          exchange: EXCHANGE,
        },
        ENGINE_CONFIG
      );

      const isM = isResult.metrics;
      const oosM = oosResult.metrics;
      const oosTrades = oosResult.trades.length;

      // Compute degradation: (oosReturn - isReturn) / abs(isReturn)
      const degradation = isM.totalReturnPercent !== 0
        ? (oosM.totalReturnPercent - isM.totalReturnPercent) / Math.abs(isM.totalReturnPercent)
        : 0;

      // Pass criteria
      const passed = (
        oosM.sharpeRatio > 0.3 &&
        oosTrades >= 5 &&
        oosM.totalReturnPercent > 0 &&
        degradation > -0.6
      );

      results.push({
        slug: market.slug,
        question: market.question,
        strategy,
        isSharpe: isM.sharpeRatio,
        oosSharpe: oosM.sharpeRatio,
        isReturn: isM.totalReturnPercent,
        oosReturn: oosM.totalReturnPercent,
        oosTrades,
        degradation,
        passed,
      });

      const passStr = passed ? 'PASS' : 'FAIL';
      console.log(
        `IS-Sharpe=${isM.sharpeRatio.toFixed(2)} OOS-Sharpe=${oosM.sharpeRatio.toFixed(2)} OOS-Trades=${oosTrades} ${passStr}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg.slice(0, 60)}`);
    }
  }

  return results;
}

// ============================================================================
// Step 5: Generate report
// ============================================================================

function generateReport(
  markets: CachedMarket[],
  singleAssetResults: SingleAssetResult[],
  pairsResults: PairsResult[],
  walkForwardResults: WalkForwardResult[]
): void {
  console.log('\n=== Step 5: Generating report ===');

  const date = new Date().toISOString().slice(0, 10);

  // Summary statistics per strategy
  const summaryStats: Record<string, { profitable: number; total: number; sharpeSumTotal: number; count: number }> = {};
  for (const strategy of STRATEGIES) {
    const stratResults = singleAssetResults.filter(r => r.strategy === strategy);
    const profitable = stratResults.filter(r => r.totalReturn > 0).length;
    const sharpeSum = stratResults.reduce((sum, r) => sum + r.sharpe, 0);
    summaryStats[strategy] = {
      profitable,
      total: stratResults.length,
      sharpeSumTotal: sharpeSum,
      count: stratResults.length,
    };
  }

  const pairsProfitable = pairsResults.filter(r => r.totalReturn > 0).length;
  const wfPassed = walkForwardResults.filter(r => r.passed).length;

  const summary = {
    ...Object.fromEntries(
      STRATEGIES.map(s => {
        const stats = summaryStats[s];
        const avgSharpe = stats.count > 0 ? stats.sharpeSumTotal / stats.count : 0;
        return [s, `${stats.profitable}/${stats.total} (${Math.round(stats.profitable / Math.max(stats.total, 1) * 100)}%), avg Sharpe ${avgSharpe.toFixed(2)}`];
      })
    ),
    [`${PAIRS_STRATEGY}`]: `${pairsProfitable}/${pairsResults.length} pairs profitable, avg Sharpe ${pairsResults.length > 0 ? (pairsResults.reduce((s, r) => s + r.sharpe, 0) / pairsResults.length).toFixed(2) : '0.00'}`,
    walkForwardPassRate: `${wfPassed}/${walkForwardResults.length} (${Math.round(wfPassed / Math.max(walkForwardResults.length, 1) * 100)}%)`,
  };

  // Save JSON report
  const report = {
    timestamp: new Date().toISOString(),
    marketsScanned: markets.length,
    strategiesTested: [...STRATEGIES, PAIRS_STRATEGY],
    singleAssetResults: singleAssetResults.sort((a, b) => b.adjustedSharpe - a.adjustedSharpe),
    pairsResults: pairsResults.sort((a, b) => b.adjustedSharpe - a.adjustedSharpe),
    walkForwardResults,
    summary,
  };

  mkdirSync(join(process.cwd(), 'results', 'pm-pipeline'), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`  Report saved to: ${REPORT_PATH}`);

  // ============================================================
  // Console report
  // ============================================================

  console.log(`\n${'='.repeat(70)}`);
  console.log(`=== PM STRATEGY SCAN RESULTS (${date}) ===`);
  console.log(`${markets.length} markets scanned | ${STRATEGIES.length + 1} strategies | ${TIMEFRAME} timeframe | ${SLIPPAGE_PERCENT}% slippage`);
  console.log('='.repeat(70));

  // High confidence
  const highConf = singleAssetResults
    .filter(r => r.tier === 'high_confidence')
    .sort((a, b) => b.adjustedSharpe - a.adjustedSharpe);

  if (highConf.length > 0) {
    console.log('\n--- HIGH CONFIDENCE (10+ trades, adj. Sharpe > 1.0) ---');
    const hdr = '#   Strategy               Market                               Days  Trades  Return%  Sharpe  AdjSharpe  MaxDD%  WR%';
    console.log(hdr);
    highConf.forEach((r, i) => {
      const rank = String(i + 1).padEnd(4);
      const strat = r.strategy.padEnd(22);
      const market = r.slug.slice(0, 36).padEnd(37);
      const days = String(r.dataSpanDays).padStart(4);
      const trades = String(r.trades).padStart(6);
      const ret = `${r.totalReturn.toFixed(1)}%`.padStart(7);
      const sharpe = r.sharpe.toFixed(2).padStart(6);
      const adjSharpe = r.adjustedSharpe.toFixed(2).padStart(9);
      const maxdd = `${r.maxDD.toFixed(1)}%`.padStart(6);
      const wr = `${Math.round(r.winRate)}%`.padStart(4);
      console.log(`${rank} ${strat} ${market} ${days} ${trades} ${ret} ${sharpe} ${adjSharpe} ${maxdd} ${wr}`);
    });
  } else {
    console.log('\n--- HIGH CONFIDENCE (10+ trades, adj. Sharpe > 1.0) ---');
    console.log('  None found');
  }

  // Promising
  const promising = singleAssetResults
    .filter(r => r.tier === 'promising')
    .sort((a, b) => b.adjustedSharpe - a.adjustedSharpe);

  if (promising.length > 0) {
    console.log('\n--- PROMISING (5-9 trades, adj. Sharpe > 0.5) ---');
    const hdr = '#   Strategy               Market                               Days  Trades  Return%  Sharpe  AdjSharpe  MaxDD%  WR%';
    console.log(hdr);
    promising.slice(0, 20).forEach((r, i) => {
      const rank = String(i + 1).padEnd(4);
      const strat = r.strategy.padEnd(22);
      const market = r.slug.slice(0, 36).padEnd(37);
      const days = String(r.dataSpanDays).padStart(4);
      const trades = String(r.trades).padStart(6);
      const ret = `${r.totalReturn.toFixed(1)}%`.padStart(7);
      const sharpe = r.sharpe.toFixed(2).padStart(6);
      const adjSharpe = r.adjustedSharpe.toFixed(2).padStart(9);
      const maxdd = `${r.maxDD.toFixed(1)}%`.padStart(6);
      const wr = `${Math.round(r.winRate)}%`.padStart(4);
      console.log(`${rank} ${strat} ${market} ${days} ${trades} ${ret} ${sharpe} ${adjSharpe} ${maxdd} ${wr}`);
    });
  } else {
    console.log('\n--- PROMISING (5-9 trades, adj. Sharpe > 0.5) ---');
    console.log('  None found');
  }

  // Pairs
  console.log('\n--- PAIRS DISCOVERED (correlation > 0.85) ---');
  if (pairsResults.length > 0) {
    console.log('#   Pair                                              Correlation  Trades  Return%  Sharpe  AdjSharpe');
    pairsResults.sort((a, b) => b.adjustedSharpe - a.adjustedSharpe).forEach((r, i) => {
      const rank = String(i + 1).padEnd(4);
      const pair = `${r.slugA.slice(0, 22)} / ${r.slugB.slice(0, 22)}`.padEnd(49);
      const corr = r.correlation.toFixed(3).padStart(11);
      const trades = String(r.trades).padStart(6);
      const ret = `${r.totalReturn.toFixed(1)}%`.padStart(7);
      const sharpe = r.sharpe.toFixed(2).padStart(6);
      const adjSharpe = r.adjustedSharpe.toFixed(2).padStart(9);
      console.log(`${rank} ${pair} ${corr} ${trades} ${ret} ${sharpe} ${adjSharpe}`);
    });
  } else {
    console.log('  No correlated pairs found');
  }

  // Walk-forward
  console.log('\n--- WALK-FORWARD RESULTS (70/30 split) ---');
  if (walkForwardResults.length > 0) {
    console.log('#   Strategy               Market                          IS-Sharpe  OOS-Sharpe  Degradation  PASS?');
    walkForwardResults
      .sort((a, b) => (b.passed ? 1 : 0) - (a.passed ? 1 : 0) || b.oosSharpe - a.oosSharpe)
      .forEach((r, i) => {
        const rank = String(i + 1).padEnd(4);
        const strat = r.strategy.padEnd(22);
        const market = r.slug.slice(0, 30).padEnd(31);
        const isSharpe = r.isSharpe.toFixed(2).padStart(9);
        const oosSharpe = r.oosSharpe.toFixed(2).padStart(10);
        const degradation = `${(r.degradation * 100).toFixed(0)}%`.padStart(11);
        const pass = r.passed ? 'YES' : 'NO';
        console.log(`${rank} ${strat} ${market} ${isSharpe} ${oosSharpe} ${degradation} ${pass}`);
      });
  } else {
    console.log('  No walk-forward results');
  }

  // Summary
  console.log('\n--- SUMMARY ---');
  for (const strategy of STRATEGIES) {
    const stats = summaryStats[strategy];
    const avgSharpe = stats.count > 0 ? stats.sharpeSumTotal / stats.count : 0;
    console.log(`${strategy}: ${stats.profitable}/${stats.total} profitable (${Math.round(stats.profitable / Math.max(stats.total, 1) * 100)}%), avg Sharpe ${avgSharpe.toFixed(2)}`);
  }
  if (pairsResults.length > 0) {
    const avgPairsSharpe = pairsResults.reduce((s, r) => s + r.sharpe, 0) / pairsResults.length;
    console.log(`${PAIRS_STRATEGY}: ${pairsProfitable}/${pairsResults.length} pairs profitable, avg Sharpe ${avgPairsSharpe.toFixed(2)}`);
  } else {
    console.log(`${PAIRS_STRATEGY}: no qualifying pairs found`);
  }
  console.log(`Walk-forward pass rate: ${wfPassed}/${walkForwardResults.length} (${Math.round(wfPassed / Math.max(walkForwardResults.length, 1) * 100)}%)`);
  console.log('='.repeat(70));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('PM Backtest Scan - Starting pipeline...\n');

  // Step 1: Load cached markets
  const markets = await loadCachedMarkets();

  if (markets.length === 0) {
    console.log('\nNo markets ready for backtesting (need >= 500 real candles).');
    console.log('Run pm-pipeline-fetch.ts first to cache market data.');
    process.exit(0);
  }

  // Step 2: Single-asset backtests
  const singleAssetResults = await runSingleAssetBacktests(markets);

  // Step 3: Pairs discovery
  const pairsResults = await runPairsDiscovery(markets);

  // Step 4: Walk-forward validation
  const walkForwardResults = await runWalkForward(markets, singleAssetResults, pairsResults);

  // Step 5: Generate report
  generateReport(markets, singleAssetResults, pairsResults, walkForwardResults);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
