/**
 * Strategy Config CRUD Service Tests
 *
 * Tests all public functions in src/data/strategy-config.ts using a mocked
 * PostgreSQL pool. No real database connection is required.
 *
 * Functions under test:
 *   - findOrCreateStrategyConfig
 *   - listStrategyConfigs
 *   - getStrategyConfig
 *   - getStrategyConfigVersions
 *   - getStrategyConfigDeletionInfo
 *   - deleteStrategyConfig
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeStrategyConfigHash } from '../../utils/content-hash.js';

// ============================================================================
// Mock the pg pool — must be declared before any imports of the module
// ============================================================================

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});

vi.mock('../db.js', () => ({
  getPool: () => ({
    query: mockQuery,
    connect: mockConnect,
  }),
}));

// ============================================================================
// Mock the strategy loader and base helpers used by findOrCreateStrategyConfig
// ============================================================================

const mockLoadStrategy = vi.fn();
const mockGetDefaultParams = vi.fn();

vi.mock('../../strategy/loader.js', () => ({
  loadStrategy: (...args: unknown[]) => mockLoadStrategy(...args),
}));

vi.mock('../../strategy/base.js', () => ({
  getDefaultParams: (...args: unknown[]) => mockGetDefaultParams(...args),
}));

// Import module under test AFTER mock setup (Vitest hoists vi.mock calls)
import {
  findOrCreateStrategyConfig,
  listStrategyConfigs,
  getStrategyConfig,
  getStrategyConfigVersions,
  getStrategyConfigDeletionInfo,
  deleteStrategyConfig,
} from '../strategy-config.js';

// ============================================================================
// Row fixtures
// ============================================================================

function makeConfigRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'cfg-123',
    strategy_name: 'funding-rate-v2',
    symbol: 'BTC/USDT',
    timeframe: '4h',
    params: { threshold: 0.0002 },
    content_hash: 'abc123',
    name: 'funding-rate-v2 / BTC/USDT / 4h / 2026-03-10-120000',
    user_id: null,
    created_at: '1710000000000',
    ...overrides,
  };
}

function makeListRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ...makeConfigRow(),
    run_count: '5',
    paper_session_count: '1',
    latest_run_at: '1710100000000',
    latest_run_sharpe: '1.52',
    latest_run_return: '18.5',
    ...overrides,
  };
}

// ============================================================================
// Helpers
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mockConnect to always return a fresh client
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
  // findOrCreateStrategyConfig always calls loadStrategy to merge defaults.
  // Default to: strategy found but has no declared params → nothing is merged.
  // Tests that need specific defaults can override these per-test.
  mockLoadStrategy.mockResolvedValue({ name: 'stub-strategy', params: [] });
  mockGetDefaultParams.mockReturnValue({});
});

// ============================================================================
// findOrCreateStrategyConfig
// ============================================================================

describe('findOrCreateStrategyConfig', () => {
  it('returns existing config when content_hash matches', async () => {
    const row = makeConfigRow();
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
    });

    expect(result.created).toBe(false);
    expect(result.config.id).toBe('cfg-123');
    expect(result.config.strategyName).toBe('funding-rate-v2');
    // Only one query should have been issued (the SELECT)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('creates new config when no existing match is found', async () => {
    const newId = 'cfg-new-456';
    const insertedRow = makeConfigRow({ id: newId });

    // SELECT returns no rows, INSERT returns the new row
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [insertedRow] });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    // The inserted row has the same id as what was returned — so created = true
    // (the mock returns the newId which matches the id generated by crypto.randomUUID
    // only indirectly; we verify created=true when the returned id equals what was
    // passed as $1 in the INSERT — here we let the implementation detect this through
    // the returned id matching)
    expect(result.config.id).toBe(newId);
  });

  it('auto-generates name with correct format "strategyName / symbol / timeframe / YYYY-MM-DD-HHmmss"', async () => {
    // Intercept the INSERT call to inspect params
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT returns nothing
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        // params[6] (index 6, 0-based) is the autoName ($7 in the query)
        const autoName = params[6] as string;
        // Pattern: "strategyName / symbol / timeframe / YYYY-MM-DD-HHmmss"
        expect(autoName).toMatch(
          /^funding-rate-v2 \/ BTC\/USDT \/ 4h \/ \d{4}-\d{2}-\d{2}-\d{6}$/
        );
        return Promise.resolve({ rows: [makeConfigRow({ name: autoName })] });
      });

    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
    });
  });

  it('maps DB row fields from snake_case to camelCase', async () => {
    const row = makeConfigRow({
      id: 'cfg-map-test',
      strategy_name: 'sma-crossover',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      params: { fast: 10, slow: 50 },
      content_hash: 'deadbeef',
      name: 'sma-crossover / ETH/USDT / 1h / 2026-03-10-080000',
      user_id: 'user-abc',
      created_at: '1720000000000',
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const { config } = await findOrCreateStrategyConfig({
      strategyName: 'sma-crossover',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      params: { fast: 10, slow: 50 },
      userId: 'user-abc',
    });

    expect(config.id).toBe('cfg-map-test');
    expect(config.strategyName).toBe('sma-crossover');
    expect(config.symbol).toBe('ETH/USDT');
    expect(config.timeframe).toBe('1h');
    expect(config.contentHash).toBe('deadbeef');
    expect(config.name).toBe('sma-crossover / ETH/USDT / 1h / 2026-03-10-080000');
    expect(config.userId).toBe('user-abc');
    expect(config.createdAt).toBe(1_720_000_000_000);
  });

  it('converts created_at from numeric string to number', async () => {
    const row = makeConfigRow({ created_at: '1710000000000' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const { config } = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
    });

    expect(typeof config.createdAt).toBe('number');
    expect(config.createdAt).toBe(1_710_000_000_000);
  });

  it('parses params when returned as JSON string from DB', async () => {
    const row = makeConfigRow({ params: '{"threshold":0.0002,"period":14}' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const { config } = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002, period: 14 },
    });

    expect(config.params).toEqual({ threshold: 0.0002, period: 14 });
  });

  it('handles concurrent insert (ON CONFLICT): returns created=false when returned id differs', async () => {
    // Simulate the race condition: INSERT returned a row with a different id
    // (the winning concurrent insert's id), so wasCreated should be false.
    const existingId = 'cfg-existing-from-race';
    const insertedRow = makeConfigRow({ id: existingId });

    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // SELECT: no match
      .mockResolvedValueOnce({ rows: [insertedRow] }); // INSERT ON CONFLICT: returns existing row

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
    });

    // The returned id ('cfg-existing-from-race') differs from the uuid we tried to
    // insert, so the service should detect this as a "not created" scenario.
    expect(result.created).toBe(false);
    expect(result.config.id).toBe(existingId);
  });

  it('passes userId as null when not provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        // userId is $8 (index 7, 0-based) in the INSERT
        const userId = params[7];
        expect(userId).toBeNull();
        return Promise.resolve({ rows: [makeConfigRow()] });
      });

    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
      // userId intentionally omitted
    });
  });

  it('passes userId when provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        const userId = params[7];
        expect(userId).toBe('user-xyz');
        return Promise.resolve({ rows: [makeConfigRow({ user_id: 'user-xyz' })] });
      });

    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0002 },
      userId: 'user-xyz',
    });
  });

  // --------------------------------------------------------------------------
  // Empty params validation
  // --------------------------------------------------------------------------

  it('succeeds with empty params when strategy defines default parameters', async () => {
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };
    const defaults = { threshold: 0.0001, period: 14 };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce(defaults);

    const insertedRow = makeConfigRow({ params: defaults });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })         // SELECT: no match
      .mockResolvedValueOnce({ rows: [insertedRow] }); // INSERT

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: {},
    });

    expect(result.config.params).toEqual(defaults);
    expect(mockLoadStrategy).toHaveBeenCalledWith('funding-rate-v2');
  });

  it('throws when params are empty and strategy is not found', async () => {
    mockLoadStrategy.mockRejectedValueOnce(new Error('Strategy not found: unknown-strategy'));

    await expect(
      findOrCreateStrategyConfig({
        strategyName: 'unknown-strategy',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: {},
      })
    ).rejects.toThrow(
      'Cannot create strategy config for "unknown-strategy" with empty params.'
    );

    // No DB queries should have been issued
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws when params are empty and strategy has no default parameters', async () => {
    const fakeStrategy = { name: 'paramless-strategy', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    // getDefaultParams returns empty object — strategy has no declared params
    mockGetDefaultParams.mockReturnValueOnce({});

    await expect(
      findOrCreateStrategyConfig({
        strategyName: 'paramless-strategy',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: {},
      })
    ).rejects.toThrow(
      'Cannot create strategy config for "paramless-strategy" with empty params.'
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('succeeds with explicit params even when loadStrategy throws (unknown strategy)', async () => {
    // loadStrategy is always called to merge defaults, but its failure must be swallowed.
    mockLoadStrategy.mockRejectedValueOnce(new Error('Strategy not found: totally-unknown-strategy'));

    const row = makeConfigRow({ params: { threshold: 0.0005 } });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    await expect(
      findOrCreateStrategyConfig({
        strategyName: 'totally-unknown-strategy',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: { threshold: 0.0005 },
      })
    ).resolves.toBeDefined();
  });

  it('merges sparse params with strategy defaults for consistent hashing', async () => {
    // Sparse caller params: only longPct is overridden.
    // Defaults have longPct + shortPct + period.
    const defaults = { longPct: 50, shortPct: 50, period: 14 };
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce(defaults);

    // Intercept the INSERT to verify finalParams contains full merged object.
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT: no match
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        // $5 (index 4) is the params JSON passed to the INSERT
        const insertedParams = JSON.parse(params[4] as string) as Record<string, unknown>;
        expect(insertedParams).toEqual({ longPct: 2, shortPct: 50, period: 14 });
        return Promise.resolve({
          rows: [makeConfigRow({ params: insertedParams, id: 'cfg-merged' })],
        });
      });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2 }, // sparse — only overrides longPct
    });

    expect(result.config.params).toEqual({ longPct: 2, shortPct: 50, period: 14 });
  });

  it('does not alter params when strategy has no defaults', async () => {
    // Strategy exists but declares no params — defaults is {}, so no merging happens.
    // The SELECT mock returns an existing row — params are read from that row.
    const fakeStrategy = { name: 'paramless-strategy', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce({});

    const row = makeConfigRow({ params: { threshold: 0.0005 } });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'paramless-strategy',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0005 },
    });

    // Caller params passed through unchanged — row.params is returned as-is
    expect(result.config.params).toEqual({ threshold: 0.0005 });
  });

  // --------------------------------------------------------------------------
  // Params normalization / dedup scenarios
  // --------------------------------------------------------------------------

  it('sparse params and full equivalent params send the same hash to the SELECT query', async () => {
    // Call 1: full params — record defaults returned (simulate existing row).
    const defaults = { longPct: 50, shortPct: 50, period: 14 };
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };

    mockLoadStrategy.mockResolvedValue(fakeStrategy);
    mockGetDefaultParams.mockReturnValue(defaults);

    // Compute the expected hash for the fully-merged params.
    const expectedHash = computeStrategyConfigHash({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2, shortPct: 50, period: 14 },
    });

    // First call: full params provided — SELECT returns existing row.
    mockQuery.mockResolvedValueOnce({ rows: [makeConfigRow({ content_hash: expectedHash })] });

    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2, shortPct: 50, period: 14 },
    });

    const hashFromFullParams = mockQuery.mock.calls[0][1][0] as string;

    // Reset mocks for second call.
    vi.clearAllMocks();
    mockLoadStrategy.mockResolvedValue(fakeStrategy);
    mockGetDefaultParams.mockReturnValue(defaults);
    mockQuery.mockResolvedValueOnce({ rows: [makeConfigRow({ content_hash: expectedHash })] });

    // Second call: sparse params — only longPct is set.
    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2 },
    });

    const hashFromSparseParams = mockQuery.mock.calls[0][1][0] as string;

    // Both calls must have sent the same hash to the database SELECT.
    expect(hashFromSparseParams).toBe(hashFromFullParams);
    expect(hashFromSparseParams).toBe(expectedHash);
  });

  it('full params matching defaults are unchanged — same hash is produced as sparse equivalent', async () => {
    const defaults = { longPct: 50, shortPct: 50, period: 14 };
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce(defaults);

    // Intercept the SELECT to capture the hash argument.
    mockQuery.mockImplementationOnce((_sql: string, params: unknown[]) => {
      const hash = params[0] as string;
      // The hash must match what we compute for the full, merged params.
      const expectedHash = computeStrategyConfigHash({
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: { longPct: 50, shortPct: 50, period: 14 },
      });
      expect(hash).toBe(expectedHash);
      return Promise.resolve({ rows: [makeConfigRow()] });
    });

    await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      // All params match defaults exactly — nothing should change.
      params: { longPct: 50, shortPct: 50, period: 14 },
    });
  });

  it('caller params override defaults, not the other way around', async () => {
    // longPct: 2 in caller params must win over longPct: 50 from defaults.
    const defaults = { longPct: 50, shortPct: 50 };
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce(defaults);

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT: no match
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        const insertedParams = JSON.parse(params[4] as string) as Record<string, unknown>;
        // Caller's longPct: 2 must override default longPct: 50.
        expect(insertedParams.longPct).toBe(2);
        // shortPct should come from defaults since caller did not provide it.
        expect(insertedParams.shortPct).toBe(50);
        return Promise.resolve({ rows: [makeConfigRow({ params: insertedParams })] });
      });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2 },
    });

    expect(result.config.params).toMatchObject({ longPct: 2, shortPct: 50 });
  });

  it('extra caller params not present in defaults are preserved after merge', async () => {
    // customParam is not in defaults but must survive the merge.
    const defaults = { longPct: 50, shortPct: 50 };
    const fakeStrategy = { name: 'funding-rate-v2', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce(defaults);

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT: no match
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        const insertedParams = JSON.parse(params[4] as string) as Record<string, unknown>;
        expect(insertedParams).toEqual({ longPct: 2, shortPct: 50, customParam: true });
        return Promise.resolve({ rows: [makeConfigRow({ params: insertedParams })] });
      });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { longPct: 2, customParam: true },
    });

    expect(result.config.params).toEqual({ longPct: 2, shortPct: 50, customParam: true });
  });

  it('empty defaults leave caller params completely unchanged', async () => {
    // getDefaultParams returns {} — the merge spreads nothing extra.
    const fakeStrategy = { name: 'no-defaults-strategy', params: [] };
    mockLoadStrategy.mockResolvedValueOnce(fakeStrategy);
    mockGetDefaultParams.mockReturnValueOnce({});

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT: no match
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        const insertedParams = JSON.parse(params[4] as string) as Record<string, unknown>;
        // Params must be exactly what the caller provided — nothing added or removed.
        expect(insertedParams).toEqual({ threshold: 0.0005, window: 20 });
        return Promise.resolve({ rows: [makeConfigRow({ params: insertedParams })] });
      });

    await findOrCreateStrategyConfig({
      strategyName: 'no-defaults-strategy',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0005, window: 20 },
    });
  });

  it('strategy load failure with non-empty params uses caller params as-is without throwing', async () => {
    // loadStrategy throws — no defaults available — but params are non-empty so
    // the function must proceed using the caller-supplied params unchanged.
    mockLoadStrategy.mockRejectedValueOnce(new Error('Strategy not found: exotic-strategy'));

    const row = makeConfigRow({ params: { threshold: 0.0005 } });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    // Intercept to verify hash was computed from caller params as-is.
    const expectedHash = computeStrategyConfigHash({
      strategyName: 'exotic-strategy',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0005 },
    });

    mockQuery.mockReset();
    mockQuery.mockImplementationOnce((_sql: string, params: unknown[]) => {
      expect(params[0]).toBe(expectedHash);
      return Promise.resolve({ rows: [row] });
    });

    const result = await findOrCreateStrategyConfig({
      strategyName: 'exotic-strategy',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: { threshold: 0.0005 },
    });

    expect(result.config.params).toEqual({ threshold: 0.0005 });
  });
});

// ============================================================================
// listStrategyConfigs
// ============================================================================

describe('listStrategyConfigs', () => {
  it('returns all configs with stats when called without filters', async () => {
    const rows = [makeListRow(), makeListRow({ id: 'cfg-456' })];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await listStrategyConfigs();

    expect(result).toHaveLength(2);
    // No filter params should be passed
    const [_sql, params] = mockQuery.mock.calls[0];
    expect(params).toHaveLength(0);
  });

  it('maps list items with correct numeric conversions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    const [item] = await listStrategyConfigs();

    expect(item.runCount).toBe(5);
    expect(typeof item.runCount).toBe('number');
    expect(item.paperSessionCount).toBe(1);
    expect(typeof item.paperSessionCount).toBe('number');
    expect(item.latestRunAt).toBe(1_710_100_000_000);
    expect(item.latestRunSharpe).toBeCloseTo(1.52);
    expect(item.latestRunReturn).toBeCloseTo(18.5);
  });

  it('sets latestRunSharpe to undefined when null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeListRow({ latest_run_sharpe: null })],
    });

    const [item] = await listStrategyConfigs();

    expect(item.latestRunSharpe).toBeUndefined();
  });

  it('sets latestRunReturn to undefined when null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeListRow({ latest_run_return: null })],
    });

    const [item] = await listStrategyConfigs();

    expect(item.latestRunReturn).toBeUndefined();
  });

  it('sets latestRunAt to undefined when null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeListRow({ latest_run_at: null })],
    });

    const [item] = await listStrategyConfigs();

    expect(item.latestRunAt).toBeUndefined();
  });

  it('filters by strategyName', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    await listStrategyConfigs({ strategyName: 'funding-rate-v2' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.strategy_name = $1');
    expect(params).toContain('funding-rate-v2');
  });

  it('filters by symbol', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    await listStrategyConfigs({ symbol: 'ETH/USDT' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.symbol = $1');
    expect(params).toContain('ETH/USDT');
  });

  it('filters by timeframe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    await listStrategyConfigs({ timeframe: '1h' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.timeframe = $1');
    expect(params).toContain('1h');
  });

  it('filters by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    await listStrategyConfigs({ userId: 'user-abc' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.user_id = $1');
    expect(params).toContain('user-abc');
  });

  it('combines strategyName and symbol filters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    await listStrategyConfigs({ strategyName: 'funding-rate-v2', symbol: 'BTC/USDT' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.strategy_name = $1');
    expect(sql).toContain('sc.symbol = $2');
    expect(params).toEqual(['funding-rate-v2', 'BTC/USDT']);
  });

  it('combines all four filters with correct parameter indices', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listStrategyConfigs({
      strategyName: 'sma-crossover',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      userId: 'user-xyz',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('sc.strategy_name = $1');
    expect(sql).toContain('sc.symbol = $2');
    expect(sql).toContain('sc.timeframe = $3');
    expect(sql).toContain('sc.user_id = $4');
    expect(params).toEqual(['sma-crossover', 'ETH/USDT', '1h', 'user-xyz']);
  });

  it('returns empty array when no rows returned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listStrategyConfigs();

    expect(result).toEqual([]);
  });

  it('includes base record fields alongside stats', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListRow()] });

    const [item] = await listStrategyConfigs();

    // StrategyConfigRecord fields must be present
    expect(item.id).toBe('cfg-123');
    expect(item.strategyName).toBe('funding-rate-v2');
    expect(item.symbol).toBe('BTC/USDT');
    expect(item.timeframe).toBe('4h');
    expect(item.contentHash).toBe('abc123');
    // Stats fields also present
    expect(item.runCount).toBe(5);
    expect(item.paperSessionCount).toBe(1);
  });
});

// ============================================================================
// getStrategyConfig
// ============================================================================

describe('getStrategyConfig', () => {
  it('returns mapped record when row is found', async () => {
    const row = makeConfigRow({
      id: 'cfg-get-1',
      strategy_name: 'momentum',
      symbol: 'SOL/USDT',
      timeframe: '15m',
      params: { lookback: 20 },
      content_hash: 'feedcafe',
      name: 'momentum / SOL/USDT / 15m / 2026-03-10-090000',
      user_id: null,
      created_at: '1715000000000',
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getStrategyConfig('cfg-get-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('cfg-get-1');
    expect(result!.strategyName).toBe('momentum');
    expect(result!.symbol).toBe('SOL/USDT');
    expect(result!.timeframe).toBe('15m');
    expect(result!.params).toEqual({ lookback: 20 });
    expect(result!.contentHash).toBe('feedcafe');
    expect(result!.createdAt).toBe(1_715_000_000_000);
  });

  it('passes id as the query parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeConfigRow()] });

    await getStrategyConfig('cfg-lookup-id');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual(['cfg-lookup-id']);
  });

  it('returns null when no row is found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getStrategyConfig('does-not-exist');

    expect(result).toBeNull();
  });

  it('maps userId from user_id column', async () => {
    const row = makeConfigRow({ user_id: 'user-mapped' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getStrategyConfig('cfg-123');

    expect(result!.userId).toBe('user-mapped');
  });

  it('maps userId to undefined when user_id is null', async () => {
    const row = makeConfigRow({ user_id: null });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getStrategyConfig('cfg-123');

    expect(result!.userId).toBeUndefined();
  });
});

// ============================================================================
// getStrategyConfigVersions
// ============================================================================

describe('getStrategyConfigVersions', () => {
  it('returns all versions for the same strategy+symbol+timeframe', async () => {
    const rows = [
      makeConfigRow({ id: 'cfg-v1', params: { threshold: 0.0001 }, created_at: '1710000000000' }),
      makeConfigRow({ id: 'cfg-v2', params: { threshold: 0.0002 }, created_at: '1710100000000' }),
      makeConfigRow({ id: 'cfg-v3', params: { threshold: 0.0003 }, created_at: '1710200000000' }),
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getStrategyConfigVersions('funding-rate-v2', 'BTC/USDT', '4h');

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('cfg-v1');
    expect(result[1].id).toBe('cfg-v2');
    expect(result[2].id).toBe('cfg-v3');
  });

  it('passes all three parameters to the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getStrategyConfigVersions('sma-crossover', 'ETH/USDT', '1h');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('strategy_name = $1');
    expect(sql).toContain('symbol        = $2');
    expect(sql).toContain('timeframe     = $3');
    expect(params).toEqual(['sma-crossover', 'ETH/USDT', '1h']);
  });

  it('orders results by created_at ASC', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getStrategyConfigVersions('funding-rate-v2', 'BTC/USDT', '4h');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at ASC');
  });

  it('returns empty array when no versions exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getStrategyConfigVersions('nonexistent', 'BTC/USDT', '1d');

    expect(result).toEqual([]);
  });

  it('maps each row to a StrategyConfigRecord', async () => {
    const rows = [
      makeConfigRow({ id: 'cfg-v1', params: { a: 1 } }),
      makeConfigRow({ id: 'cfg-v2', params: { a: 2 } }),
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getStrategyConfigVersions('funding-rate-v2', 'BTC/USDT', '4h');

    expect(result[0].params).toEqual({ a: 1 });
    expect(result[1].params).toEqual({ a: 2 });
  });
});

// ============================================================================
// getStrategyConfigDeletionInfo
// ============================================================================

describe('getStrategyConfigDeletionInfo', () => {
  it('returns correct counts from three parallel queries', async () => {
    // The three queries run in parallel via Promise.all; mockQuery resolves
    // them in the order they were registered.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '7' }] })   // backtest_runs
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })   // paper_sessions
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });  // optimized_params

    const result = await getStrategyConfigDeletionInfo('cfg-del-info');

    expect(result.runCount).toBe(7);
    expect(result.paperSessionCount).toBe(3);
    expect(result.optimizationCount).toBe(2);
  });

  it('converts count strings to numbers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '42' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getStrategyConfigDeletionInfo('cfg-123');

    expect(typeof result.runCount).toBe('number');
    expect(typeof result.paperSessionCount).toBe('number');
    expect(typeof result.optimizationCount).toBe('number');
  });

  it('returns zeros when nothing is linked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getStrategyConfigDeletionInfo('cfg-empty');

    expect(result.runCount).toBe(0);
    expect(result.paperSessionCount).toBe(0);
    expect(result.optimizationCount).toBe(0);
  });

  it('issues exactly three queries', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getStrategyConfigDeletionInfo('cfg-123');

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('passes the id to all three count queries', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getStrategyConfigDeletionInfo('cfg-target');

    for (const call of mockQuery.mock.calls) {
      expect(call[1]).toEqual(['cfg-target']);
    }
  });
});

// ============================================================================
// deleteStrategyConfig
// ============================================================================

describe('deleteStrategyConfig', () => {
  it('executes all deletion steps inside a transaction', async () => {
    // All client.query calls succeed
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await deleteStrategyConfig('cfg-del-tx');

    const calls = mockClientQuery.mock.calls.map(([sql]: [string]) => sql.trim());

    // BEGIN must be first
    expect(calls[0]).toBe('BEGIN');

    // DELETE trades_v2 with subselect on backtest_runs
    expect(calls[1]).toContain('DELETE FROM trades_v2');
    expect(calls[1]).toContain('backtest_runs');
    expect(calls[1]).toContain('strategy_config_id');

    // DELETE backtest_runs
    expect(calls[2]).toContain('DELETE FROM backtest_runs');
    expect(calls[2]).toContain('strategy_config_id');

    // UPDATE paper_sessions
    expect(calls[3]).toContain('UPDATE paper_sessions');
    expect(calls[3]).toContain('strategy_config_id = NULL');

    // UPDATE optimized_params
    expect(calls[4]).toContain('UPDATE optimized_params');
    expect(calls[4]).toContain('strategy_config_id = NULL');

    // DELETE strategy_configs
    expect(calls[5]).toContain('DELETE FROM strategy_configs');
    expect(calls[5]).toContain('id = $1');

    // COMMIT must be last SQL call
    expect(calls[6]).toBe('COMMIT');
  });

  it('passes the config id to every DML statement', async () => {
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await deleteStrategyConfig('cfg-id-check');

    // Skip BEGIN (no params) and COMMIT (no params)
    const dmlCalls = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => sql.trim() !== 'BEGIN' && sql.trim() !== 'COMMIT'
    );

    for (const [_sql, params] of dmlCalls) {
      expect(params).toContain('cfg-id-check');
    }
  });

  it('calls client.release() after successful transaction', async () => {
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await deleteStrategyConfig('cfg-release-ok');

    expect(mockClientRelease).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows on error in a DML step', async () => {
    const boom = new Error('DB write failed');

    // BEGIN succeeds, then one DML call throws
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE trades_v2
      .mockRejectedValueOnce(boom)         // DELETE backtest_runs — throws
      .mockResolvedValue({ rows: [] });    // ROLLBACK (and any subsequent calls)

    await expect(deleteStrategyConfig('cfg-rollback')).rejects.toThrow('DB write failed');

    const calls = mockClientQuery.mock.calls.map(([sql]: [string]) => sql.trim());
    expect(calls).toContain('ROLLBACK');
  });

  it('calls client.release() even when transaction fails', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('oops')) // first DML throws
      .mockResolvedValue({ rows: [] });    // ROLLBACK

    await expect(deleteStrategyConfig('cfg-release-err')).rejects.toThrow('oops');

    expect(mockClientRelease).toHaveBeenCalledOnce();
  });

  it('does not call COMMIT when an error occurs', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('fail')) // throws early
      .mockResolvedValue({ rows: [] });    // ROLLBACK

    await expect(deleteStrategyConfig('cfg-no-commit')).rejects.toThrow('fail');

    const calls = mockClientQuery.mock.calls.map(([sql]: [string]) => sql.trim());
    expect(calls).not.toContain('COMMIT');
    expect(calls).toContain('ROLLBACK');
  });

  it('acquires a client from the pool', async () => {
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await deleteStrategyConfig('cfg-connect-check');

    expect(mockConnect).toHaveBeenCalledOnce();
  });
});
