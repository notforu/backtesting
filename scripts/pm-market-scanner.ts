#!/usr/bin/env npx tsx
/**
 * Polymarket Market Scanner for pm-mean-reversion Strategy
 *
 * Comprehensive scan: fetches 200+ active markets, checks actual CLOB data
 * availability in the 2025-01-01 to 2026-02-17 period, then backtests each
 * with both default AND looser parameters to find best markets.
 *
 * Usage: npx tsx scripts/pm-market-scanner.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runBacktest } from '../src/core/engine.js';

// ============================================================================
// Configuration
// ============================================================================

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const STRATEGY = 'pm-mean-reversion';
const TIMEFRAME = '1h';
const START_DATE = new Date('2025-01-01').getTime();
const END_DATE = new Date('2026-02-17').getTime();
const INITIAL_CAPITAL = 10000;
const BETWEEN_BACKTESTS_MS = 2000;
const MAX_BACKTESTS = 35;

// Screening criteria
const MIN_VOLUME = 5_000;
const MIN_AGE_DAYS = 30;
const MIN_CLOB_PTS = 20;

// Default params vs looser params to discover more trading opportunities
const DEFAULT_PARAMS = {};
const LOOSE_PARAMS = {
  minBBWidth: 0.04,   // Half the default (0.08) - catch narrower range markets
  minProfitPct: 2,    // Half the default (4%) - enter more trades
  bbPeriod: 20,
  bbStdDev: 2.0,
};

// Short-duration event slugs to skip
const SKIP_KEYWORDS = [
  '-4h-', '-15m-', '-1h-',
  'spread-home', 'spread-away',
  'bitcoin-up-or-down', 'eth-up-or-down', 'btc-up-or-down',
];

// ============================================================================
// Types
// ============================================================================

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  clobTokenIds: string;
  active: boolean;
  volume: string;
  createdAt: string;
  endDate?: string;
}

interface MarketCandidate {
  slug: string;
  question: string;
  volume: number;
  tokenId: string;
  clobPts900: number;
  daysSpan900: number;
}

interface ScanResult {
  rank: number;
  slug: string;
  question: string;
  days: number;
  clobPts: number;
  returnPct: number;
  sharpe: number;
  maxDDPct: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  paramsUsed: 'default' | 'loose';
}

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen - 3) + '...';
}

function parseTokenId(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed[0] : String(parsed);
  } catch {
    return raw.split(',')[0].trim();
  }
}

// ============================================================================
// Fetch markets
// ============================================================================

async function fetchMarkets(): Promise<GammaMarket[]> {
  console.log('Fetching active markets from Gamma API...');
  const allMarkets: GammaMarket[] = [];
  const seen = new Set<string>();

  // Multiple pages, multiple sort orders to maximize coverage
  const fetches = [
    // Top by volume
    ...Array.from({ length: 4 }, (_, i) =>
      `${GAMMA_API}/markets?limit=100&offset=${i * 100}&active=true&order=volume&ascending=false`
    ),
    // Recent active markets (started within 2025)
    ...Array.from({ length: 3 }, (_, i) =>
      `${GAMMA_API}/markets?limit=100&offset=${i * 100}&active=true&order=startDate&ascending=false`
    ),
  ];

  for (const url of fetches) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const markets = await res.json() as GammaMarket[];
      if (!Array.isArray(markets)) continue;
      for (const m of markets) {
        if (!seen.has(m.slug)) { seen.add(m.slug); allMarkets.push(m); }
      }
    } catch { /* ignore */ }
    await sleep(200);
  }

  console.log(`Fetched ${allMarkets.length} unique active markets\n`);
  return allMarkets;
}

// ============================================================================
// Check CLOB history (fidelity=900 for speed)
// ============================================================================

async function checkHistory(tokenId: string): Promise<{ points: number; daysSpan: number }> {
  try {
    const url = `${CLOB_API}/prices-history?market=${tokenId}&interval=all&fidelity=900`;
    const res = await fetch(url);
    if (!res.ok) return { points: 0, daysSpan: 0 };
    const data = await res.json() as { history?: Array<{ t: number; p: number }> };
    const h = data.history ?? [];
    if (h.length < 2) return { points: h.length, daysSpan: 0 };
    return {
      points: h.length,
      daysSpan: Math.round((h[h.length - 1].t - h[0].t) / 86400),
    };
  } catch {
    return { points: 0, daysSpan: 0 };
  }
}

// ============================================================================
// Screen markets
// ============================================================================

