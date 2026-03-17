/**
 * import-and-backtest-pruned.ts
 *
 * Reads pruned-configs.json, selects 5 diverse configs by index,
 * creates each as an aggregation_config via the production API,
 * then runs a backtest for each one.
 *
 * Usage:
 *   npx tsx scripts/import-and-backtest-pruned.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const BASE_URL = 'http://5.223.56.226';

// Date range matching original runs
const START_DATE = '2024-01-01';
const END_DATE = '2026-03-01';

// Auth token (populated at startup)
let AUTH_TOKEN = '';

async function login(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  if (!resp.ok) {
    throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json() as { token: string };
  return data.token;
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };
}

// Indices of the 5 most diverse configs to select from pruned-configs.json:
//   #0  -> 10 assets, single_strongest (highest Sharpe)
//   #3  ->  6 assets, single_strongest
//   #5  -> 12 assets, top_n
//   #6  ->  6 assets, top_n
//   #8  ->  3 assets, single_strongest (smallest)
const SELECTED_INDICES = [0, 3, 5, 6, 8];

interface SubStrategy {
  params: Record<string, unknown>;
  symbol: string;
  exchange: string;
  timeframe: string;
  strategyName: string;
}

interface PrunedConfig {
  originalRunId: string;
  originalSharpe: number;
  originalReturn: number;
  allocationMode: string;
  maxPositions: number;
  subStrategies: SubStrategy[];
  prunedCount: number;
  remainingCount: number;
}

interface AggregationConfig {
  id: string;
  name: string;
  allocationMode: string;
  maxPositions: number;
  subStrategies: SubStrategy[];
  initialCapital: number;
  exchange: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
}

async function createAggregationConfig(
  config: PrunedConfig,
  index: number
): Promise<AggregationConfig> {
  const name = `pruned-${config.allocationMode}-${config.remainingCount}assets-idx${index}`;

  const body = {
    name,
    allocationMode: config.allocationMode,
    maxPositions: config.maxPositions,
    subStrategies: config.subStrategies.map((s) => ({
      strategyName: s.strategyName,
      symbol: s.symbol,
      timeframe: s.timeframe,
      params: s.params,
      exchange: s.exchange,
    })),
    initialCapital: 10000,
    exchange: 'bybit',
    mode: 'futures',
  };

  console.log(`\n[${index}] Creating aggregation config: "${name}"`);
  console.log(
    `     allocationMode=${config.allocationMode}, maxPositions=${config.maxPositions}, assets=${config.remainingCount}`
  );

  const response = await fetch(`${BASE_URL}/api/aggregations`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create aggregation config (HTTP ${response.status}): ${text}`
    );
  }

  const created = (await response.json()) as AggregationConfig;
  console.log(`     Created with id: ${created.id}`);
  return created;
}

async function runBacktest(
  aggregationId: string,
  configName: string
): Promise<void> {
  const body = {
    startDate: START_DATE,
    endDate: END_DATE,
  };

  console.log(`\n     Running backtest for "${configName}" (id: ${aggregationId})`);
  console.log(`     Date range: ${START_DATE} -> ${END_DATE}`);

  const startTime = Date.now();

  const response = await fetch(
    `${BASE_URL}/api/aggregations/${aggregationId}/run`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Backtest failed (HTTP ${response.status}) after ${elapsed}s: ${text}`
    );
  }

  const result = (await response.json()) as {
    metrics?: {
      sharpeRatio?: number;
      totalReturnPercent?: number;
      maxDrawdownPercent?: number;
      totalTrades?: number;
      winRate?: number;
    };
    aggregationId?: string;
    aggregationName?: string;
  };

  const m = result.metrics ?? {};
  console.log(`     Completed in ${elapsed}s`);
  console.log(`     Sharpe:      ${m.sharpeRatio?.toFixed(4) ?? 'N/A'}`);
  console.log(`     Return:      ${m.totalReturnPercent?.toFixed(2) ?? 'N/A'}%`);
  console.log(`     MaxDD:       ${m.maxDrawdownPercent?.toFixed(2) ?? 'N/A'}%`);
  console.log(`     Trades:      ${m.totalTrades ?? 'N/A'}`);
  console.log(`     Win rate:    ${m.winRate?.toFixed(2) ?? 'N/A'}%`);
}

async function main(): Promise<void> {
  // Authenticate first
  console.log('Logging in to production API...');
  AUTH_TOKEN = await login();
  console.log('Authenticated successfully.\n');

  const jsonPath = resolve('/workspace/scripts/pruned-configs.json');
  console.log(`Reading pruned configs from: ${jsonPath}`);

  const raw = readFileSync(jsonPath, 'utf-8');
  const allConfigs = JSON.parse(raw) as PrunedConfig[];

  console.log(`Total configs in file: ${allConfigs.length}`);
  console.log(`Selected indices: [${SELECTED_INDICES.join(', ')}]`);

  for (const idx of SELECTED_INDICES) {
    if (idx >= allConfigs.length) {
      console.error(`Index ${idx} is out of range (file has ${allConfigs.length} configs), skipping.`);
      continue;
    }

    const config = allConfigs[idx];
    console.log(`\n${'='.repeat(60)}`);
    console.log(
      `Processing config #${idx}: ${config.allocationMode}, ${config.remainingCount} assets, originalSharpe=${config.originalSharpe.toFixed(4)}`
    );

    try {
      // Step 1: Create aggregation config on prod
      const created = await createAggregationConfig(config, idx);

      // Step 2: Run backtest via prod API
      await runBacktest(created.id, created.name);

      console.log(`     Saved to production database successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`ERROR processing config #${idx}: ${message}`);
      // Continue with remaining configs rather than aborting
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('All selected configs processed. Results are now visible in the dashboard.');
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
