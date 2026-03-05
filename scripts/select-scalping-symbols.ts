#!/usr/bin/env node
/**
 * Scalping Symbol Selector
 *
 * Data-driven symbol ranking for 4 HF scalping strategies using existing
 * cached 4h candle data (74 Bybit perp symbols, 2+ years) and funding rates.
 *
 * Strategies scored:
 *   1. FR Settlement       — trade around 8h funding rate events
 *   2. Volatility Regime   — range expansion / breakout scalping
 *   3. VWAP Reversion      — mean reversion around VWAP
 *   4. Liquidation Bounce  — catch liquidation cascades and reversals
 *
 * Usage:
 *   npx tsx scripts/select-scalping-symbols.ts
 *   npx tsx scripts/select-scalping-symbols.ts --top=15 --json
 *   npx tsx scripts/select-scalping-symbols.ts --lookback-days=90
 */

import type { Candle, FundingRate, Timeframe } from '../src/core/types.js';
import { getCandles, getFundingRates, getCandleDateRange, getPool, closeDb } from '../src/data/db.js';

// ============================================================================
// CLI argument parsing
// ============================================================================

interface CliArgs {
  top: number;
  lookbackDays: number;
  json: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let top = 12;
  let lookbackDays = 180;
  let json = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    const [key, value] = arg.split('=');
    if (!key || value === undefined) continue;
    switch (key) {
      case '--top':
        top = parseInt(value, 10);
        break;
      case '--lookback-days':
        lookbackDays = parseInt(value, 10);
        break;
    }
  }

  return { top, lookbackDays, json };
}

// ============================================================================
// Types
// ============================================================================

interface RawMetrics {
  symbol: string;
  candleCount: number;
  // Candle-based metrics (raw values)
  avgDailyVolume: number;       // Mean daily USD volume
  volatility: number;           // Annualized stddev of 4h returns
  avgBarRange: number;          // Mean (high-low)/close per bar
  volumeSpikeFreq: number;      // Fraction of bars with vol > 3x rolling 20-bar avg
  maxDrawdownSpeed: number;     // Largest 6-bar (1 day) consecutive pct drop
  // Funding rate metrics (raw values)
  frExtremeness: number;        // Fraction of FR readings in top/bottom 15th pct (per-symbol)
  frVolatility: number;         // Stddev of funding rates
  avgAbsFR: number;             // Mean |fundingRate|
  hasFundingData: boolean;
}

interface NormalizedMetrics {
  avgDailyVolume: number;
  volatility: number;
  avgBarRange: number;
  volumeSpikeFreq: number;
  maxDrawdownSpeed: number;
  frExtremeness: number;
  frVolatility: number;
  avgAbsFR: number;
}

interface StrategyScores {
  frSettlement: number;
  volatilityRegime: number;
  vwapReversion: number;
  liquidationBounce: number;
  combined: number;
}

interface SymbolResult {
  rank: number;
  symbol: string;
  scores: StrategyScores;
  raw: RawMetrics;
  mandatory: boolean;
}

// ============================================================================
// Mandatory symbols (always included regardless of score)
// ============================================================================

const MANDATORY_SYMBOLS = new Set([
  'BTC/USDT:USDT',
  'ETH/USDT:USDT',
  'LDO/USDT:USDT',
  'DOGE/USDT:USDT',
]);

