/**
 * Aggregate Backtest Persistence - FAILING Tests (TDD Red Phase)
 *
 * These tests expose known bugs in DB persistence and file storage for
 * AggregateBacktestResult. They are intentionally written to FAIL against the
 * current implementation and serve as the red phase of TDD.
 *
 * Known bugs targeted:
 *   BUG 1 - perAssetResults is silently dropped by saveBacktestRun / getBacktestRun
 *   BUG 2 - signalHistory is silently dropped by saveBacktestRun / getBacktestRun
 *   BUG 3 - result-storage.ts saveResultToFile omits perAssetResults in the JSON output
 *
 * Each test requires a live PostgreSQL connection. Tests are skipped when the
 * database is not reachable.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Lazy imports – avoid failing at import time when DB is unavailable
// ============================================================================
import { getPool, closeDb } from '../../data/db.js';
import { saveBacktestRun, getBacktestRun, deleteBacktestRun } from '../../data/db.js';
import { saveResultToFile } from '../result-storage.js';
import type { AggregateBacktestResult, PerAssetResult, Signal } from '../signal-types.js';
import type { Trade, EquityPoint, PerformanceMetrics, RollingMetrics, BacktestConfig } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Check whether the database is available. Returns true if reachable. */
async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const pool = getPool();
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

/** Build a minimal Trade object for test data. */
function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: uuidv4(),
    symbol: 'BTC/USDT',
    action: 'OPEN_LONG',
    price: 50000,
    amount: 0.1,
    timestamp: Date.now(),
    balanceAfter: 9500,
    fee: 2.75,
    feeRate: 0.00055,
    ...overrides,
  };
}

/** Build a minimal EquityPoint for test data. */
function makeEquityPoint(timestamp: number, equity: number): EquityPoint {
  return { timestamp, equity, drawdown: 0 };
}

/** Build a minimal PerformanceMetrics object. */
function makeMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    totalReturn: 1500,
    totalReturnPercent: 15,
    maxDrawdown: 300,
    maxDrawdownPercent: 3,
    sharpeRatio: 1.5,
    sortinoRatio: 2.1,
    winRate: 0.6,
    profitFactor: 1.8,
    totalTrades: 10,
    winningTrades: 6,
    losingTrades: 4,
    avgWin: 350,
    avgLoss: 150,
    avgWinPercent: 3.5,
    avgLossPercent: 1.5,
    expectancy: 150,
    expectancyPercent: 1.5,
    largestWin: 700,
    largestLoss: 300,
    avgTradeDuration: 28800000, // 8 hours in ms
    exposureTime: 0.4,
    totalFees: 25,
    ...overrides,
  };
}

/** Build a minimal RollingMetrics object. */
function makeRollingMetrics(): RollingMetrics {
  return {
    timestamps: [1700000000000, 1700003600000],
    cumulativeReturn: [0, 5],
    drawdown: [0, 0],
    rollingSharpe: [0, 1.2],
    cumulativeWinRate: [0, 0.6],
    cumulativeProfitFactor: [0, 1.8],
  };
}

/** Build a minimal BacktestConfig for aggregate (multi-asset) runs. */
function makeAggregateConfig(id: string): BacktestConfig {
  return {
    id,
    strategyName: 'signal-aggr',
    params: {
      allocationMode: 'single_strongest',
      maxPositions: 3,
      assets: 'BTC/USDT@4h,ETH/USDT@4h',
    },
    symbol: 'MULTI',
    timeframe: '4h',
    startDate: 1700000000000,
    endDate: 1702000000000,
    initialCapital: 10000,
    exchange: 'bybit',
    mode: 'futures',
  };
}

/** Build a realistic PerAssetResult for one symbol. */
function makePerAssetResult(symbol: string): PerAssetResult {
  const openTrade = makeTrade({ id: uuidv4(), symbol, action: 'OPEN_LONG', timestamp: 1700000000000 });
  const closeTrade = makeTrade({
    id: uuidv4(),
    symbol,
    action: 'CLOSE_LONG',
    timestamp: 1700028800000,
    pnl: 250,
    pnlPercent: 5,
    closedPositionId: openTrade.id,
    balanceAfter: 9750,
  });

  const equity: EquityPoint[] = [
    makeEquityPoint(1700000000000, 5000),
    makeEquityPoint(1700028800000, 5250),
  ];

  return {
    symbol,
    timeframe: '4h',
    trades: [openTrade, closeTrade],
    equity,
    metrics: makeMetrics({ totalTrades: 1, winningTrades: 1, losingTrades: 0 }),
    rollingMetrics: makeRollingMetrics(),
    fundingIncome: 12.5,
    tradingPnl: 237.5,
  };
}

/** Build a Signal object for test data. */
function makeSignal(symbol: string): Signal {
  return {
    symbol,
    direction: 'long',
    weight: 0.85,
    strategyName: 'funding-rate-spike',
    timestamp: 1700000000000,
  };
}

/**
 * Build a complete AggregateBacktestResult with two assets, perAssetResults,
 * and signalHistory.
 */