async function screenMarkets(allMarkets: GammaMarket[]): Promise<MarketCandidate[]> {
  console.log(`Screening ${allMarkets.length} markets for CLOB data...`);

  const now = Date.now();
  const minAgeMs = MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const candidates: MarketCandidate[] = [];
  let checkedClob = 0;
  let passedBasic = 0;

  for (const market of allMarkets) {
    if (!market.clobTokenIds) continue;

    const volume = parseFloat(market.volume || '0');
    if (volume < MIN_VOLUME) continue;

    if (market.createdAt) {
      const age = now - new Date(market.createdAt).getTime();
      if (age < minAgeMs) continue;
    }

    const slugLower = (market.slug || '').toLowerCase();
    if (SKIP_KEYWORDS.some(kw => slugLower.includes(kw))) continue;

    const tokenId = parseTokenId(market.clobTokenIds);
    if (!tokenId || tokenId.length < 10) continue;

    passedBasic++;

    // Rate-limited CLOB check
    const { points, daysSpan } = await checkHistory(tokenId);
    await sleep(150);
    checkedClob++;

    if (points < MIN_CLOB_PTS) continue;
    if (daysSpan < 10) continue;

    candidates.push({
      slug: market.slug,
      question: market.question || '',
      volume,
      tokenId,
      clobPts900: points,
      daysSpan900: daysSpan,
    });

    console.log(
      `  [${candidates.length}] ${market.slug}` +
      ` (${daysSpan}d, ${points} pts, $${Math.round(volume).toLocaleString()})`
    );
  }

  // Sort by coverage (days * points) to prioritize rich data
  candidates.sort((a, b) => (b.daysSpan900 * b.clobPts900) - (a.daysSpan900 * a.clobPts900));

  console.log(`\n${candidates.length} candidates found (passed basic: ${passedBasic}, checked CLOB: ${checkedClob})\n`);
  return candidates;
}

// ============================================================================
// Backtest a market with given params
// ============================================================================

