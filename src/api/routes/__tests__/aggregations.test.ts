/**
 * Aggregation Routes Tests
 *
 * Tests HTTP-level behavior of the aggregation API using Fastify inject().
 * All database/service dependencies are mocked — no real DB connection needed.
 *
 * Focuses on:
 *   - POST /api/aggregations: verifies that sub-strategy configs are created
 *     and their IDs are stored on the aggregation config (the primary bug fix).
 *   - Content hash computation for the aggregation config.
 *   - GET/PUT/DELETE routes continue to work without regressions.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ============================================================================
// Hoisted mock functions
// ============================================================================

const mockSaveAggregationConfig = vi.fn();
const mockGetAggregationConfig = vi.fn();
const mockGetAggregationConfigs = vi.fn();
const mockUpdateAggregationConfig = vi.fn();
const mockDeleteAggregationConfig = vi.fn();
const mockFindOrCreateStrategyConfig = vi.fn();

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('../../../data/db.js', () => ({
  saveAggregationConfig: (...args: unknown[]) => mockSaveAggregationConfig(...args),
  getAggregationConfig: (...args: unknown[]) => mockGetAggregationConfig(...args),
  getAggregationConfigs: (...args: unknown[]) => mockGetAggregationConfigs(...args),
  updateAggregationConfig: (...args: unknown[]) => mockUpdateAggregationConfig(...args),
  deleteAggregationConfig: (...args: unknown[]) => mockDeleteAggregationConfig(...args),
}));

vi.mock('../../../data/strategy-config.js', () => ({
  findOrCreateStrategyConfig: (...args: unknown[]) => mockFindOrCreateStrategyConfig(...args),
}));

// content-hash is NOT mocked — we test real hash computation

import { aggregationRoutes } from '../aggregations.js';
import { computeAggregationConfigHash } from '../../../utils/content-hash.js';

// ============================================================================
// Fixtures
// ============================================================================

const sampleSubStrategy = {
  strategyName: 'funding-rate-v2',
  symbol: 'BTC/USDT',
  timeframe: '4h' as const,
  params: { threshold: 0.0002 },
};

const sampleSubStrategy2 = {
  strategyName: 'momentum-v1',
  symbol: 'ETH/USDT',
  timeframe: '1h' as const,
  params: { period: 14 },
};

const sampleStrategyConfigId1 = 'strategy-cfg-id-1';
const sampleStrategyConfigId2 = 'strategy-cfg-id-2';

function makeStrategyConfigResult(id: string, created = false) {
  return {
    config: {
      id,
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: {},
      contentHash: 'hash-' + id,
      name: 'funding-rate-v2 / BTC/USDT / 4h',
      createdAt: 1710000000000,
    },
    created,
  };
}

function makeAggregationConfig(overrides = {}) {
  return {
    id: 'agg-id-1',
    name: 'Test Aggregation',
    allocationMode: 'single_strongest',
    maxPositions: 3,
    subStrategies: [sampleSubStrategy],
    subStrategyConfigIds: [sampleStrategyConfigId1],
    contentHash: 'content-hash-123',
    initialCapital: 10000,
    exchange: 'bybit',
    mode: 'futures',
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(aggregationRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// POST /api/aggregations
// ============================================================================

describe('POST /api/aggregations', () => {
  it('calls findOrCreateStrategyConfig for each sub-strategy and saves their IDs', async () => {
    // Arrange
    mockFindOrCreateStrategyConfig
      .mockResolvedValueOnce(makeStrategyConfigResult(sampleStrategyConfigId1, true))
      .mockResolvedValueOnce(makeStrategyConfigResult(sampleStrategyConfigId2, false));

    mockSaveAggregationConfig.mockResolvedValue(undefined);

    // Act
    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'My Multi-Strategy',
        subStrategies: [sampleSubStrategy, sampleSubStrategy2],
      },
    });

    // Assert
    expect(response.statusCode).toBe(201);

    // findOrCreateStrategyConfig called once per sub-strategy
    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledTimes(2);
    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledWith({
      strategyName: sampleSubStrategy.strategyName,
      symbol: sampleSubStrategy.symbol,
      timeframe: sampleSubStrategy.timeframe,
      params: sampleSubStrategy.params,
    });
    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledWith({
      strategyName: sampleSubStrategy2.strategyName,
      symbol: sampleSubStrategy2.symbol,
      timeframe: sampleSubStrategy2.timeframe,
      params: sampleSubStrategy2.params,
    });

    // saveAggregationConfig called once with populated IDs
    expect(mockSaveAggregationConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveAggregationConfig.mock.calls[0][0];
    expect(savedConfig.subStrategyConfigIds).toEqual([
      sampleStrategyConfigId1,
      sampleStrategyConfigId2,
    ]);

    // Response body contains the IDs
    const body = JSON.parse(response.body);
    expect(body.subStrategyConfigIds).toEqual([
      sampleStrategyConfigId1,
      sampleStrategyConfigId2,
    ]);
  });

  it('computes and saves a contentHash on the aggregation config', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValue(
      makeStrategyConfigResult(sampleStrategyConfigId1, true)
    );
    mockSaveAggregationConfig.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'Hash Test',
        allocationMode: 'top_n',
        maxPositions: 2,
        subStrategies: [sampleSubStrategy],
      },
    });

    expect(response.statusCode).toBe(201);

    const expectedHash = computeAggregationConfigHash({
      allocationMode: 'top_n',
      maxPositions: 2,
      strategyConfigIds: [sampleStrategyConfigId1],
    });

    const savedConfig = mockSaveAggregationConfig.mock.calls[0][0];
    expect(savedConfig.contentHash).toBe(expectedHash);

    const body = JSON.parse(response.body);
    expect(body.contentHash).toBe(expectedHash);
  });

  it('uses empty params {} when sub-strategy params are omitted', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValue(
      makeStrategyConfigResult(sampleStrategyConfigId1, false)
    );
    mockSaveAggregationConfig.mockResolvedValue(undefined);

    await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'No Params Test',
        subStrategies: [
          { strategyName: 'funding-rate-v2', symbol: 'BTC/USDT', timeframe: '4h' },
        ],
      },
    });

    expect(mockFindOrCreateStrategyConfig).toHaveBeenCalledWith({
      strategyName: 'funding-rate-v2',
      symbol: 'BTC/USDT',
      timeframe: '4h',
      params: {},
    });
  });

  it('returns 400 when subStrategies is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: { name: 'Empty', subStrategies: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(mockSaveAggregationConfig).not.toHaveBeenCalled();
    expect(mockFindOrCreateStrategyConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when name is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: { subStrategies: [sampleSubStrategy] },
    });

    expect(response.statusCode).toBe(400);
    expect(mockSaveAggregationConfig).not.toHaveBeenCalled();
  });

  it('returns 500 when findOrCreateStrategyConfig throws a non-validation error', async () => {
    mockFindOrCreateStrategyConfig.mockRejectedValue(new Error('DB connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'Error Test',
        subStrategies: [sampleSubStrategy],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mockSaveAggregationConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when findOrCreateStrategyConfig throws empty params error', async () => {
    mockFindOrCreateStrategyConfig.mockRejectedValue(
      new Error(
        'Cannot create strategy config for "unknown-strategy" with empty params. ' +
        'Either provide params explicitly or ensure the strategy defines default parameters.'
      )
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'Empty Params Test',
        subStrategies: [
          { strategyName: 'unknown-strategy', symbol: 'BTC/USDT', timeframe: '4h' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Cannot create strategy config');
    expect(response.json().error).toContain('empty params');
    expect(mockSaveAggregationConfig).not.toHaveBeenCalled();
  });

  it('applies default values (allocationMode, maxPositions, initialCapital, exchange, mode)', async () => {
    mockFindOrCreateStrategyConfig.mockResolvedValue(
      makeStrategyConfigResult(sampleStrategyConfigId1, false)
    );
    mockSaveAggregationConfig.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/aggregations',
      payload: {
        name: 'Defaults Test',
        subStrategies: [sampleSubStrategy],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.allocationMode).toBe('single_strongest');
    expect(body.maxPositions).toBe(3);
    expect(body.initialCapital).toBe(10000);
    expect(body.exchange).toBe('bybit');
    expect(body.mode).toBe('futures');
  });
});

// ============================================================================
// GET /api/aggregations
// ============================================================================

describe('GET /api/aggregations', () => {
  it('returns list of aggregation configs', async () => {
    mockGetAggregationConfigs.mockResolvedValue([makeAggregationConfig()]);

    const response = await app.inject({ method: 'GET', url: '/api/aggregations' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('agg-id-1');
  });

  it('returns 500 when DB throws', async () => {
    mockGetAggregationConfigs.mockRejectedValue(new Error('DB error'));

    const response = await app.inject({ method: 'GET', url: '/api/aggregations' });

    expect(response.statusCode).toBe(500);
  });
});

// ============================================================================
// GET /api/aggregations/:id
// ============================================================================

describe('GET /api/aggregations/:id', () => {
  it('returns a single aggregation config', async () => {
    mockGetAggregationConfig.mockResolvedValue(makeAggregationConfig());

    const response = await app.inject({ method: 'GET', url: '/api/aggregations/agg-id-1' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('agg-id-1');
    expect(body.subStrategyConfigIds).toEqual([sampleStrategyConfigId1]);
  });

  it('returns 404 when not found', async () => {
    mockGetAggregationConfig.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/api/aggregations/nonexistent' });

    expect(response.statusCode).toBe(404);
  });
});

// ============================================================================
// PUT /api/aggregations/:id
// ============================================================================

describe('PUT /api/aggregations/:id', () => {
  it('updates name and returns updated config', async () => {
    const updated = makeAggregationConfig({ name: 'Updated Name' });
    mockUpdateAggregationConfig.mockResolvedValue(updated);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/aggregations/agg-id-1',
      payload: { name: 'Updated Name' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.name).toBe('Updated Name');
  });

  it('returns 404 when config not found', async () => {
    mockUpdateAggregationConfig.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/aggregations/nonexistent',
      payload: { name: 'New Name' },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ============================================================================
// DELETE /api/aggregations/:id
// ============================================================================

describe('DELETE /api/aggregations/:id', () => {
  it('deletes an aggregation config', async () => {
    mockDeleteAggregationConfig.mockResolvedValue(true);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/aggregations/agg-id-1',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 when config not found', async () => {
    mockDeleteAggregationConfig.mockResolvedValue(false);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/aggregations/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });
});
