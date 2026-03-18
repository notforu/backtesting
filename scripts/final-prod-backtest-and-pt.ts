#!/usr/bin/env node
/**
 * Final Production-Ready Backtest + Paper Trading Session Creator
 *
 * Part 1: Run the exact config we plan to deploy to paper trading, with
 *         realistic slippage (0.10%) and the V2 WF-optimized per-symbol params.
 *
 * Part 2: Create a paper trading session on the production server using
 *         the saved backtest run ID as the config source.
 *
 * Usage:
 *   npx tsx scripts/final-prod-backtest-and-pt.ts
 *   npx tsx scripts/final-prod-backtest-and-pt.ts --skip-pt   # backtest only
 */

import { saveBacktestRun, closeDb, initDb } from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { AggregateBacktestConfig, SubStrategyConfig } from '../src/core/signal-types.js';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROD_HOST = 'http://5.223.56.226';
const RUN_NAME = 'PROD CANDIDATE — FR V2 5sym robust top_n mp=3 (slippage 0.10%)';

/** Common params applied to all 5 sub-strategies */
const COMMON_PARAMS: Record<string, unknown> = {
  atrPeriod: 14,
  stopLossPct: 3,
  useATRStops: true,
  kellyFraction: 0.5,
  takeProfitPct: 4,
  useFRVelocity: false,
  usePercentile: true,
  frVelocityBars: 1,
  maxPositionPct: 50,
  minPositionPct: 15,
  trendSMAPeriod: 50,
  useTrendFilter: true,
  atrFilterEnabled: true,
  atrFilterThreshold: 1.5,
  percentileLookback: 90,
  positionSizePct: 50,
  positionSizeMethod: 'volAdjusted',
  kellySampleSize: 20,
  useTrailingStop: false,
  trailDistanceATR: 2,
  trailActivationATR: 1,
  fundingThresholdLong: -0.0003,
  fundingThresholdShort: 0.0005,
};

/** Per-symbol WF-optimized params */
const SUB_STRATEGIES: SubStrategyConfig[] = [
  {
    strategyName: 'funding-rate-spike-v2',
    symbol: 'ZEC/USDT:USDT',
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      holdingPeriods: 2,
      shortPercentile: 98,
      longPercentile: 4,
      atrStopMultiplier: 2.5,
      atrTPMultiplier: 4.5,
    },
  },
  {
    strategyName: 'funding-rate-spike-v2',
    symbol: 'LDO/USDT:USDT',
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      holdingPeriods: 4,
      shortPercentile: 96,
      longPercentile: 2,
      atrStopMultiplier: 3.5,
      atrTPMultiplier: 3.5,
    },
  },
  {
    strategyName: 'funding-rate-spike-v2',
    symbol: 'TRB/USDT:USDT',
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      holdingPeriods: 2,
      shortPercentile: 98,
      longPercentile: 6,
      atrStopMultiplier: 2.5,
      atrTPMultiplier: 5,
    },
  },
  {
    strategyName: 'funding-rate-spike-v2',
    symbol: 'NEAR/USDT:USDT',
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      holdingPeriods: 3,
      shortPercentile: 96,
      longPercentile: 6,
      atrStopMultiplier: 3,
      atrTPMultiplier: 2.5,
    },
  },
  {
    strategyName: 'funding-rate-spike-v2',
    symbol: 'STG/USDT:USDT',
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      holdingPeriods: 4,
      shortPercentile: 94,
      longPercentile: 10,
      atrStopMultiplier: 1.5,
      atrTPMultiplier: 2.5,
    },
  },
];

// ---------------------------------------------------------------------------
// Monthly return distribution
// ---------------------------------------------------------------------------

function computeMonthlyReturns(
  equity: Array<{ timestamp: number; equity: number }>,
  initialCapital: number,
): Map<string, number> {
  if (equity.length === 0) return new Map();

  const byMonth = new Map<string, { start: number; end: number }>();

  for (const pt of equity) {
    const d = new Date(pt.timestamp);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, { start: pt.equity, end: pt.equity });
    } else {
      byMonth.get(key)!.end = pt.equity;
    }
  }

  // For the very first month, use initialCapital as the start
  const months = Array.from(byMonth.keys()).sort();
  const returns = new Map<string, number>();

  let prevEnd = initialCapital;
  for (const month of months) {
    const { end } = byMonth.get(month)!;
    const ret = ((end - prevEnd) / prevEnd) * 100;
    returns.set(month, ret);
    prevEnd = end;
  }

  return returns;
}

// ---------------------------------------------------------------------------
// Printing helpers
// ---------------------------------------------------------------------------

