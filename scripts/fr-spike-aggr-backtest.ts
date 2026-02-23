#!/usr/bin/env node
/**
 * Multi-Asset FR Spike Aggregator Backtest
 *
 * Orchestrates running funding-rate-spike strategy independently across N assets,
 * then combines all results into a portfolio-level view.
 *
 * Usage:
 *   npx tsx scripts/fr-spike-aggr-backtest.ts \
 *     --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h \
 *     --from=2024-01-01 --to=2026-01-01 --capital=10000 [--save]
 *
 *   OR use presets:
 *   npx tsx scripts/fr-spike-aggr-backtest.ts --preset=conservative --from=2024-01-01 --to=2026-01-01 --capital=10000 [--save]
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb, saveBacktestRun } from '../src/data/db.js';
import { calculateMetrics, generateEquityCurve } from '../src/analysis/metrics.js';
import type { Timeframe, PerformanceMetrics, Trade, EquityPoint, BacktestResult } from '../src/core/types.js';

// Asset presets
const PRESETS: Record<string, string> = {
  // Original 5 assets (legacy)
  conservative: 'ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h',

  // WF-validated assets only (4 passed walk-forward)
  validated: 'ETC/USDT:USDT@1h,INJ/USDT:USDT@4h,IMX/USDT:USDT@1h,GRT/USDT:USDT@1h',

  // Top 10 by Sharpe from 74-symbol scan (default params, all Sharpe > 0.9)
  top10: 'ADA/USDT:USDT@1h,DOT/USDT:USDT@4h,ADA/USDT:USDT@4h,ETC/USDT:USDT@4h,MANA/USDT:USDT@4h,CRV/USDT:USDT@1h,DOT/USDT:USDT@1h,AXS/USDT:USDT@4h,LTC/USDT:USDT@1h,ETC/USDT:USDT@1h',

  // All profitable 1h assets (Sharpe > 0.5)
  hourly: 'ADA/USDT:USDT@1h,CRV/USDT:USDT@1h,DOT/USDT:USDT@1h,LTC/USDT:USDT@1h,ETC/USDT:USDT@1h,SNX/USDT:USDT@1h,IMX/USDT:USDT@1h,TRX/USDT:USDT@1h,LDO/USDT:USDT@1h,ICP/USDT:USDT@1h,GRT/USDT:USDT@1h,ATOM/USDT:USDT@1h,INJ/USDT:USDT@1h,LINK/USDT:USDT@1h,MANA/USDT:USDT@1h,HBAR/USDT:USDT@1h,XLM/USDT:USDT@1h,STX/USDT:USDT@1h,PENDLE/USDT:USDT@1h',

  // All profitable 4h assets (Sharpe > 0.5)
  fourhour: 'DOT/USDT:USDT@4h,ADA/USDT:USDT@4h,ETC/USDT:USDT@4h,MANA/USDT:USDT@4h,AXS/USDT:USDT@4h,INJ/USDT:USDT@4h,XLM/USDT:USDT@4h,VET/USDT:USDT@4h,LINK/USDT:USDT@4h,XRP/USDT:USDT@4h,GRT/USDT:USDT@4h,AAVE/USDT:USDT@4h,HBAR/USDT:USDT@4h,ETH/USDT:USDT@4h,TRX/USDT:USDT@4h',

  // Mixed TF - best of each symbol (pick TF with higher Sharpe)
  bestmix: 'ADA/USDT:USDT@1h,DOT/USDT:USDT@4h,ETC/USDT:USDT@4h,MANA/USDT:USDT@4h,CRV/USDT:USDT@1h,AXS/USDT:USDT@4h,LTC/USDT:USDT@1h,SNX/USDT:USDT@1h,IMX/USDT:USDT@1h,INJ/USDT:USDT@4h,TRX/USDT:USDT@1h,XLM/USDT:USDT@4h,LDO/USDT:USDT@1h,VET/USDT:USDT@4h,LINK/USDT:USDT@4h,GRT/USDT:USDT@4h,ICP/USDT:USDT@1h,AAVE/USDT:USDT@4h,HBAR/USDT:USDT@4h,ATOM/USDT:USDT@1h',

  // DeFi-only (DeFi protocol tokens)
  defi: 'CRV/USDT:USDT@1h,SNX/USDT:USDT@1h,LDO/USDT:USDT@1h,AAVE/USDT:USDT@4h,INJ/USDT:USDT@4h,PENDLE/USDT:USDT@1h,IMX/USDT:USDT@1h,GRT/USDT:USDT@1h',

  // Large-cap only (BTC, ETH, SOL, LINK, LTC, XRP, ADA, DOT)
  largecap: 'ADA/USDT:USDT@1h,DOT/USDT:USDT@4h,LINK/USDT:USDT@4h,LTC/USDT:USDT@1h,XRP/USDT:USDT@4h,ETH/USDT:USDT@4h,BTC/USDT:USDT@1h,ATOM/USDT:USDT@1h',
};

interface AssetConfig {
  symbol: string;
  timeframe: Timeframe;
}

interface AssetResult {
  symbol: string;
  timeframe: string;
  metrics: PerformanceMetrics;
  trades: Trade[];
  equity: EquityPoint[];
  fundingIncome: number;
  tradingPnl: number;
  error?: string;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        result[arg.slice(2)] = 'true'; // Boolean flags like --save
      }
    }
  }
  return result;
}

function parseAssets(assetsStr: string): AssetConfig[] {
  const assets: AssetConfig[] = [];
  const parts = assetsStr.split(',');

  for (const part of parts) {
    const [symbol, timeframe] = part.trim().split('@');
    if (!symbol || !timeframe) {
      throw new Error(`Invalid asset format: ${part}. Expected format: SYMBOL@TIMEFRAME`);
    }
    assets.push({ symbol, timeframe: timeframe as Timeframe });
  }

  return assets;
}

async function runAssetBacktest(
  asset: AssetConfig,
  startDate: number,
  endDate: number,
  perAssetCapital: number
): Promise<AssetResult> {
  try {
    const config = createBacktestConfig({
      strategyName: 'funding-rate-spike',
      symbol: asset.symbol,
      timeframe: asset.timeframe,
      startDate,
      endDate,
      initialCapital: perAssetCapital,
      exchange: 'bybit',
      params: {}, // Use defaults - proven best in WF tests
      mode: 'futures',
    });

    const result = await runBacktest(config, {
      enableLogging: false,
      saveResults: false,
      skipFeeFetch: true,
      broker: {
        feeRate: 0.00055, // Bybit taker fee
        slippagePercent: 0,
      },
    });

    return {
      symbol: asset.symbol,
      timeframe: asset.timeframe,
      metrics: result.metrics,
      trades: result.trades,
      equity: result.equity,
      fundingIncome: (result.metrics as any).totalFundingIncome ?? 0,
      tradingPnl: (result.metrics as any).tradingPnl ?? 0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      symbol: asset.symbol,
      timeframe: asset.timeframe,
      metrics: {} as PerformanceMetrics,
      trades: [],
      equity: [],
      fundingIncome: 0,
      tradingPnl: 0,
      error: msg,
    };
  }
}

function combineResults(
  assetResults: AssetResult[],
  totalCapital: number,
  dominantTimeframe: Timeframe
): {
  allTrades: Trade[];
  combinedEquity: EquityPoint[];
  portfolioMetrics: PerformanceMetrics;
  totalFundingIncome: number;
  totalTradingPnl: number;
} {
  // Filter out errors
  const validResults = assetResults.filter((r) => !r.error);

  // Combine all trades and sort by timestamp
  const allTrades: Trade[] = [];
  for (const result of validResults) {
    allTrades.push(...result.trades);
  }
  allTrades.sort((a, b) => a.timestamp - b.timestamp);

  // Merge equity curves: collect all unique timestamps and sum equity
  const timestampSet = new Set<number>();
  for (const result of validResults) {
    for (const point of result.equity) {
      timestampSet.add(point.timestamp);
    }
  }
  const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

  // For each timestamp, sum equity from all assets (using last known equity for each)
  const equityValues: number[] = [];
  for (const ts of timestamps) {
    let totalEquity = 0;
    for (const result of validResults) {
      // Find the last equity point <= ts
      let lastEquity = result.metrics.initialCapital ?? 0;
      for (const point of result.equity) {
        if (point.timestamp <= ts) {
          lastEquity = point.equity;
        } else {
          break;
        }
      }
      totalEquity += lastEquity;
    }
    equityValues.push(totalEquity);
  }

  const combinedEquity = generateEquityCurve(timestamps, equityValues, totalCapital);

  // Calculate portfolio metrics
  const portfolioMetrics = calculateMetrics(allTrades, combinedEquity, totalCapital, dominantTimeframe);

  // Sum funding income and trading PnL
  const totalFundingIncome = validResults.reduce((sum, r) => sum + r.fundingIncome, 0);
  const totalTradingPnl = validResults.reduce((sum, r) => sum + r.tradingPnl, 0);

  return { allTrades, combinedEquity, portfolioMetrics, totalFundingIncome, totalTradingPnl };
}

function printResults(
  assetResults: AssetResult[],
  portfolioMetrics: PerformanceMetrics,
  totalCapital: number,
  totalFundingIncome: number,
  totalTradingPnl: number,
  allTrades: Trade[]
): void {
  const validResults = assetResults.filter((r) => !r.error);
  const errors = assetResults.filter((r) => r.error);

  console.log('\n=== PORTFOLIO SUMMARY ===\n');
  console.log(`Total Capital: $${totalCapital.toLocaleString()}`);
  console.log(`Assets: ${validResults.length} (${errors.length} errors)`);
  console.log(`Total Return: ${portfolioMetrics.totalReturnPercent.toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${portfolioMetrics.sharpeRatio.toFixed(2)}`);
  console.log(`Sortino Ratio: ${portfolioMetrics.sortinoRatio.toFixed(2)}`);
  console.log(`Max Drawdown: ${portfolioMetrics.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Win Rate: ${portfolioMetrics.winRate.toFixed(1)}%`);
  console.log(`Profit Factor: ${portfolioMetrics.profitFactor.toFixed(2)}`);
  console.log(`Total Trades: ${portfolioMetrics.totalTrades}`);
  console.log(`Total Funding Income: $${totalFundingIncome.toFixed(2)}`);
  console.log(`Total Trading PnL: $${totalTradingPnl.toFixed(2)}`);

  // Trade frequency stats
  if (allTrades.length > 0) {
    const firstTrade = allTrades[0].timestamp;
    const lastTrade = allTrades[allTrades.length - 1].timestamp;
    const durationDays = (lastTrade - firstTrade) / (1000 * 60 * 60 * 24);
    const durationYears = durationDays / 365;
    const tradesPerYear = portfolioMetrics.totalTrades / durationYears;
    const tradesPerMonth = portfolioMetrics.totalTrades / (durationDays / 30);

    console.log(`\nTrade Frequency:`);
    console.log(`  Trades/Year: ${tradesPerYear.toFixed(1)}`);
    console.log(`  Trades/Month: ${tradesPerMonth.toFixed(1)}`);
  }

  // Per-asset breakdown
  console.log('\n=== PER-ASSET BREAKDOWN ===\n');
  console.log(
    '| Symbol | TF | Return % | Sharpe | Trades | MaxDD % | Funding $ | Trading $ |'
  );
  console.log(
    '|--------|----|---------:|-------:|-------:|--------:|----------:|----------:|'
  );

  for (const result of validResults) {
    const m = result.metrics;
    console.log(
      `| ${result.symbol.replace('/USDT:USDT', '').padEnd(6)} | ${result.timeframe.padEnd(2)} | ${m.totalReturnPercent.toFixed(1).padStart(8)} | ${m.sharpeRatio.toFixed(2).padStart(6)} | ${m.totalTrades.toString().padStart(6)} | ${m.maxDrawdownPercent.toFixed(1).padStart(7)} | ${result.fundingIncome.toFixed(1).padStart(9)} | ${result.tradingPnl.toFixed(1).padStart(9)} |`
    );
  }

  if (errors.length > 0) {
    console.log(`\n\nErrors (${errors.length}):`);
    errors.forEach((r) => console.log(`  ${r.symbol} @ ${r.timeframe}: ${r.error}`));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Parse assets from --assets or --preset
  let assetsStr: string;
  if (args.preset) {
    assetsStr = PRESETS[args.preset];
    if (!assetsStr) {
      console.error(`Unknown preset: ${args.preset}`);
      console.error(`Available presets: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    console.log(`Using preset: ${args.preset}`);
  } else if (args.assets) {
    assetsStr = args.assets;
  } else {
    console.error('Missing required argument: --assets or --preset');
    console.error('Example: --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h');
    console.error('Example: --preset=conservative');
    process.exit(1);
  }

  const assets = parseAssets(assetsStr);
  const from = args.from ?? '2024-01-01';
  const to = args.to ?? '2026-01-01';
  const totalCapital = Number(args.capital ?? '10000');
  const saveResults = args.save !== undefined;

  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();
  const perAssetCapital = totalCapital / assets.length;

  console.log('\n=== MULTI-ASSET FR SPIKE AGGREGATOR ===');
  console.log(`Assets: ${assets.length}`);
  console.log(`Period: ${from} to ${to}`);
  console.log(`Total Capital: $${totalCapital.toLocaleString()}`);
  console.log(`Per-Asset Capital: $${perAssetCapital.toFixed(2)}`);
  console.log(`Save to DB: ${saveResults ? 'YES' : 'NO'}`);
  console.log('');

  // Run backtests for each asset
  const assetResults: AssetResult[] = [];
  let completed = 0;

  for (const asset of assets) {
    completed++;
    const label = `[${completed}/${assets.length}] ${asset.symbol} @ ${asset.timeframe}`;
    console.log(`${label} - Running...`);

    const result = await runAssetBacktest(asset, startDate, endDate, perAssetCapital);
    assetResults.push(result);

    if (result.error) {
      console.log(`${label} - ERROR: ${result.error}`);
    } else {
      const m = result.metrics;
      console.log(
        `${label} - Sharpe ${m.sharpeRatio.toFixed(2)}, Return ${m.totalReturnPercent.toFixed(1)}%, Trades ${m.totalTrades}`
      );
    }
  }

  // Combine results
  const dominantTimeframe = assets[0]?.timeframe ?? '4h';
  const { allTrades, combinedEquity, portfolioMetrics, totalFundingIncome, totalTradingPnl } =
    combineResults(assetResults, totalCapital, dominantTimeframe);

  // Print results
  printResults(
    assetResults,
    portfolioMetrics,
    totalCapital,
    totalFundingIncome,
    totalTradingPnl,
    allTrades
  );

  // Save to database if requested
  if (saveResults) {
    console.log('\nSaving portfolio result to database...');

    // Build per-asset summary for storage
    const perAssetSummary = assetResults
      .filter((r) => !r.error)
      .map((r) => ({
        symbol: r.symbol,
        timeframe: r.timeframe,
        sharpe: r.metrics.sharpeRatio,
        returnPct: r.metrics.totalReturnPercent,
        trades: r.metrics.totalTrades,
        fundingIncome: r.fundingIncome,
        tradingPnl: r.tradingPnl,
      }));

    // Create a BacktestResult for the portfolio
    const portfolioResult: BacktestResult = {
      id: `fr-spike-aggr-${Date.now()}`,
      config: {
        id: `fr-spike-aggr-config-${Date.now()}`,
        strategyName: 'fr-spike-aggr',
        symbol: 'MULTI',
        timeframe: dominantTimeframe,
        startDate,
        endDate,
        initialCapital: totalCapital,
        exchange: 'bybit',
        params: {
          assets: assetsStr,
          perAssetCapital,
          assetCount: assets.length,
          perAssetSummary,
        },
        mode: 'futures',
      },
      trades: allTrades,
      equity: combinedEquity,
      metrics: {
        ...portfolioMetrics,
        totalFundingIncome,
        tradingPnl: totalTradingPnl,
      } as any,
      rollingMetrics: {
        timestamps: [],
        cumulativeReturn: [],
        drawdown: [],
        rollingSharpe: [],
        cumulativeWinRate: [],
        cumulativeProfitFactor: [],
      },
      createdAt: Date.now(),
    };

    await saveBacktestRun(portfolioResult);
    console.log(`Saved as: ${portfolioResult.id}`);
  }

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
