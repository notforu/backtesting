/**
 * Strategy Config API Routes Tests
 *
 * Tests HTTP-level behavior by registering the route handlers in an isolated
 * Fastify instance and using inject() to simulate requests. All service layer
 * dependencies are mocked so no database connection is required.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ============================================================================
// Hoisted mock functions — declared before vi.mock() calls
// ============================================================================

const mockListStrategyConfigs = vi.fn();
const mockGetStrategyConfig = vi.fn();
const mockFindOrCreateStrategyConfig = vi.fn();
const mockGetStrategyConfigVersions = vi.fn();
const mockGetStrategyConfigDeletionInfo = vi.fn();
const mockDeleteStrategyConfig = vi.fn();
const mockGetBacktestSummaries = vi.fn();
const mockPoolQuery = vi.fn();

// ============================================================================
// Module mocks — hoisted by Vitest before imports
// ============================================================================

vi.mock('../../../data/strategy-config.js', () => ({
  findOrCreateStrategyConfig: (...args: unknown[]) => mockFindOrCreateStrategyConfig(...args),
  listStrategyConfigs: (...args: unknown[]) => mockListStrategyConfigs(...args),
  getStrategyConfig: (...args: unknown[]) => mockGetStrategyConfig(...args),
  getStrategyConfigVersions: (...args: unknown[]) => mockGetStrategyConfigVersions(...args),
  getStrategyConfigDeletionInfo: (...args: unknown[]) => mockGetStrategyConfigDeletionInfo(...args),
  deleteStrategyConfig: (...args: unknown[]) => mockDeleteStrategyConfig(...args),
}));

vi.mock('../../../data/db.js', () => ({
  getBacktestSummaries: (...args: unknown[]) => mockGetBacktestSummaries(...args),
  getPool: () => ({ query: mockPoolQuery }),
}));

// Import the routes after mocks are set up
import { strategyConfigRoutes } from '../strategy-configs.js';

// ============================================================================
// Test fixtures
// ============================================================================

const sampleConfig = {
  id: 'cfg-123',
  strategyName: 'funding-rate-v2',
  symbol: 'BTC/USDT',
  timeframe: '4h',
  params: { threshold: 0.0002 },
  contentHash: 'abc123hash',
  name: 'funding-rate-v2 / BTC/USDT / 4h',
  createdAt: 1710000000000,
};

const sampleListItem = {
  ...sampleConfig,
  runCount: 5,
  paperSessionCount: 1,
  latestRunAt: 1710000000000,
  latestRunSharpe: 1.52,
  latestRunReturn: 18.5,
};

const sampleSummary = {
  id: 'run-1',
  config: {
    strategyName: 'funding-rate-v2',
    symbol: 'BTC/USDT',
    timeframe: '4h',
    exchange: 'bybit',
    startDate: 1700000000000,
    endDate: 1710000000000,
    params: { threshold: 0.0002 },
    mode: 'futures',
  },
  metrics: {
    totalReturnPercent: 18.5,
    sharpeRatio: 1.52,
    maxDrawdownPercent: -8.3,
    winRate: 55,
    profitFactor: 1.8,
    totalTrades: 47,
    totalFees: -125,
  },
  createdAt: 1710000000000,
  aggregationId: undefined,
  aggregationName: undefined,
  strategyConfigId: 'cfg-123',
};

// ============================================================================
// Test setup
// ============================================================================

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(strategyConfigRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// GET /api/strategy-configs
// ============================================================================

describe('GET /api/strategy-configs', () => {
  it('returns 200 with list of configs', async () => {
    mockListStrategyConfigs.mockResolvedValueOnce([sampleListItem]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('cfg-123');
    expect(body[0].strategyName).toBe('funding-rate-v2');
  });

  it('passes strategy and symbol filters to service', async () => {
    mockListStrategyConfigs.mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/strategy-configs?strategy=funding-rate-v2&symbol=BTC%2FUSDT',
    });

    expect(mockListStrategyConfigs).toHaveBeenCalledWith({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: undefined,
    });
  });

  it('passes all three filters (strategy, symbol, timeframe) to service', async () => {
    mockListStrategyConfigs.mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/strategy-configs?strategy=sma&symbol=ETH%2FUSDT&timeframe=1h',
    });

    expect(mockListStrategyConfigs).toHaveBeenCalledWith({
      strategyName: 'sma',
      symbol: 'ETH/USDT',
      timeframe: '1h',
    });
  });

  it('returns 200 with empty array when no configs exist', async () => {
    mockListStrategyConfigs.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns 500 when service throws', async () => {
    mockListStrategyConfigs.mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('DB connection failed');
  });
});

// ============================================================================
// GET /api/strategy-configs/versions
// ============================================================================

describe('GET /api/strategy-configs/versions', () => {
  it('returns 200 with version array', async () => {
    mockGetStrategyConfigVersions.mockResolvedValueOnce([sampleConfig]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?strategy=funding-rate-v2&symbol=BTC%2FUSDT&timeframe=4h',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('cfg-123');
  });

  it('passes strategy, symbol, and timeframe to service', async () => {
    mockGetStrategyConfigVersions.mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?strategy=funding-rate-v2&symbol=BTC%2FUSDT&timeframe=4h',
    });

    expect(mockGetStrategyConfigVersions).toHaveBeenCalledWith(
      'funding-rate-v2',
      'BTC/USDT',
      '4h'
    );
  });

  it('returns 400 when strategy param is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?symbol=BTC%2FUSDT&timeframe=4h',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when symbol param is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?strategy=funding-rate-v2&timeframe=4h',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when timeframe param is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?strategy=funding-rate-v2&symbol=BTC%2FUSDT',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 500 when service throws', async () => {
    mockGetStrategyConfigVersions.mockRejectedValueOnce(new Error('Query timeout'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/versions?strategy=funding-rate-v2&symbol=BTC%2FUSDT&timeframe=4h',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Query timeout');
  });
});

// ============================================================================
// GET /api/strategy-configs/:id
// ============================================================================

describe('GET /api/strategy-configs/:id', () => {
  it('returns 200 with the config when found', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('cfg-123');
    expect(body.strategyName).toBe('funding-rate-v2');
    expect(body.symbol).toBe('BTC/USDT');
  });

  it('returns 404 when config not found', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('does-not-exist');
  });

  it('returns 500 when service throws', async () => {
    mockGetStrategyConfig.mockRejectedValueOnce(new Error('Unexpected DB error'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Unexpected DB error');
  });
});

// ============================================================================
// POST /api/strategy-configs
// ============================================================================

describe('POST /api/strategy-configs', () => {
  it('returns 201 when a new config is created', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValueOnce({
      config: sampleConfig,
      created: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: { threshold: 0.0002 },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.created).toBe(true);
    expect(body.config.id).toBe('cfg-123');
  });

  it('returns 200 when an existing config is found (dedup)', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValueOnce({
      config: sampleConfig,
      created: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: { threshold: 0.0002 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created).toBe(false);
  });

  it('passes parsed body fields to service', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValueOnce({
      config: sampleConfig,
      created: true,
    });

    await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'sma-crossover',
        symbol: 'ETH/USDT',
        timeframe: '1h',
        params: { fast: 10, slow: 20 },
      },
    });

    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledWith({
      strategyName: 'sma-crossover',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      params: { fast: 10, slow: 20 },
    });
  });

  it('defaults params to empty object when not provided', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValueOnce({
      config: { ...sampleConfig, params: {} },
      created: true,
    });

    await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
        timeframe: '4h',
      },
    });

    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledWith(
      expect.objectContaining({ params: {} })
    );
  });

  it('returns 400 when strategyName is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        symbol: 'BTC/USDT',
        timeframe: '4h',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when symbol is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        timeframe: '4h',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when timeframe is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when strategyName is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: '',
        symbol: 'BTC/USDT',
        timeframe: '4h',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 400 when service throws empty params error', async () => {
    mockFindOrCreateStrategyConfig.mockRejectedValueOnce(
      new Error(
        'Cannot create strategy config for "unknown-strategy" with empty params. ' +
        'Either provide params explicitly or ensure the strategy defines default parameters.'
      )
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'unknown-strategy',
        symbol: 'BTC/USDT',
        timeframe: '4h',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Cannot create strategy config');
    expect(response.json().error).toContain('empty params');
  });

  it('returns 500 when service throws a non-validation error', async () => {
    mockFindOrCreateStrategyConfig.mockRejectedValueOnce(new Error('Insert failed'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy-configs',
      payload: {
        strategyName: 'funding-rate-v2',
        symbol: 'BTC/USDT',
        timeframe: '4h',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Insert failed');
  });
});

// ============================================================================
// DELETE /api/strategy-configs/:id
// ============================================================================

describe('DELETE /api/strategy-configs/:id', () => {
  it('returns 200 with deletion counts when config exists', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetStrategyConfigDeletionInfo.mockResolvedValueOnce({
      runCount: 3,
      paperSessionCount: 1,
      optimizationCount: 0,
    });
    mockDeleteStrategyConfig.mockResolvedValueOnce(undefined);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deletedRuns).toBe(3);
    expect(body.unlinkedSessions).toBe(1);
    expect(body.message).toContain('cfg-123');
  });

  it('calls services in correct order: get → info → delete', async () => {
    const callOrder: string[] = [];
    mockGetStrategyConfig.mockImplementationOnce(async () => {
      callOrder.push('getStrategyConfig');
      return sampleConfig;
    });
    mockGetStrategyConfigDeletionInfo.mockImplementationOnce(async () => {
      callOrder.push('getDeletionInfo');
      return { runCount: 0, paperSessionCount: 0, optimizationCount: 0 };
    });
    mockDeleteStrategyConfig.mockImplementationOnce(async () => {
      callOrder.push('deleteStrategyConfig');
    });

    await app.inject({
      method: 'DELETE',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(callOrder).toEqual(['getStrategyConfig', 'getDeletionInfo', 'deleteStrategyConfig']);
  });

  it('returns 404 when config not found', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/strategy-configs/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('does-not-exist');
    expect(mockDeleteStrategyConfig).not.toHaveBeenCalled();
  });

  it('returns 200 with zero counts when no linked entities', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetStrategyConfigDeletionInfo.mockResolvedValueOnce({
      runCount: 0,
      paperSessionCount: 0,
      optimizationCount: 0,
    });
    mockDeleteStrategyConfig.mockResolvedValueOnce(undefined);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deletedRuns).toBe(0);
    expect(body.unlinkedSessions).toBe(0);
  });

  it('returns 500 when deleteStrategyConfig throws', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetStrategyConfigDeletionInfo.mockResolvedValueOnce({
      runCount: 0,
      paperSessionCount: 0,
      optimizationCount: 0,
    });
    mockDeleteStrategyConfig.mockRejectedValueOnce(new Error('Transaction rolled back'));

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/strategy-configs/cfg-123',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Transaction rolled back');
  });
});

// ============================================================================
// GET /api/strategy-configs/:id/runs
// ============================================================================

describe('GET /api/strategy-configs/:id/runs', () => {
  it('returns 200 with mapped runs array and total', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockResolvedValueOnce({
      summaries: [sampleSummary],
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.results).toHaveLength(1);

    const run = body.results[0];
    expect(run.id).toBe('run-1');
    expect(run.strategyName).toBe('funding-rate-v2');
    expect(run.symbol).toBe('BTC/USDT');
    expect(run.timeframe).toBe('4h');
    expect(run.exchange).toBe('bybit');
    expect(run.totalReturnPercent).toBe(18.5);
    expect(run.sharpeRatio).toBe(1.52);
    expect(run.maxDrawdownPercent).toBe(-8.3);
    expect(run.winRate).toBe(55);
    expect(run.profitFactor).toBe(1.8);
    expect(run.totalTrades).toBe(47);
    expect(run.totalFees).toBe(-125);
    expect(run.mode).toBe('futures');
    expect(run.params).toEqual({ threshold: 0.0002 });
    expect(run.strategyConfigId).toBe('cfg-123');
  });

  it('formats createdAt as ISO string in runAt field', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockResolvedValueOnce({
      summaries: [sampleSummary],
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    const run = response.json().results[0];
    expect(run.runAt).toBe(new Date(1710000000000).toISOString());
  });

  it('passes strategyConfigId filter to getBacktestSummaries', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockResolvedValueOnce({ summaries: [], total: 0 });

    await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    expect(mockGetBacktestSummaries).toHaveBeenCalledWith(
      1000,
      0,
      { strategyConfigId: 'cfg-123' }
    );
  });

  it('returns 200 with empty results when no runs exist', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockResolvedValueOnce({ summaries: [], total: 0 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 404 when config not found', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/does-not-exist/runs',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('does-not-exist');
    expect(mockGetBacktestSummaries).not.toHaveBeenCalled();
  });

  it('returns 500 when getBacktestSummaries throws', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockRejectedValueOnce(new Error('Summaries fetch failed'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Summaries fetch failed');
  });

  it('maps aggregation fields when present', async () => {
    const summaryWithAgg = {
      ...sampleSummary,
      aggregationId: 'agg-001',
      aggregationName: 'My Portfolio',
    };
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockGetBacktestSummaries.mockResolvedValueOnce({
      summaries: [summaryWithAgg],
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/runs',
    });

    const run = response.json().results[0];
    expect(run.aggregationId).toBe('agg-001');
    expect(run.aggregationName).toBe('My Portfolio');
  });
});

// ============================================================================
// GET /api/strategy-configs/:id/paper-sessions
// ============================================================================

describe('GET /api/strategy-configs/:id/paper-sessions', () => {
  const sampleSessionRow = {
    id: 'sess-001',
    name: 'BTC Strategy Session',
    status: 'running',
    initial_capital: '10000',
    current_equity: '10850.50',
    created_at: '1710000000000',
    updated_at: '1710500000000',
    aggregation_config_id: null,
  };

  it('returns 200 with mapped sessions array', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({ rows: [sampleSessionRow] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);

    const session = body[0];
    expect(session.id).toBe('sess-001');
    expect(session.name).toBe('BTC Strategy Session');
    expect(session.status).toBe('running');
    expect(session.initialCapital).toBe(10000);
    expect(session.currentEquity).toBe(10850.5);
    expect(session.createdAt).toBe(1710000000000);
    expect(session.updatedAt).toBe(1710500000000);
  });

  it('converts numeric string fields to numbers', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ ...sampleSessionRow, initial_capital: '25000.99', current_equity: '27543.21' }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    const session = response.json()[0];
    expect(session.initialCapital).toBe(25000.99);
    expect(session.currentEquity).toBe(27543.21);
  });

  it('maps aggregationConfigId when present', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ ...sampleSessionRow, aggregation_config_id: 'agg-007' }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    const session = response.json()[0];
    expect(session.aggregationConfigId).toBe('agg-007');
  });

  it('sets aggregationConfigId to undefined when null in DB', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({ rows: [sampleSessionRow] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    const session = response.json()[0];
    // null aggregation_config_id maps to undefined, which JSON-serializes as absent
    expect(session.aggregationConfigId).toBeUndefined();
  });

  it('returns 200 with empty array when no sessions', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns 404 when config not found', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/does-not-exist/paper-sessions',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('does-not-exist');
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('passes the config id as query parameter to pool.query', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    const [, queryParams] = mockPoolQuery.mock.calls[0];
    expect(queryParams).toEqual(['cfg-123']);
  });

  it('returns 500 when pool.query throws', async () => {
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockRejectedValueOnce(new Error('Connection lost'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('Connection lost');
  });

  it('returns multiple sessions preserving order', async () => {
    const rows = [
      { ...sampleSessionRow, id: 'sess-001', name: 'Session A', created_at: '1710000000000' },
      { ...sampleSessionRow, id: 'sess-002', name: 'Session B', created_at: '1709000000000' },
    ];
    mockGetStrategyConfig.mockResolvedValueOnce(sampleConfig);
    mockPoolQuery.mockResolvedValueOnce({ rows });

    const response = await app.inject({
      method: 'GET',
      url: '/api/strategy-configs/cfg-123/paper-sessions',
    });

    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Session A');
    expect(body[1].name).toBe('Session B');
  });
});