function makeAggregateResult(): AggregateBacktestResult {
  const id = uuidv4();
  const config = makeAggregateConfig(id);

  const btcPerAsset = makePerAssetResult('BTC/USDT');
  const ethPerAsset = makePerAssetResult('ETH/USDT');

  const allTrades = [...btcPerAsset.trades, ...ethPerAsset.trades].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const equity: EquityPoint[] = [
    makeEquityPoint(1700000000000, 10000),
    makeEquityPoint(1700028800000, 10500),
    makeEquityPoint(1701000000000, 11000),
  ];

  const signals: Signal[] = [
    makeSignal('BTC/USDT'),
    makeSignal('ETH/USDT'),
  ];

  return {
    id,
    config,
    trades: allTrades,
    equity,
    metrics: makeMetrics({ totalTrades: 2 }),
    rollingMetrics: makeRollingMetrics(),
    createdAt: Date.now(),
    perAssetResults: {
      'BTC/USDT': btcPerAsset,
      'ETH/USDT': ethPerAsset,
    },
    signalHistory: signals,
  };
}

// ============================================================================
// Test suite setup
// ============================================================================

let dbAvailable = false;
const createdIds: string[] = [];

beforeAll(async () => {
  dbAvailable = await isDatabaseAvailable();
  if (!dbAvailable) {
    console.warn('[aggregate-persistence] PostgreSQL not available - DB tests will be skipped');
  }
});

afterEach(async () => {
  if (!dbAvailable) return;
  // Clean up any test rows created during the test
  for (const id of createdIds) {
    try {
      await deleteBacktestRun(id);
    } catch {
      // Ignore cleanup errors
    }
  }
  createdIds.length = 0;
});

afterAll(async () => {
  if (dbAvailable) {
    await closeDb();
  }
});

// ============================================================================
// BUG 1: perAssetResults not persisted by saveBacktestRun / getBacktestRun
// ============================================================================

describe('BUG 1 - perAssetResults persistence', () => {
  it('getBacktestRun should return perAssetResults that were saved with saveBacktestRun', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    // Save via the real DB function
    await saveBacktestRun(result);

    // Load it back
    const loaded = await getBacktestRun(result.id);

    expect(loaded).not.toBeNull();

    // BUG 1: This assertion will FAIL because saveBacktestRun does not persist
    // perAssetResults - it is silently dropped during the INSERT.
    expect(loaded).toHaveProperty('perAssetResults');

    const loadedAggregate = loaded as AggregateBacktestResult;

    // The loaded result must have both asset keys
    expect(Object.keys(loadedAggregate.perAssetResults)).toHaveLength(2);
    expect(loadedAggregate.perAssetResults).toHaveProperty('BTC/USDT');
    expect(loadedAggregate.perAssetResults).toHaveProperty('ETH/USDT');
  });

  it('perAssetResults.BTC/USDT should have correct metrics after round-trip', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id) as AggregateBacktestResult;

    // BUG 1: This will FAIL because perAssetResults is undefined/missing
    const btcResult = loaded?.perAssetResults?.['BTC/USDT'];
    expect(btcResult).toBeDefined();
    expect(btcResult?.metrics.sharpeRatio).toBeCloseTo(result.perAssetResults['BTC/USDT'].metrics.sharpeRatio, 5);
    expect(btcResult?.fundingIncome).toBeCloseTo(result.perAssetResults['BTC/USDT'].fundingIncome, 5);
    expect(btcResult?.tradingPnl).toBeCloseTo(result.perAssetResults['BTC/USDT'].tradingPnl, 5);
  });

  it('perAssetResults should preserve equity and trades arrays after round-trip', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id) as AggregateBacktestResult;

    // BUG 1: This will FAIL because perAssetResults is not persisted
    const btcResult = loaded?.perAssetResults?.['BTC/USDT'];
    expect(btcResult).toBeDefined();

    // Equity array should be preserved
    expect(btcResult?.equity).toHaveLength(result.perAssetResults['BTC/USDT'].equity.length);

    // Trades array should be preserved in the per-asset slice
    expect(btcResult?.trades).toHaveLength(result.perAssetResults['BTC/USDT'].trades.length);
  });
});

// ============================================================================
// BUG 2: signalHistory not persisted by saveBacktestRun / getBacktestRun
// ============================================================================