// ============================================================================
// Metric computation helpers
// ============================================================================

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeCandleMetrics(candles: Candle[]): Omit<RawMetrics, 'symbol' | 'frExtremeness' | 'frVolatility' | 'avgAbsFR' | 'hasFundingData'> {
  const n = candles.length;
  if (n < 2) {
    return {
      candleCount: n,
      avgDailyVolume: 0,
      volatility: 0,
      avgBarRange: 0,
      volumeSpikeFreq: 0,
      maxDrawdownSpeed: 0,
    };
  }

  // --- avgDailyVolume ---
  // 4h bars: 6 bars per day. Group into days (6 bars each) and sum USD volume per day.
  const usdVolumes: number[] = [];
  for (let i = 0; i < n; i += 6) {
    let dayVol = 0;
    for (let j = i; j < Math.min(i + 6, n); j++) {
      dayVol += candles[j].close * candles[j].volume;
    }
    usdVolumes.push(dayVol);
  }
  const avgDailyVolume = usdVolumes.reduce((a, b) => a + b, 0) / usdVolumes.length;

  // --- returns for volatility ---
  const returns: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = candles[i - 1].close;
    if (prev > 0) {
      returns.push((candles[i].close - prev) / prev);
    }
  }
  // 4h bars: 6 bars/day, 365 days/year → 2190 bars/year
  const volatility = stddev(returns) * Math.sqrt(2190);

  // --- avgBarRange ---
  let totalRange = 0;
  for (const c of candles) {
    if (c.close > 0) totalRange += (c.high - c.low) / c.close;
  }
  const avgBarRange = totalRange / n;

  // --- volumeSpikeFreq ---
  const windowSize = 20;
  let spikeCount = 0;
  let eligibleBars = 0;
  for (let i = windowSize; i < n; i++) {
    const window = candles.slice(i - windowSize, i);
    const avgVol = window.reduce((sum, c) => sum + c.volume, 0) / windowSize;
    if (avgVol > 0) {
      eligibleBars++;
      if (candles[i].volume > 3 * avgVol) spikeCount++;
    }
  }
  const volumeSpikeFreq = eligibleBars > 0 ? spikeCount / eligibleBars : 0;

  // --- maxDrawdownSpeed ---
  // Largest sum of consecutive 6 bars of negative returns (1 trading day equivalent)
  let maxDrop = 0;
  for (let i = 0; i <= n - 6; i++) {
    const startPrice = candles[i].close;
    const endPrice = candles[i + 5].close;
    if (startPrice > 0) {
      const drop = (startPrice - endPrice) / startPrice;
      if (drop > maxDrop) maxDrop = drop;
    }
  }
  const maxDrawdownSpeed = maxDrop;

  return {
    candleCount: n,
    avgDailyVolume,
    volatility,
    avgBarRange,
    volumeSpikeFreq,
    maxDrawdownSpeed,
  };
}

function computeFRMetrics(rates: FundingRate[]): Pick<RawMetrics, 'frExtremeness' | 'frVolatility' | 'avgAbsFR'> {
  if (rates.length === 0) {
    return { frExtremeness: 0, frVolatility: 0, avgAbsFR: 0 };
  }

  const values = rates.map((r) => r.fundingRate);

  // Per-symbol percentile thresholds (top/bottom 15%)
  const sorted = [...values].sort((a, b) => a - b);
  const lowIdx = Math.floor(sorted.length * 0.15);
  const highIdx = Math.floor(sorted.length * 0.85);
  const lowThreshold = sorted[lowIdx] ?? sorted[0];
  const highThreshold = sorted[highIdx] ?? sorted[sorted.length - 1];

  const extremeCount = values.filter((v) => v <= lowThreshold || v >= highThreshold).length;
  const frExtremeness = extremeCount / values.length;

  const frVolatility = stddev(values);
  const avgAbsFR = values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;

  return { frExtremeness, frVolatility, avgAbsFR };
}

// ============================================================================
// Normalization
// ============================================================================

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0.5);
  return values.map((v) => (v - min) / range);
}

function normalizeMetrics(rawList: RawMetrics[]): NormalizedMetrics[] {
  const fields: (keyof NormalizedMetrics)[] = [
    'avgDailyVolume',
    'volatility',
    'avgBarRange',
    'volumeSpikeFreq',
    'maxDrawdownSpeed',
    'frExtremeness',
    'frVolatility',
    'avgAbsFR',
  ];

  const normalized: NormalizedMetrics[] = rawList.map(() => ({
    avgDailyVolume: 0,
    volatility: 0,
    avgBarRange: 0,
    volumeSpikeFreq: 0,
    maxDrawdownSpeed: 0,
    frExtremeness: 0,
    frVolatility: 0,
    avgAbsFR: 0,
  }));

  for (const field of fields) {
    const vals = rawList.map((r) => r[field] as number);
    const normVals = normalize(vals);
    normVals.forEach((v, i) => {
      normalized[i][field] = v;
    });
  }

  return normalized;
}

