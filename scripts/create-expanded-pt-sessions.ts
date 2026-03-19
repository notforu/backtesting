#!/usr/bin/env node
/**
 * Create 2 new paper trading sessions on production:
 *
 * Session 1: "8 expanded" — 5 WF-validated core symbols + DUSK, 1000PEPE, PAXG
 *   Name: WF-Validated 8sym expanded — top_n mp=3
 *   Allocation: top_n, maxPositions=3
 *   Capital: $5,000
 *
 * Session 2: "11 max" — all WF-validated symbols
 *   Name: WF-Validated 11sym max — top_n mp=5
 *   Allocation: top_n, maxPositions=5
 *   Capital: $5,000
 *
 * Usage:
 *   npx tsx scripts/create-expanded-pt-sessions.ts
 */

import { execSync } from 'child_process';

const PROD_HOST = 'http://5.223.56.226';

// ---------------------------------------------------------------------------
// Common params applied to ALL sub-strategies
// ---------------------------------------------------------------------------

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

/** Default per-symbol params (used for DUSK, 1000PEPE, PAXG, DOGE) */
const DEFAULT_SYMBOL_PARAMS: Record<string, unknown> = {
  holdingPeriods: 3,
  shortPercentile: 95,
  longPercentile: 5,
  atrStopMultiplier: 2.5,
  atrTPMultiplier: 3.5,
};

// ---------------------------------------------------------------------------
// Sub-strategy definitions
// ---------------------------------------------------------------------------

interface SubStrategyConfig {
  strategyName: string;
  symbol: string;
  timeframe: string;
  exchange: string;
  params: Record<string, unknown>;
}

function makeSubStrategy(
  symbol: string,
  overrides: Record<string, unknown> = {},
): SubStrategyConfig {
  return {
    strategyName: 'funding-rate-spike-v2',
    symbol,
    timeframe: '4h',
    exchange: 'bybit',
    params: {
      ...COMMON_PARAMS,
      ...DEFAULT_SYMBOL_PARAMS,
      ...overrides,
    },
  };
}

/** 5 WF-validated core symbols with optimized params */
const CORE_5: SubStrategyConfig[] = [
  makeSubStrategy('ZEC/USDT:USDT', {
    holdingPeriods: 2, shortPercentile: 98, longPercentile: 4,
    atrStopMultiplier: 2.5, atrTPMultiplier: 4.5,
  }),
  makeSubStrategy('LDO/USDT:USDT', {
    holdingPeriods: 4, shortPercentile: 96, longPercentile: 2,
    atrStopMultiplier: 3.5, atrTPMultiplier: 3.5,
  }),
  makeSubStrategy('TRB/USDT:USDT', {
    holdingPeriods: 2, shortPercentile: 98, longPercentile: 6,
    atrStopMultiplier: 2.5, atrTPMultiplier: 5,
  }),
  makeSubStrategy('NEAR/USDT:USDT', {
    holdingPeriods: 3, shortPercentile: 96, longPercentile: 6,
    atrStopMultiplier: 3, atrTPMultiplier: 2.5,
  }),
  makeSubStrategy('STG/USDT:USDT', {
    holdingPeriods: 4, shortPercentile: 94, longPercentile: 10,
    atrStopMultiplier: 1.5, atrTPMultiplier: 2.5,
  }),
];

/** 3 expanded symbols using default params */
const EXPANDED_3: SubStrategyConfig[] = [
  makeSubStrategy('DUSK/USDT:USDT'),
  makeSubStrategy('1000PEPE/USDT:USDT'),
  makeSubStrategy('PAXG/USDT:USDT'),
];

/** 3 additional symbols for the 11-symbol max portfolio */
const EXTRA_3: SubStrategyConfig[] = [
  makeSubStrategy('XLM/USDT:USDT', {
    holdingPeriods: 6, shortPercentile: 94, longPercentile: 10,
    atrStopMultiplier: 3, atrTPMultiplier: 5,
  }),
  makeSubStrategy('IOST/USDT:USDT', {
    holdingPeriods: 4, shortPercentile: 94, longPercentile: 4,
    atrStopMultiplier: 3.5, atrTPMultiplier: 2.5,
  }),
  makeSubStrategy('DOGE/USDT:USDT'),
];

// ---------------------------------------------------------------------------
// Session configs
// ---------------------------------------------------------------------------

interface SessionSpec {
  name: string;
  allocationMode: string;
  maxPositions: number;
  initialCapital: number;
  subStrategies: SubStrategyConfig[];
}

const SESSION_1: SessionSpec = {
  name: 'WF-Validated 8sym expanded — top_n mp=3',
  allocationMode: 'top_n',
  maxPositions: 3,
  initialCapital: 5000,
  subStrategies: [...CORE_5, ...EXPANDED_3],
};