function printSeparator(char = '-', width = 72): void {
  process.stdout.write(char.repeat(width) + '\n');
}

function printMetrics(
  result: Awaited<ReturnType<typeof runAggregateBacktest>>,
): void {
  const m = result.metrics;
  const fundingIncome = (m as Record<string, unknown>).totalFundingIncome;
  const fundingUsd = typeof fundingIncome === 'number' ? fundingIncome : 0;
  const finalEquity = result.equity.length > 0
    ? result.equity[result.equity.length - 1].equity
    : result.config.initialCapital;

  printSeparator('=');
  process.stdout.write('PORTFOLIO METRICS\n');
  printSeparator('=');
  process.stdout.write(
    `  Sharpe Ratio        : ${m.sharpeRatio.toFixed(3)}\n` +
    `  Sortino Ratio       : ${m.sortinoRatio.toFixed(3)}\n` +
    `  Total Return        : ${m.totalReturnPercent.toFixed(2)}%  ($${m.totalReturn.toFixed(2)})\n` +
    `  Final Equity        : $${finalEquity.toFixed(2)}\n` +
    `  Max Drawdown        : ${m.maxDrawdownPercent.toFixed(2)}%  ($${m.maxDrawdown.toFixed(2)})\n` +
    `  Win Rate            : ${m.winRate.toFixed(1)}%\n` +
    `  Profit Factor       : ${m.profitFactor.toFixed(2)}\n` +
    `  Total Trades        : ${m.totalTrades}\n` +
    `  Winning Trades      : ${m.winningTrades}\n` +
    `  Losing Trades       : ${m.losingTrades}\n` +
    `  Avg Win             : ${m.avgWinPercent?.toFixed(2) ?? 'N/A'}%\n` +
    `  Avg Loss            : ${m.avgLoss?.toFixed(2) ?? 'N/A'}\n` +
    `  Funding Income      : $${fundingUsd.toFixed(2)}\n`,
  );

  printSeparator();
  process.stdout.write('PER-ASSET BREAKDOWN\n');
  printSeparator();

  const header = [
    'Symbol'.padEnd(20),
    'Sharpe'.padStart(8),
    'Return%'.padStart(9),
    'MaxDD%'.padStart(8),
    'Trades'.padStart(7),
    'WinRate%'.padStart(9),
    'PF'.padStart(6),
    'Funding$'.padStart(10),
  ].join('  ');
  process.stdout.write(header + '\n');
  printSeparator();

  for (const [symbol, assetResult] of Object.entries(result.perAssetResults)) {
    const am = assetResult.metrics;
    const line = [
      symbol.padEnd(20),
      am.sharpeRatio.toFixed(2).padStart(8),
      am.totalReturnPercent.toFixed(1).padStart(9),
      am.maxDrawdownPercent.toFixed(1).padStart(8),
      String(am.totalTrades).padStart(7),
      am.winRate.toFixed(1).padStart(9),
      am.profitFactor.toFixed(2).padStart(6),
      (assetResult.fundingIncome ?? 0).toFixed(0).padStart(10),
    ].join('  ');
    process.stdout.write(line + '\n');
  }

  printSeparator();
  process.stdout.write('MONTHLY RETURN DISTRIBUTION\n');
  printSeparator();

  const monthly = computeMonthlyReturns(result.equity, result.config.initialCapital as number);
  const months = Array.from(monthly.keys()).sort();

  let posMonths = 0;
  let negMonths = 0;
  let maxUp = -Infinity;
  let maxDown = Infinity;

  for (const month of months) {
    const ret = monthly.get(month)!;
    const bar = ret >= 0
      ? '+'.repeat(Math.round(Math.abs(ret) / 2))
      : '-'.repeat(Math.round(Math.abs(ret) / 2));
    const sign = ret >= 0 ? '+' : '';
    process.stdout.write(`  ${month}  ${(sign + ret.toFixed(1) + '%').padStart(8)}  ${bar}\n`);
    if (ret >= 0) { posMonths++; maxUp = Math.max(maxUp, ret); }
    else { negMonths++; maxDown = Math.min(maxDown, ret); }
  }

  printSeparator();
  process.stdout.write(
    `  Positive months: ${posMonths}  |  Negative months: ${negMonths}\n` +
    `  Best month:  ${maxUp === -Infinity ? 'N/A' : '+' + maxUp.toFixed(1) + '%'}\n` +
    `  Worst month: ${maxDown === Infinity ? 'N/A' : maxDown.toFixed(1) + '%'}\n`,
  );
  printSeparator('=');
}

// ---------------------------------------------------------------------------
// Paper trading session creation
// ---------------------------------------------------------------------------

