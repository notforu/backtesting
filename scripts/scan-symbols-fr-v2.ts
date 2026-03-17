#!/usr/bin/env node
/**
 * Quick scan of many symbols for FR V2 strategy viability.
 * Runs backtests with default params and reports results sorted by Sharpe.
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import { runBacktest } from '../src/core/engine.js';
import { initDb, closeDb, saveBacktestRun } from '../src/data/db.js';
import { v4 as uuidv4 } from 'uuid';

const ALREADY_HAVE = new Set([
  'LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'NEAR', 'ZEC', 'TRB', 'IOST', 'STG',
  'ARB', 'COMP', 'TRX', 'RPL', 'ENS', 'LPT', 'IOTA',
]);

const CANDIDATES = [
  'AVAX', 'LINK', 'UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'FXS', 'GMX', 'PENDLE',
  'OP', 'APT', 'SUI', 'SEI', 'TIA', 'MANTA', 'JTO', 'PYTH', 'WLD', 'BLUR',
  'STRK', 'BONK', 'PEPE', 'WIF', 'ORDI', 'GALA', 'SAND', 'AXS', 'FTM', 'ALGO',
  'ATOM', 'DOT', 'ADA', 'SOL', 'RNDR', 'FET', 'INJ', 'THETA', 'GRT', 'FIL',
  'JASMY', 'CHZ', 'MEME', 'CAKE', 'DYDX', 'YFI', 'SUSHI', 'BAL', 'ZRX', 'KAVA',
].filter(s => !ALREADY_HAVE.has(s));

interface Result {
  symbol: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  error?: string;
}

async function main() {
  await initDb();
  const results: Result[] = [];

  console.log(`Scanning ${CANDIDATES.length} symbols for FR V2 viability...\n`);

  for (const sym of CANDIDATES) {
    const symbol = `${sym}/USDT:USDT`;
    process.stdout.write(`${sym}... `);

    try {
      const result = await runBacktest({
        id: uuidv4(),
        strategyName: 'funding-rate-spike-v2',
        symbol,
        timeframe: '4h',
        startDate: new Date('2024-01-01').getTime(),
        endDate: new Date('2026-03-01').getTime(),
        initialCapital: 10000,
        exchange: 'bybit',
        mode: 'futures',
        params: {},
      });

      const m = result.metrics;
      results.push({
        symbol: sym,
        sharpe: m.sharpeRatio,
        returnPct: m.totalReturnPercent,
        maxDD: m.maxDrawdownPercent,
        trades: m.totalTrades,
      });

      // Save to DB
      await saveBacktestRun(result);

      console.log(`Sharpe=${m.sharpeRatio.toFixed(2)} Return=${m.totalReturnPercent.toFixed(1)}% Trades=${m.totalTrades}`);
    } catch (err: any) {
      results.push({ symbol: sym, sharpe: 0, returnPct: 0, maxDD: 0, trades: 0, error: err.message?.slice(0, 60) });
      console.log(`ERROR: ${err.message?.slice(0, 60)}`);
    }
  }

  // Sort by Sharpe descending
  results.sort((a, b) => b.sharpe - a.sharpe);

  console.log('\n\n=== RESULTS (sorted by Sharpe) ===');
  console.log('| Rank | Symbol | Sharpe | Return% | MaxDD% | Trades | Verdict |');
  console.log('|------|--------|--------|---------|--------|--------|---------|');

  results.forEach((r, i) => {
    const verdict = r.error ? 'ERROR' : r.trades < 5 ? 'LOW_TRADES' : r.sharpe >= 1.0 ? 'WF_CANDIDATE' : r.sharpe >= 0.5 ? 'MARGINAL' : 'SKIP';
    console.log(
      `| ${i + 1} | ${r.symbol} | ${r.sharpe.toFixed(2)} | ${r.returnPct.toFixed(1)}% | ${r.maxDD.toFixed(1)}% | ${r.trades} | ${verdict} |`
    );
  });

  const wfCandidates = results.filter(r => r.sharpe >= 1.0 && r.trades >= 10 && !r.error);
  console.log(`\n${wfCandidates.length} symbols recommended for walk-forward validation:`);
  wfCandidates.forEach(r => console.log(`  ${r.symbol}: Sharpe=${r.sharpe.toFixed(2)}, ${r.trades} trades`));

  await closeDb();
}

main().catch(console.error);