describe('BUG 2 - signalHistory persistence', () => {
  it('getBacktestRun should return signalHistory that was saved with saveBacktestRun', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    expect(result.signalHistory).toHaveLength(2);
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id);

    expect(loaded).not.toBeNull();

    // BUG 2: This assertion will FAIL because saveBacktestRun does not persist
    // signalHistory - the field is absent from the INSERT statement.
    expect(loaded).toHaveProperty('signalHistory');

    const loadedAggregate = loaded as AggregateBacktestResult;
    expect(loadedAggregate.signalHistory).toHaveLength(2);
  });

  it('signalHistory entries should preserve symbol, direction, and weight after round-trip', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id) as AggregateBacktestResult;

    // BUG 2: Will FAIL because signalHistory is not persisted
    const history = loaded?.signalHistory;
    expect(history).toBeDefined();
    expect(history).toHaveLength(2);

    const btcSignal = history?.find((s) => s.symbol === 'BTC/USDT');
    expect(btcSignal).toBeDefined();
    expect(btcSignal?.direction).toBe('long');
    expect(btcSignal?.weight).toBeCloseTo(0.85, 5);
    expect(btcSignal?.strategyName).toBe('funding-rate-spike');
  });

  it('signalHistory should not be an empty array when signals existed', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id) as AggregateBacktestResult;

    // BUG 2: Even if the field exists, it should not be empty
    // This catches the case where the field is initialised as [] instead of being
    // omitted entirely.
    expect(loaded).toHaveProperty('signalHistory');
    const history = (loaded as AggregateBacktestResult).signalHistory;
    expect(history.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// BUG 3: saveResultToFile drops perAssetResults from the JSON output
// ============================================================================

describe('BUG 3 - result-storage.ts drops perAssetResults', () => {
  const tmpResultsDir = join(process.cwd(), 'results-test-tmp');

  afterEach(() => {
    // Clean up temp directory after each test
    if (existsSync(tmpResultsDir)) {
      rmSync(tmpResultsDir, { recursive: true, force: true });
    }
  });

  it('saved JSON file should contain perAssetResults key', () => {
    const result = makeAggregateResult();

    // Temporarily override the results directory by monkey-patching is not
    // straightforward with ESM, so we rely on the actual results dir and clean
    // up after. We save and immediately find the file path.
    const filepath = saveResultToFile(result);

    try {
      const raw = readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // BUG 3: This will FAIL because saveResultToFile builds the output object
      // without including perAssetResults - the field is simply not spread into
      // the output object.
      expect(parsed).toHaveProperty('perAssetResults');
    } finally {
      // Clean up the written file
      try {
        rmSync(filepath, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it('saved JSON file perAssetResults should contain BTC/USDT and ETH/USDT entries', () => {
    const result = makeAggregateResult();
    const filepath = saveResultToFile(result);

    try {
      const raw = readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // BUG 3: Will FAIL because perAssetResults is omitted from the file
      expect(parsed).toHaveProperty('perAssetResults');
      const perAsset = parsed.perAssetResults as Record<string, unknown>;
      expect(Object.keys(perAsset)).toContain('BTC/USDT');
      expect(Object.keys(perAsset)).toContain('ETH/USDT');
    } finally {
      try {
        rmSync(filepath, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it('saved JSON file should contain signalHistory key', () => {
    const result = makeAggregateResult();
    const filepath = saveResultToFile(result);

    try {
      const raw = readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // BUG 3 (corollary): signalHistory is also not included in the file output.
      // This will FAIL with the current saveResultToFile implementation.
      expect(parsed).toHaveProperty('signalHistory');
      const history = parsed.signalHistory as unknown[];
      expect(history.length).toBeGreaterThan(0);
    } finally {
      try {
        rmSync(filepath, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it('perAssetResults in file should include trades and equity for each asset', () => {
    const result = makeAggregateResult();
    const filepath = saveResultToFile(result);

    try {
      const raw = readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // BUG 3: Will FAIL because perAssetResults is not written to file
      expect(parsed).toHaveProperty('perAssetResults');
      const perAsset = parsed.perAssetResults as Record<string, Record<string, unknown>>;
      const btcAsset = perAsset['BTC/USDT'];
      expect(btcAsset).toBeDefined();
      expect(btcAsset).toHaveProperty('trades');
      expect(btcAsset).toHaveProperty('equity');
      expect(btcAsset).toHaveProperty('metrics');
      expect((btcAsset.trades as unknown[]).length).toBeGreaterThan(0);
    } finally {
      try {
        rmSync(filepath, { force: true });
      } catch {
        // ignore
      }
    }
  });
});

// ============================================================================
// Sanity / baseline tests (these SHOULD pass to confirm the test harness works)
// ============================================================================

describe('BASELINE - basic BacktestResult round-trip (these should PASS)', () => {
  it('standard BacktestResult fields survive a DB round-trip', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id);

    expect(loaded).not.toBeNull();

    // These standard fields ARE persisted correctly - they should pass
    expect(loaded!.id).toBe(result.id);
    expect(loaded!.metrics.sharpeRatio).toBeCloseTo(result.metrics.sharpeRatio, 5);
    expect(loaded!.metrics.totalReturnPercent).toBeCloseTo(result.metrics.totalReturnPercent, 5);
    expect(loaded!.equity).toHaveLength(result.equity.length);
    expect(loaded!.trades).toHaveLength(result.trades.length);
  });

  it('config fields survive a DB round-trip', async () => {
    if (!dbAvailable) {
      console.warn('Skipping: DB not available');
      return;
    }

    const result = makeAggregateResult();
    createdIds.push(result.id);

    await saveBacktestRun(result);
    const loaded = await getBacktestRun(result.id);

    expect(loaded!.config.strategyName).toBe('signal-aggr');
    expect(loaded!.config.symbol).toBe('MULTI');
    expect(loaded!.config.exchange).toBe('bybit');
    expect(loaded!.config.mode).toBe('futures');
  });
});