// ============================================================================
// Strategy scoring
// ============================================================================

function computeStrategyScores(norm: NormalizedMetrics): StrategyScores {
  const frSettlement =
    norm.frExtremeness * 0.5 +
    norm.avgAbsFR * 0.3 +
    norm.avgDailyVolume * 0.2;

  const volatilityRegime =
    norm.avgBarRange * 0.4 +
    norm.volumeSpikeFreq * 0.3 +
    norm.volatility * 0.3;

  const vwapReversion =
    norm.avgDailyVolume * 0.4 +
    norm.volatility * 0.3 +
    norm.avgAbsFR * 0.3;

  const liquidationBounce =
    norm.maxDrawdownSpeed * 0.4 +
    norm.volumeSpikeFreq * 0.3 +
    norm.volatility * 0.3;

  const combined = (frSettlement + volatilityRegime + vwapReversion + liquidationBounce) / 4;

  return { frSettlement, volatilityRegime, vwapReversion, liquidationBounce, combined };
}

// ============================================================================
// Table formatting helpers
// ============================================================================

function fmt2(n: number): string {
  return n.toFixed(3);
}

function fmtVolume(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { top, lookbackDays, json } = parseArgs();

  // Initialize pool (no migration needed — we're read-only)
  const pool = getPool();

  if (!json) {
    console.log('\nScalping Symbol Selector — Bybit Perp Futures');
    console.log('='.repeat(60));
    console.log(`Lookback: ${lookbackDays} days of 4h candles`);
    console.log(`Mandatory: BTC, ETH, LDO, DOGE (always included)`);
  }

  // --- Discover available symbols ---
  const { rows: symbolRows } = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM candles WHERE exchange = 'bybit' AND timeframe = '4h' ORDER BY symbol`
  );
  const allSymbols = symbolRows.map((r) => r.symbol);

  if (!json) {
    console.log(`\nFound ${allSymbols.length} symbols with cached 4h data`);
  }

  // --- Determine lookback window ---
  // Find the most recent candle across all symbols, then go back lookbackDays
  const { rows: maxTsRows } = await pool.query<{ max_ts: string }>(
    `SELECT MAX(timestamp) as max_ts FROM candles WHERE exchange = 'bybit' AND timeframe = '4h'`
  );
  const maxTs = maxTsRows[0]?.max_ts != null ? Number(maxTsRows[0].max_ts) : Date.now();
  const startTs = maxTs - lookbackDays * 24 * 60 * 60 * 1000;

  if (!json) {
    const startDate = new Date(startTs).toISOString().split('T')[0];
    const endDate = new Date(maxTs).toISOString().split('T')[0];
    console.log(`Date range: ${startDate} → ${endDate}\n`);
    console.log('Computing metrics...');
  }

  // --- Compute metrics for each symbol ---
  const rawMetricsList: RawMetrics[] = [];

  for (const symbol of allSymbols) {
    process.stdout.write(json ? '' : `  ${symbol.padEnd(22)} `);

    // Load candles
    const candles = await getCandles('bybit', symbol, '4h', startTs, maxTs);

    if (candles.length < 50) {
      if (!json) console.log(`SKIP (only ${candles.length} candles)`);
      continue;
    }

    // Load funding rates
    const fundingRates = await getFundingRates('bybit', symbol, startTs, maxTs);

    // Compute metrics
    const candleMetrics = computeCandleMetrics(candles);
    const frMetrics = computeFRMetrics(fundingRates);

    const raw: RawMetrics = {
      symbol,
      ...candleMetrics,
      ...frMetrics,
      hasFundingData: fundingRates.length > 0,
    };

    rawMetricsList.push(raw);

    if (!json) {
      console.log(
        `${candles.length} bars | vol ${fmtVolume(raw.avgDailyVolume)}/day | ` +
        `annVol ${fmtPct(raw.volatility)} | FR ${raw.hasFundingData ? `${fundingRates.length} pts` : 'none'}`
      );
    }
  }

  if (!json) console.log(`\nComputed metrics for ${rawMetricsList.length} symbols`);

  // --- Normalize metrics ---
  const normalizedList = normalizeMetrics(rawMetricsList);

  // --- Compute strategy scores ---
  const results: Omit<SymbolResult, 'rank'>[] = rawMetricsList.map((raw, i) => {
    const norm = normalizedList[i];
    const scores = computeStrategyScores(norm);
    return {
      symbol: raw.symbol,
      scores,
      raw,
      mandatory: MANDATORY_SYMBOLS.has(raw.symbol),
    };
  });

  // --- Sort by combined score descending ---
  results.sort((a, b) => b.scores.combined - a.scores.combined);

  // --- Select top N, ensuring mandatory symbols are always included ---
  const topN = results.slice(0, top);
  const includedSymbols = new Set(topN.map((r) => r.symbol));

  // Add mandatory symbols that didn't make the top N
  for (const sym of MANDATORY_SYMBOLS) {
    if (!includedSymbols.has(sym)) {
      const found = results.find((r) => r.symbol === sym);
      if (found) topN.push(found);
    }
  }

  // Re-sort after adding mandatory
  topN.sort((a, b) => b.scores.combined - a.scores.combined);

  // Assign ranks
  const ranked: SymbolResult[] = topN.map((r, i) => ({ ...r, rank: i + 1 }));

  // --- JSON output mode ---
  if (json) {
    const output = {
      generatedAt: new Date(maxTs).toISOString(),
      lookbackDays,
      symbolCount: rawMetricsList.length,
      topSymbols: ranked.map((r) => ({
        rank: r.rank,
        symbol: r.symbol,
        mandatory: r.mandatory,
        scores: {
          combined: parseFloat(r.scores.combined.toFixed(4)),
          frSettlement: parseFloat(r.scores.frSettlement.toFixed(4)),
          volatilityRegime: parseFloat(r.scores.volatilityRegime.toFixed(4)),
          vwapReversion: parseFloat(r.scores.vwapReversion.toFixed(4)),
          liquidationBounce: parseFloat(r.scores.liquidationBounce.toFixed(4)),
        },
        raw: {
          avgDailyVolumeUSD: parseFloat(r.raw.avgDailyVolume.toFixed(0)),
          annualizedVolatility: parseFloat(r.raw.volatility.toFixed(4)),
          avgBarRangePct: parseFloat((r.raw.avgBarRange * 100).toFixed(4)),
          volumeSpikeFreq: parseFloat(r.raw.volumeSpikeFreq.toFixed(4)),
          maxDrawdownSpeed: parseFloat((r.raw.maxDrawdownSpeed * 100).toFixed(4)),
          frExtremeness: parseFloat(r.raw.frExtremeness.toFixed(4)),
          frVolatility: parseFloat(r.raw.frVolatility.toFixed(6)),
          avgAbsFR: parseFloat(r.raw.avgAbsFR.toFixed(6)),
          hasFundingData: r.raw.hasFundingData,
          candleCount: r.raw.candleCount,
        },
      })),
      recommendedSymbols: ranked.map((r) => r.symbol),
    };
    console.log(JSON.stringify(output, null, 2));
    await closeDb();
    process.exit(0);
  }

  // --- Pretty table output ---
  console.log('\n');
  console.log('='.repeat(120));
  console.log('SCALPING SYMBOL RANKING');
  console.log('='.repeat(120));

  // Header row
  const hdr = [
    pad('Rank', 5),
    pad('Symbol', 22),
    pad('Combined', 9, true),
    pad('FR-Settle', 10, true),
    pad('VolRegime', 10, true),
    pad('VWAP-Rev', 9, true),
    pad('LiqBounce', 10, true),
    pad('Mandatory', 10),
  ].join(' | ');
  console.log(hdr);
  console.log('-'.repeat(120));

  for (const r of ranked) {
    const flag = r.mandatory ? '*** ' : '    ';
    const row = [
      pad(`${flag}${r.rank}`, 5),
      pad(r.symbol, 22),
      pad(fmt2(r.scores.combined), 9, true),
      pad(fmt2(r.scores.frSettlement), 10, true),
      pad(fmt2(r.scores.volatilityRegime), 10, true),
      pad(fmt2(r.scores.vwapReversion), 9, true),
      pad(fmt2(r.scores.liquidationBounce), 10, true),
      r.mandatory ? 'MANDATORY' : '',
    ].join(' | ');
    console.log(row);
  }

  console.log('\n');
  console.log('='.repeat(120));
  console.log('RAW METRICS');
  console.log('='.repeat(120));

  const hdr2 = [
    pad('Rank', 5),
    pad('Symbol', 22),
    pad('DailyVolUSD', 12, true),
    pad('AnnVol%', 8, true),
    pad('BarRange%', 10, true),
    pad('VolSpike%', 10, true),
    pad('MaxDD1d%', 9, true),
    pad('FRExtrm%', 9, true),
    pad('FRVolat', 9, true),
    pad('AvgAbsFR', 9, true),
    pad('Bars', 6, true),
  ].join(' | ');
  console.log(hdr2);
  console.log('-'.repeat(120));

  for (const r of ranked) {
    const m = r.raw;
    const row = [
      pad(`${r.rank}`, 5, true),
      pad(r.symbol, 22),
      pad(fmtVolume(m.avgDailyVolume), 12, true),
      pad(fmtPct(m.volatility), 8, true),
      pad(fmtPct(m.avgBarRange), 10, true),
      pad(fmtPct(m.volumeSpikeFreq), 10, true),
      pad(fmtPct(m.maxDrawdownSpeed), 9, true),
      pad(fmtPct(m.frExtremeness), 9, true),
      pad(m.frVolatility.toExponential(2), 9, true),
      pad(m.avgAbsFR.toExponential(2), 9, true),
      pad(String(m.candleCount), 6, true),
    ].join(' | ');
    console.log(row);
  }

  // --- Breakdown by strategy ---
  console.log('\n');
  console.log('='.repeat(80));
  console.log('TOP 5 PER STRATEGY');
  console.log('='.repeat(80));

  const strategies: Array<{ name: string; key: keyof StrategyScores }> = [
    { name: 'FR Settlement        (FR Extremeness×0.5 + AvgAbsFR×0.3 + Volume×0.2)', key: 'frSettlement' },
    { name: 'Volatility Regime    (BarRange×0.4 + VolSpike×0.3 + Volatility×0.3)', key: 'volatilityRegime' },
    { name: 'VWAP Reversion       (Volume×0.4 + Volatility×0.3 + AvgAbsFR×0.3)', key: 'vwapReversion' },
    { name: 'Liquidation Bounce   (MaxDD1d×0.4 + VolSpike×0.3 + Volatility×0.3)', key: 'liquidationBounce' },
  ];

  for (const strat of strategies) {
    const sorted = [...results].sort((a, b) => b.scores[strat.key] - a.scores[strat.key]);
    console.log(`\n${strat.name}:`);
    sorted.slice(0, 5).forEach((r, i) => {
      const flag = r.mandatory ? ' [mandatory]' : '';
      console.log(`  ${i + 1}. ${r.symbol.padEnd(22)} score: ${fmt2(r.scores[strat.key])}${flag}`);
    });
  }

  // --- Final recommendation ---
  console.log('\n');
  console.log('='.repeat(80));
  console.log('RECOMMENDED SYMBOLS FOR SCALPING BACKTESTS');
  console.log('='.repeat(80));
  console.log(`\nTop ${ranked.length} symbols (*** = mandatory override):\n`);

  const recommendedSymbols = ranked.map((r) => r.symbol);
  ranked.forEach((r, i) => {
    const flag = r.mandatory ? '***' : '   ';
    console.log(
      `  ${flag} ${String(i + 1).padStart(2)}. ${r.symbol.padEnd(22)} combined=${fmt2(r.scores.combined)}`
    );
  });

  console.log(`\nJSON list (pipe-friendly):`);
  console.log(JSON.stringify(recommendedSymbols, null, 2));

  console.log('\nDone.\n');

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