async function backtestMarket(
  candidate: MarketCandidate,
  params: Record<string, unknown>,
  paramsLabel: 'default' | 'loose'
): Promise<ScanResult | null> {
  const config = {
    id: uuidv4(),
    strategyName: STRATEGY,
    params,
    symbol: `PM:${candidate.slug}`,
    timeframe: TIMEFRAME as '1h',
    startDate: START_DATE,
    endDate: END_DATE,
    initialCapital: INITIAL_CAPITAL,
    exchange: 'polymarket',
  };

  try {
    const result = await runBacktest(config, {
      saveResults: false,
      enableLogging: false,
      skipFeeFetch: true,
      broker: { slippagePercent: 1 },
    });

    const { metrics } = result;
    const eq = result.equity;
    const days = eq.length >= 2
      ? Math.round((eq[eq.length - 1].timestamp - eq[0].timestamp) / 86400000)
      : 0;

    return {
      rank: 0,
      slug: candidate.slug,
      question: candidate.question,
      days,
      clobPts: candidate.clobPts900,
      returnPct: metrics.totalReturnPercent,
      sharpe: metrics.sharpeRatio,
      maxDDPct: metrics.maxDrawdownPercent,
      trades: metrics.totalTrades,
      winRate: metrics.winRate * 100,
      profitFactor: metrics.profitFactor,
      paramsUsed: paramsLabel,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Print ranked table
// ============================================================================

function printTable(results: ScanResult[]): void {
  const W = 155;
  console.log('\n' + '='.repeat(W));
  console.log('PM MEAN REVERSION MARKET SCAN RESULTS (sorted by Sharpe)');
  console.log('='.repeat(W));

  console.log([
    '#'.padEnd(3),
    'Market Slug'.padEnd(62),
    'Params'.padEnd(7),
    'Days'.padStart(5),
    'Pts'.padStart(5),
    'Return%'.padStart(9),
    'Sharpe'.padStart(8),
    'MaxDD%'.padStart(8),
    'Trades'.padStart(8),
    'Win%'.padStart(6),
    'PF'.padStart(6),
  ].join(' '));
  console.log('-'.repeat(W));

  for (const r of results) {
    const pfStr = isFinite(r.profitFactor) && r.profitFactor > 0 ? r.profitFactor.toFixed(2) : 'N/A';
    const sharpeStr = isFinite(r.sharpe) ? r.sharpe.toFixed(2) : 'N/A';
    console.log([
      r.rank.toString().padEnd(3),
      truncate(r.slug, 61).padEnd(62),
      r.paramsUsed.padEnd(7),
      r.days.toString().padStart(5),
      r.clobPts.toString().padStart(5),
      r.returnPct.toFixed(1).padStart(9),
      sharpeStr.padStart(8),
      r.maxDDPct.toFixed(1).padStart(8),
      r.trades.toString().padStart(8),
      r.winRate.toFixed(0).padStart(6),
      pfStr.padStart(6),
    ].join(' '));
  }

  console.log('='.repeat(W));

  const withTrades = results.filter(r => r.trades >= 2);
  const profitable = results.filter(r => r.returnPct > 0 && r.trades >= 2);
  const goodSharpe = results.filter(r => r.sharpe > 0.5 && r.trades >= 2);

  console.log(`\nSummary: ${results.length} backtested | ${withTrades.length} with 2+ trades | ${profitable.length} profitable | ${goodSharpe.length} Sharpe > 0.5`);

  if (goodSharpe.length > 0) {
    console.log('\nRecommended markets for pm-mean-reversion:');
    goodSharpe.forEach((r, i) => {
      console.log(`  ${i + 1}. PM:${r.slug}`);
      console.log(`     "${truncate(r.question, 100)}"`);
      console.log(`     Sharpe ${r.sharpe.toFixed(2)} | Return ${r.returnPct.toFixed(1)}% | MaxDD ${r.maxDDPct.toFixed(1)}% | ${r.trades} trades | Params: ${r.paramsUsed}`);
    });
  } else if (withTrades.length > 0) {
    console.log('\nMarkets with trades (no Sharpe > 0.5):');
    withTrades.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. PM:${r.slug} | Return ${r.returnPct.toFixed(1)}% | Sharpe ${r.sharpe.toFixed(2)} | ${r.trades} trades`);
    });
  }
}

// ============================================================================
// Save results
// ============================================================================

function saveResults(results: ScanResult[], candidates: MarketCandidate[]): string {
  const dir = '/workspace/results/pm-mean-reversion';
  mkdirSync(dir, { recursive: true });
  const filename = join(dir, 'market-scan-full.json');

  writeFileSync(filename, JSON.stringify({
    timestamp: new Date().toISOString(),
    strategy: STRATEGY,
    timeframe: TIMEFRAME,
    startDate: new Date(START_DATE).toISOString(),
    endDate: new Date(END_DATE).toISOString(),
    initialCapital: INITIAL_CAPITAL,
    candidatesFound: candidates.length,
    backtested: results.length,
    defaultParams: DEFAULT_PARAMS,
    looseParams: LOOSE_PARAMS,
    results,
  }, null, 2));

  return filename;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Polymarket Market Scanner - pm-mean-reversion Strategy');
  console.log(`Period: ${new Date(START_DATE).toISOString().split('T')[0]} to ${new Date(END_DATE).toISOString().split('T')[0]}`);
  console.log(`Testing both default params AND loose params (minBBWidth=0.04, minProfitPct=2)`);
  console.log('='.repeat(80) + '\n');

  // 1. Fetch + screen markets
  const allMarkets = await fetchMarkets();
  const candidates = await screenMarkets(allMarkets);

  if (candidates.length === 0) {
    console.log('No viable markets found. Exiting.');
    return;
  }

  const toBacktest = candidates.slice(0, MAX_BACKTESTS);
  console.log(`Running backtests on ${toBacktest.length} markets (default params first, then loose for 0-trade markets)...\n`);

  const results: ScanResult[] = [];

  for (let i = 0; i < toBacktest.length; i++) {
    const candidate = toBacktest[i];
    console.log(`\n[${i + 1}/${toBacktest.length}] ${candidate.slug}`);

    // Always run with default params
    const defaultResult = await backtestMarket(candidate, DEFAULT_PARAMS, 'default');
    const defaultTrades = defaultResult?.trades ?? 0;
    let info = `  default: return=${defaultResult?.returnPct.toFixed(1) ?? 'err'}% | trades=${defaultTrades}`;

    // If 0 trades with default, also try loose params
    let looseResult: ScanResult | null = null;
    if (defaultTrades === 0) {
      looseResult = await backtestMarket(candidate, LOOSE_PARAMS, 'loose');
      info += ` | loose: return=${looseResult?.returnPct.toFixed(1) ?? 'err'}% | trades=${looseResult?.trades ?? 0}`;
    }
    console.log(info);

    // Keep the better result (prefer default, use loose if more trades)
    let best = defaultResult;
    if (looseResult && (looseResult.trades > (defaultResult?.trades ?? 0))) {
      best = looseResult;
    }

    if (best) results.push(best);

    if (i < toBacktest.length - 1) await sleep(BETWEEN_BACKTESTS_MS);
  }

  // Sort by Sharpe
  results.sort((a, b) => {
    const aS = isFinite(a.sharpe) ? a.sharpe : -Infinity;
    const bS = isFinite(b.sharpe) ? b.sharpe : -Infinity;
    return bS - aS;
  });
  results.forEach((r, i) => { r.rank = i + 1; });

  printTable(results);

  const savedFile = saveResults(results, candidates);
  console.log(`\nResults saved to: ${savedFile}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
