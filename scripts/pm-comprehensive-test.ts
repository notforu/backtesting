#!/usr/bin/env npx tsx
/**
 * Comprehensive PM strategy testing across multiple markets and timeframes
 * Fetches data, runs backtests, and outputs results table
 */

import { execSync } from 'child_process';

interface BacktestResult {
  market: string;
  timeframe: string;
  strategy: string;
  sharpe: number;
  returnPct: number;
  trades: number;
  winRate: number;
  maxDD: number;
  profitFactor: number | null;
  avgTradeDuration: number;
}

// Markets to test - diverse categories
const SINGLE_MARKETS = [
  // Already cached (from previous sessions)
  'PM:starmer-out-by-june-30-2026-862-594',
  'PM:will-us-or-israel-strike-iran-by-february-28-2026-766',
  'PM:will-there-be-at-least-10000-measles-cases-in-the-us-in-2026-418-668-617',
  'PM:khamenei-out-as-supreme-leader-of-iran-by-march-31',
  'PM:will-opensea-launch-a-token-by-march-31-2026',
  'PM:trump-out-as-president-before-2027',
  'PM:ukraine-election-held-by-december-31-2026-344-142',
  'PM:russia-x-ukraine-ceasefire-before-2027',
  'PM:russia-x-ukraine-ceasefire-by-june-30-2026',
  // New markets with longer history
  'PM:will-trump-deport-250000-500000-people',
  'PM:will-trump-deport-less-than-250000',
  'PM:will-gta-6-cost-100',
  'PM:negative-gdp-growth-in-2025',
  'PM:will-tariffs-generate-250b-in-2025',
  'PM:will-sinners-win-best-picture-at-the-98th-academy-awards',
  'PM:will-austria-win-the-most-gold-medals-in-the-2026-winter-olympics',
  'PM:will-elon-and-doge-cut-more-than-250b-in-federal-spending-in-2025',
  'PM:openai-ipo-before-2027',
  'PM:will-india-strike-pakistan-by-december-31-2026',
];

// Pairs to test
const PAIR_MARKETS = [
  ['PM:starmer-out-by-december-31-2026-936-416', 'PM:starmer-out-by-june-30-2026-862-594'],
  ['PM:will-russia-capture-kostyantynivka-by-december-31-2026-936-942', 'PM:will-russia-capture-kostyantynivka-by-march-31-872-578'],
  ['PM:russia-x-ukraine-ceasefire-before-2027', 'PM:russia-x-ukraine-ceasefire-by-june-30-2026'],
  ['PM:will-trump-deport-250000-500000-people', 'PM:will-trump-deport-less-than-250000'],
  ['PM:will-elon-and-doge-cut-more-than-250b-in-federal-spending-in-2025', 'PM:will-elon-and-doge-cut-less-than-50b-in-federal-spending-in-2025'],
];

const TIMEFRAMES = ['1h', '4h'];

function runBacktest(args: string): BacktestResult | null {
  try {
    const output = execSync(
      `npx tsx src/cli/quant-backtest.ts ${args}`,
      { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const result = JSON.parse(output);
    if (!result.success) return null;

    const m = result.metrics;
    return {
      market: '',
      timeframe: '',
      strategy: '',
      sharpe: m.sharpeRatio || 0,
      returnPct: m.totalReturnPercent || 0,
      trades: m.totalTrades || 0,
      winRate: m.winRate || 0,
      maxDD: m.maxDrawdownPercent || 0,
      profitFactor: m.profitFactor,
      avgTradeDuration: m.avgTradeDuration || 0,
    };
  } catch (e: any) {
    return null;
  }
}

async function main() {
  const results: BacktestResult[] = [];

  console.log('=== PM Strategy Comprehensive Testing ===\n');

  // Test pm-information-edge on single markets
  console.log('--- Testing pm-information-edge ---\n');

  for (const market of SINGLE_MARKETS) {
    for (const tf of TIMEFRAMES) {
      const slug = market.replace('PM:', '');
      const shortName = slug.substring(0, 40);

      process.stderr.write(`  ${shortName} @ ${tf}... `);

      const r = runBacktest(
        `--strategy=pm-information-edge --symbol="${market}" --timeframe=${tf} --from=2025-01-01 --to=2026-12-31 --slippage=1 --exchange=polymarket`
      );

      if (r) {
        r.market = slug;
        r.timeframe = tf;
        r.strategy = 'info-edge';
        results.push(r);
        process.stderr.write(`Sharpe=${r.sharpe.toFixed(2)}, Ret=${r.returnPct.toFixed(1)}%, Trades=${r.trades}\n`);
      } else {
        process.stderr.write(`FAILED\n`);
      }
    }
  }

  // Test pm-correlation-pairs
  console.log('\n--- Testing pm-correlation-pairs ---\n');

  for (const [marketA, marketB] of PAIR_MARKETS) {
    for (const tf of TIMEFRAMES) {
      const slugA = marketA.replace('PM:', '').substring(0, 20);
      const slugB = marketB.replace('PM:', '').substring(0, 20);

      process.stderr.write(`  ${slugA}/${slugB} @ ${tf}... `);

      const r = runBacktest(
        `--strategy=pm-correlation-pairs --symbol="${marketA}" --symbol-b="${marketB}" --timeframe=${tf} --from=2025-01-01 --to=2026-12-31 --slippage=1 --exchange=polymarket`
      );

      if (r) {
        r.market = `${marketA.replace('PM:', '').substring(0, 25)} / ${marketB.replace('PM:', '').substring(0, 25)}`;
        r.timeframe = tf;
        r.strategy = 'corr-pairs';
        results.push(r);
        process.stderr.write(`Sharpe=${r.sharpe.toFixed(2)}, Ret=${r.returnPct.toFixed(1)}%, Trades=${r.trades}\n`);
      } else {
        process.stderr.write(`FAILED\n`);
      }
    }
  }

  // Output results as JSON
  console.log('\n=== RESULTS JSON ===');
  console.log(JSON.stringify(results, null, 2));

  // Output summary table
  console.log('\n=== SUMMARY TABLE ===\n');
  console.log('Strategy | Market | TF | Sharpe | Return% | Trades | WinRate% | MaxDD% | PF');
  console.log('---------|--------|----|---------|---------|---------|---------|---------|---------');

  for (const r of results.sort((a, b) => b.sharpe - a.sharpe)) {
    const mkt = r.market.substring(0, 35).padEnd(35);
    const pf = r.profitFactor !== null ? r.profitFactor.toFixed(1) : 'n/a';
    console.log(
      `${r.strategy.padEnd(10)} | ${mkt} | ${r.timeframe} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.returnPct.toFixed(1).padStart(7)} | ${String(r.trades).padStart(6)} | ${r.winRate.toFixed(0).padStart(6)} | ${r.maxDD.toFixed(1).padStart(6)} | ${pf}`
    );
  }

  // Count profitable strategies
  const profitable = results.filter(r => r.returnPct > 0);
  const total = results.length;
  console.log(`\nProfitable: ${profitable.length}/${total} (${(profitable.length/total*100).toFixed(0)}%)`);
  console.log(`Average Sharpe (all): ${(results.reduce((s, r) => s + r.sharpe, 0) / total).toFixed(2)}`);
  console.log(`Average Sharpe (profitable): ${(profitable.reduce((s, r) => s + r.sharpe, 0) / profitable.length).toFixed(2)}`);
}

main().catch(console.error);