interface PaperSessionResponse {
  id: string;
  name: string;
  status: string;
  error?: string;
  [key: string]: unknown;
}

function loginProd(): string {
  const payload = JSON.stringify({ username: 'root', password: 'admin' });
  const curlCmd = `curl -s -X POST ${PROD_HOST}/api/auth/login ` +
    `-H 'Content-Type: application/json' ` +
    `-d '${payload}'`;
  const raw = execSync(curlCmd, { encoding: 'utf8', timeout: 30000 });
  const data = JSON.parse(raw) as { token?: string; error?: string };
  if (!data.token) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

function createPaperSession(backtestRunId: string, token: string): { cmd: string; response: PaperSessionResponse } {
  const payload = JSON.stringify({
    name: RUN_NAME,
    backtestRunId,
    initialCapital: 5000,
  });

  const curlCmd = `curl -s -X POST ${PROD_HOST}/api/paper-trading/sessions ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'Authorization: Bearer ${token}' ` +
    `-d '${payload.replace(/'/g, "'\\''")}'`;

  const raw = execSync(curlCmd, { encoding: 'utf8', timeout: 30000 });
  return { cmd: curlCmd, response: JSON.parse(raw) as PaperSessionResponse };
}

function startPaperSession(sessionId: string, token: string): PaperSessionResponse {
  const curlCmd = `curl -s -X POST ${PROD_HOST}/api/paper-trading/sessions/${sessionId}/start ` +
    `-H 'Authorization: Bearer ${token}'`;
  const raw = execSync(curlCmd, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(raw) as PaperSessionResponse;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const skipPt = process.argv.includes('--skip-pt');

  process.stderr.write('[1/5] Initializing database...\n');
  await initDb();

  const aggregateConfig: AggregateBacktestConfig = {
    subStrategies: SUB_STRATEGIES,
    allocationMode: 'top_n',
    maxPositions: 3,
    initialCapital: 5000,
    startDate: new Date('2024-01-01').getTime(),
    endDate: new Date('2026-03-01').getTime(),
    exchange: 'bybit',
    mode: 'futures',
    slippagePercent: 0.10,
  };

  process.stderr.write('[2/5] Running aggregate backtest (5 symbols, 2024-01-01 to 2026-03-01)...\n');
  process.stderr.write(`      Strategy: funding-rate-spike-v2\n`);
  process.stderr.write(`      Symbols: ZEC, LDO, TRB, NEAR, STG\n`);
  process.stderr.write(`      Allocation: top_n maxPositions=3\n`);
  process.stderr.write(`      Slippage: 0.10%\n`);
  process.stderr.write(`      Initial Capital: $5,000\n`);
  process.stderr.write('\n');

  const t0 = Date.now();

  const result = await runAggregateBacktest(aggregateConfig, {
    saveResults: false,
    enableLogging: false,
    onProgress: (p) => {
      if (p.current % 500 === 0 || p.current === p.total) {
        process.stderr.write(`      Progress: ${p.percent.toFixed(0)}% (${p.current}/${p.total})\n`);
      }
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[3/5] Backtest complete in ${elapsed}s — saving to DB...\n`);

  // Override strategy name before saving so it appears with a meaningful label
  // in the dashboard history (the DB stores result.config.strategyName as strategy_name)
  (result.config as Record<string, unknown>).strategyName = RUN_NAME;

  await saveBacktestRun(result);

  process.stderr.write(`      Saved as: ${RUN_NAME}\n`);
  process.stderr.write(`      Run ID  : ${result.id}\n`);

  // Print full results to stdout
  process.stdout.write(`\nBACKTEST RUN ID: ${result.id}\n\n`);
  printMetrics(result);

  if (skipPt) {
    process.stderr.write('\n[--skip-pt] Skipping paper trading session creation.\n');
    await closeDb();
    return;
  }

  // -------------------------------------------------------------------------
  // Part 2: Create paper trading session on production
  //
  // Strategy: create an aggregation config on prod (POST /api/aggregations),
  // then create a paper trading session from that aggregationConfigId.
  // This is the cleanest approach — prod has the full config inline and the
  // session manager can start immediately without needing local DB data.
  // -------------------------------------------------------------------------
  process.stderr.write('\n[4/5] Creating paper trading session on production...\n');
  process.stderr.write(`      Host: ${PROD_HOST}\n`);

  let token: string;
  try {
    token = loginProd();
    process.stderr.write(`      Authenticated as root\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`      ERROR authenticating: ${msg}\n`);
    process.stdout.write(`\nFAILED to authenticate with prod: ${msg}\n`);
    await closeDb();
    return;
  }

  // Step 4a: Create aggregation config on prod
  const aggPayload = JSON.stringify({
    name: RUN_NAME,
    allocationMode: 'top_n',
    maxPositions: 3,
    initialCapital: 5000,
    exchange: 'bybit',
    mode: 'futures',
    subStrategies: SUB_STRATEGIES.map(s => ({
      strategyName: s.strategyName,
      symbol: s.symbol,
      timeframe: s.timeframe,
      exchange: s.exchange,
      params: s.params,
    })),
  });

  const aggCurlCmd = `curl -s -X POST ${PROD_HOST}/api/aggregations ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'Authorization: Bearer ${token}' ` +
    `-d '${aggPayload.replace(/'/g, "'\\''")}'`;

  process.stderr.write(`      Creating aggregation config on prod...\n`);

  let aggConfig: { id?: string; error?: string; [key: string]: unknown };
  try {
    const raw = execSync(aggCurlCmd, { encoding: 'utf8', timeout: 30000 });
    aggConfig = JSON.parse(raw) as typeof aggConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`      ERROR creating aggregation config: ${msg}\n`);
    process.stdout.write(`\nFAILED to create aggregation config on prod: ${msg}\n`);
    await closeDb();
    return;
  }

  if (aggConfig.error || !aggConfig.id) {
    process.stderr.write(`      API error: ${JSON.stringify(aggConfig)}\n`);
    process.stdout.write(`\nAPI RETURNED ERROR creating aggregation config:\n${JSON.stringify(aggConfig, null, 2)}\n`);
    await closeDb();
    return;
  }

  const aggregationConfigId = aggConfig.id as string;
  process.stderr.write(`      Aggregation config created: ${aggregationConfigId}\n`);

  // Step 4b: Create paper trading session from the aggregation config
  const sessionPayload = JSON.stringify({
    name: RUN_NAME,
    aggregationConfigId,
    initialCapital: 5000,
  });

  const sessionCurlCmd = `curl -s -X POST ${PROD_HOST}/api/paper-trading/sessions ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'Authorization: Bearer ${token}' ` +
    `-d '${sessionPayload.replace(/'/g, "'\\''")}'`;

  // Print the curl command with token redacted
  const redactedSessionCmd = sessionCurlCmd.replace(/Bearer [A-Za-z0-9._-]+/, 'Bearer <TOKEN>');
  process.stdout.write('\nCURL COMMAND USED (token redacted):\n');
  process.stdout.write(redactedSessionCmd + '\n');

  let session: PaperSessionResponse;
  try {
    const raw = execSync(sessionCurlCmd, { encoding: 'utf8', timeout: 30000 });
    session = JSON.parse(raw) as PaperSessionResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`      ERROR creating session: ${msg}\n`);
    process.stdout.write(`\nFAILED to create paper trading session: ${msg}\n`);
    await closeDb();
    return;
  }

  if (session.error) {
    process.stderr.write(`      API error: ${JSON.stringify(session)}\n`);
    process.stdout.write(`\nAPI RETURNED ERROR:\n${JSON.stringify(session, null, 2)}\n`);
    await closeDb();
    return;
  }

  process.stdout.write('\nPAPER TRADING SESSION CREATED:\n');
  process.stdout.write(`  Session ID         : ${session.id}\n`);
  process.stdout.write(`  Name               : ${session.name}\n`);
  process.stdout.write(`  Status             : ${session.status}\n`);
  process.stdout.write(`  Aggregation Config : ${aggregationConfigId}\n`);

  // -------------------------------------------------------------------------
  // Step 5: Start the session
  // -------------------------------------------------------------------------
  process.stderr.write(`[5/5] Starting session ${session.id}...\n`);

  let started: PaperSessionResponse;
  try {
    started = startPaperSession(session.id, token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`      ERROR starting session: ${msg}\n`);
    process.stdout.write(`\nFAILED to start session: ${msg}\n`);
    await closeDb();
    return;
  }

  if (started.error) {
    process.stderr.write(`      API error: ${JSON.stringify(started)}\n`);
    process.stdout.write(`\nAPI RETURNED ERROR on start:\n${JSON.stringify(started, null, 2)}\n`);
    await closeDb();
    return;
  }

  process.stdout.write('\nPAPER TRADING SESSION STARTED:\n');
  process.stdout.write(`  Session ID  : ${started.id}\n`);
  process.stdout.write(`  Status      : ${started.status}\n`);
  process.stdout.write(`\nSession is now running. Monitor at: ${PROD_HOST}/api/paper-trading/sessions/${started.id}\n`);

  process.stderr.write('\nDone.\n');

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