const SESSION_2: SessionSpec = {
  name: 'WF-Validated 11sym max — top_n mp=5',
  allocationMode: 'top_n',
  maxPositions: 5,
  initialCapital: 5000,
  subStrategies: [...CORE_5, ...EXPANDED_3, ...EXTRA_3],
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface ApiResponse {
  id?: string;
  name?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

function curlPost(url: string, payload: string, token?: string): ApiResponse {
  const authHeader = token ? `-H 'Authorization: Bearer ${token}'` : '';
  const escapedPayload = payload.replace(/'/g, "'\\''");
  const cmd = `curl -s -X POST ${url} -H 'Content-Type: application/json' ${authHeader} -d '${escapedPayload}'`;
  const raw = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(raw) as ApiResponse;
}

function login(): string {
  process.stderr.write('  Authenticating as root...\n');
  const result = curlPost(`${PROD_HOST}/api/auth/login`, JSON.stringify({ username: 'root', password: 'admin' }));
  if (!result.token) {
    throw new Error(`Login failed: ${JSON.stringify(result)}`);
  }
  process.stderr.write('  Authenticated.\n');
  return result.token as string;
}

function createAggregationConfig(spec: SessionSpec, token: string): string {
  process.stderr.write(`  Creating aggregation config: "${spec.name}"...\n`);
  const payload = JSON.stringify({
    name: spec.name,
    allocationMode: spec.allocationMode,
    maxPositions: spec.maxPositions,
    initialCapital: spec.initialCapital,
    exchange: 'bybit',
    mode: 'futures',
    subStrategies: spec.subStrategies.map(s => ({
      strategyName: s.strategyName,
      symbol: s.symbol,
      timeframe: s.timeframe,
      exchange: s.exchange,
      params: s.params,
    })),
  });

  const result = curlPost(`${PROD_HOST}/api/aggregations`, payload, token);

  if (result.error || !result.id) {
    throw new Error(`Failed to create aggregation config: ${JSON.stringify(result)}`);
  }

  process.stderr.write(`  Aggregation config created: ${result.id}\n`);
  return result.id as string;
}

function createPaperSession(spec: SessionSpec, aggregationConfigId: string, token: string): string {
  process.stderr.write(`  Creating paper trading session: "${spec.name}"...\n`);
  const payload = JSON.stringify({
    name: spec.name,
    aggregationConfigId,
    initialCapital: spec.initialCapital,
  });

  const result = curlPost(`${PROD_HOST}/api/paper-trading/sessions`, payload, token);

  if (result.error || !result.id) {
    throw new Error(`Failed to create paper session: ${JSON.stringify(result)}`);
  }

  process.stderr.write(`  Session created: ${result.id} (status: ${result.status})\n`);
  return result.id as string;
}

function startPaperSession(sessionId: string, token: string): ApiResponse {
  process.stderr.write(`  Starting session ${sessionId}...\n`);
  const cmd = `curl -s -X POST ${PROD_HOST}/api/paper-trading/sessions/${sessionId}/start ` +
    `-H 'Authorization: Bearer ${token}'`;
  const raw = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  const result = JSON.parse(raw) as ApiResponse;

  if (result.error) {
    throw new Error(`Failed to start session: ${JSON.stringify(result)}`);
  }

  process.stderr.write(`  Session started: ${result.id} (status: ${result.status})\n`);
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function createSession(label: string, spec: SessionSpec, token: string): Promise<void> {
  process.stdout.write(`\n${'='.repeat(72)}\n`);
  process.stdout.write(`Creating session: ${label}\n`);
  process.stdout.write(`  Name            : ${spec.name}\n`);
  process.stdout.write(`  Symbols         : ${spec.subStrategies.length} (${spec.subStrategies.map(s => s.symbol.split('/')[0]).join(', ')})\n`);
  process.stdout.write(`  Allocation      : ${spec.allocationMode}, maxPositions=${spec.maxPositions}\n`);
  process.stdout.write(`  Capital         : $${spec.initialCapital.toLocaleString()}\n`);
  process.stdout.write(`${'='.repeat(72)}\n`);

  const aggConfigId = createAggregationConfig(spec, token);
  const sessionId = createPaperSession(spec, aggConfigId, token);
  const started = startPaperSession(sessionId, token);

  process.stdout.write('\nSESSION READY:\n');
  process.stdout.write(`  Session ID          : ${started.id}\n`);
  process.stdout.write(`  Name                : ${started.name ?? spec.name}\n`);
  process.stdout.write(`  Status              : ${started.status}\n`);
  process.stdout.write(`  Aggregation Config  : ${aggConfigId}\n`);
  process.stdout.write(`  Monitor             : ${PROD_HOST}/api/paper-trading/sessions/${started.id}\n`);
}

async function main(): Promise<void> {
  process.stdout.write('Creating expanded paper trading sessions on production...\n');
  process.stdout.write(`Host: ${PROD_HOST}\n`);

  const token = login();

  await createSession('SESSION 1 — 8 expanded', SESSION_1, token);
  await createSession('SESSION 2 — 11 max', SESSION_2, token);

  process.stdout.write(`\n${'='.repeat(72)}\n`);
  process.stdout.write('Both sessions created and started successfully.\n');
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nFATAL ERROR: ${msg}\n`);
  process.exit(1);
});
