/**
 * BybitConnector Tests
 *
 * Tests for the real Bybit trading connector backed by CCXT.
 * CCXT is fully mocked — no real network calls are made.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConnectorConfig } from '../types.js';

// ---------------------------------------------------------------------------
// CCXT mock
// We mock the entire 'ccxt' module and capture the constructor calls so each
// test can control what the fake exchange returns.
//
// Strategy: vi.mock defines a stable mock factory. The `bybit` export is a
// class whose constructor stores the config (for assertion) and copies all
// methods from `mockExchangeInstance` (set per-test in beforeEach).
// ---------------------------------------------------------------------------

// Holds the mock methods that each test configures
let mockExchangeInstance: Record<string, ReturnType<typeof vi.fn>>;

vi.mock('ccxt', async () => {
  // We define MockBybit as a class so `new ccxt.bybit(...)` works correctly
  class MockBybit {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public readonly _constructorArgs: any) {
      // Methods are copied lazily via getters so each test's mockExchangeInstance
      // is picked up at call time rather than construction time
    }

    loadMarkets(...args: unknown[]) {
      return mockExchangeInstance.loadMarkets(...args);
    }

    fetchBalance(...args: unknown[]) {
      return mockExchangeInstance.fetchBalance(...args);
    }

    createMarketBuyOrder(...args: unknown[]) {
      return mockExchangeInstance.createMarketBuyOrder(...args);
    }

    createMarketSellOrder(...args: unknown[]) {
      return mockExchangeInstance.createMarketSellOrder(...args);
    }

    fetchPositions(...args: unknown[]) {
      return mockExchangeInstance.fetchPositions(...args);
    }
  }

  return {
    default: { bybit: MockBybit },
    bybit: MockBybit,
  };
});

// Import AFTER vi.mock so the mock is active
import { BybitConnector } from '../bybit-connector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<ConnectorConfig> = {},
): ConnectorConfig {
  return {
    type: 'bybit',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    ...overrides,
  };
}

/** Create a default mock exchange instance that succeeds on all calls. */
function makeMockExchange(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    loadMarkets: vi.fn().mockResolvedValue({}),
    fetchBalance: vi.fn().mockResolvedValue({
      USDT: { total: 10_000, free: 8_000 },
      total: { USDT: 10_000 },
      free: { USDT: 8_000 },
    }),
    createMarketBuyOrder: vi.fn().mockResolvedValue({
      id: 'order-buy-1',
      symbol: 'BTC/USDT',
      side: 'buy',
      price: 50_000,
      average: 50_000,
      amount: 0.1,
      filled: 0.1,
      fee: { cost: 5, currency: 'USDT' },
      timestamp: 1_700_000_000_000,
      status: 'closed',
    }),
    createMarketSellOrder: vi.fn().mockResolvedValue({
      id: 'order-sell-1',
      symbol: 'BTC/USDT',
      side: 'sell',
      price: 50_000,
      average: 50_000,
      amount: 0.1,
      filled: 0.1,
      fee: { cost: 5, currency: 'USDT' },
      timestamp: 1_700_000_000_000,
      status: 'closed',
    }),
    fetchPositions: vi.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Test setup: reset mock instance before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockExchangeInstance = makeMockExchange();
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('BybitConnector — constructor', () => {
  it('throws when apiKey is missing', () => {
    expect(
      () => new BybitConnector({ type: 'bybit', apiSecret: 'secret' }),
    ).toThrow('Bybit API key and secret are required');
  });

  it('throws when apiSecret is missing', () => {
    expect(
      () => new BybitConnector({ type: 'bybit', apiKey: 'key' }),
    ).toThrow('Bybit API key and secret are required');
  });

  it('throws when both apiKey and apiSecret are missing', () => {
    expect(() => new BybitConnector({ type: 'bybit' })).toThrow(
      'Bybit API key and secret are required',
    );
  });

  it('creates a ccxt.bybit instance with correct credentials', () => {
    // Access the internal exchange via a backdoor cast to inspect constructor args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new BybitConnector(makeConfig()) as any;
    expect(c.exchange._constructorArgs).toMatchObject({
      apiKey: 'test-api-key',
      secret: 'test-api-secret',
    });
  });

  it('sets sandbox=false for type "bybit" (live)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new BybitConnector(makeConfig({ type: 'bybit' })) as any;
    expect(c.exchange._constructorArgs.sandbox).toBe(false);
  });

  it('sets sandbox=true for type "bybit-testnet"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new BybitConnector(makeConfig({ type: 'bybit-testnet' })) as any;
    expect(c.exchange._constructorArgs.sandbox).toBe(true);
  });

  it('sets sandbox=true when config.testnet is true regardless of type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new BybitConnector(makeConfig({ type: 'bybit', testnet: true })) as any;
    expect(c.exchange._constructorArgs.sandbox).toBe(true);
  });

  it('type property reflects "bybit"', () => {
    const c = new BybitConnector(makeConfig({ type: 'bybit' }));
    expect(c.type).toBe('bybit');
  });

  it('type property reflects "bybit-testnet"', () => {
    const c = new BybitConnector(makeConfig({ type: 'bybit-testnet' }));
    expect(c.type).toBe('bybit-testnet');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — connect / disconnect
// ---------------------------------------------------------------------------

describe('BybitConnector — lifecycle', () => {
  it('isConnected() returns false before connect()', () => {
    const c = new BybitConnector(makeConfig());
    expect(c.isConnected()).toBe(false);
  });

  it('connect() calls loadMarkets and fetchBalance', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    expect(mockExchangeInstance.loadMarkets).toHaveBeenCalledTimes(1);
    expect(mockExchangeInstance.fetchBalance).toHaveBeenCalledTimes(1);
  });

  it('connect() sets isConnected() to true', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    expect(c.isConnected()).toBe(true);
  });

  it('connect() throws when credential check fails', async () => {
    mockExchangeInstance.fetchBalance = vi
      .fn()
      .mockRejectedValue(new Error('Invalid API key'));
    const c = new BybitConnector(makeConfig());
    await expect(c.connect()).rejects.toThrow('Invalid API key');
    expect(c.isConnected()).toBe(false);
  });

  it('disconnect() sets isConnected() to false', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    await c.disconnect();
    expect(c.isConnected()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guard: trading when not connected must throw
// ---------------------------------------------------------------------------

describe('BybitConnector — not-connected guard', () => {
  it('openLong throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.openLong('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });

  it('openShort throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.openShort('BTC/USDT', 0.1)).rejects.toThrow(
      'not connected',
    );
  });

  it('closeLong throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.closeLong('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });

  it('closeShort throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.closeShort('BTC/USDT', 0.1)).rejects.toThrow(
      'not connected',
    );
  });

  it('getPositions throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.getPositions()).rejects.toThrow('not connected');
  });

  it('getBalance throws when not connected', async () => {
    const c = new BybitConnector(makeConfig());
    await expect(c.getBalance()).rejects.toThrow('not connected');
  });
});

// ---------------------------------------------------------------------------
// openLong
// ---------------------------------------------------------------------------

describe('BybitConnector — openLong', () => {
  it('calls createMarketBuyOrder with symbol and amount', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    await c.openLong('BTC/USDT', 0.1);
    expect(mockExchangeInstance.createMarketBuyOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      0.1,
    );
  });

  it('returns a filled OrderResult with correct fields', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.openLong('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.direction).toBe('long');
    expect(result.side).toBe('buy');
    expect(result.price).toBe(50_000);
    expect(result.amount).toBe(0.1);
    expect(result.fee).toBe(5);
    expect(result.id).toBe('order-buy-1');
  });

  it('returns error OrderResult (does not throw) when exchange rejects', async () => {
    mockExchangeInstance.createMarketBuyOrder = vi
      .fn()
      .mockRejectedValue(new Error('Insufficient margin'));
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.openLong('BTC/USDT', 0.1);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Insufficient margin/);
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.direction).toBe('long');
  });

  it('emits trade event on successful openLong', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openLong('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].status).toBe('filled');
    expect(handler.mock.calls[0][0].direction).toBe('long');
  });

  it('does not emit trade event when openLong errors', async () => {
    mockExchangeInstance.createMarketBuyOrder = vi
      .fn()
      .mockRejectedValue(new Error('network error'));
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openLong('BTC/USDT', 0.1);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// openShort
// ---------------------------------------------------------------------------

describe('BybitConnector — openShort', () => {
  it('calls createMarketSellOrder with symbol and amount', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    await c.openShort('BTC/USDT', 0.1);
    expect(mockExchangeInstance.createMarketSellOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      0.1,
    );
  });

  it('returns a filled OrderResult with direction=short and side=sell', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.openShort('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('short');
    expect(result.side).toBe('sell');
    expect(result.price).toBe(50_000);
    expect(result.amount).toBe(0.1);
  });

  it('returns error OrderResult (does not throw) when exchange rejects', async () => {
    mockExchangeInstance.createMarketSellOrder = vi
      .fn()
      .mockRejectedValue(new Error('Symbol not found'));
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.openShort('BTC/USDT', 0.1);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Symbol not found/);
  });

  it('emits trade event on successful openShort', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openShort('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].direction).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// closeLong
// ---------------------------------------------------------------------------

describe('BybitConnector — closeLong', () => {
  it('calls createMarketSellOrder with reduceOnly=true', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    await c.closeLong('BTC/USDT', 0.1);
    expect(mockExchangeInstance.createMarketSellOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      0.1,
      expect.objectContaining({ reduceOnly: true }),
    );
  });

  it('returns a filled OrderResult with direction=long and side=sell', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.closeLong('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('long');
    expect(result.side).toBe('sell');
  });

  it('returns error OrderResult (does not throw) when exchange rejects', async () => {
    mockExchangeInstance.createMarketSellOrder = vi
      .fn()
      .mockRejectedValue(new Error('Position not open'));
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.closeLong('BTC/USDT', 0.1);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Position not open/);
  });

  it('emits trade event on successful closeLong', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.closeLong('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].direction).toBe('long');
    expect(handler.mock.calls[0][0].side).toBe('sell');
  });
});

// ---------------------------------------------------------------------------
// closeShort
// ---------------------------------------------------------------------------

describe('BybitConnector — closeShort', () => {
  it('calls createMarketBuyOrder with reduceOnly=true', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    await c.closeShort('BTC/USDT', 0.1);
    expect(mockExchangeInstance.createMarketBuyOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      0.1,
      expect.objectContaining({ reduceOnly: true }),
    );
  });

  it('returns a filled OrderResult with direction=short and side=buy', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.closeShort('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('short');
    expect(result.side).toBe('buy');
  });

  it('returns error OrderResult (does not throw) when exchange rejects', async () => {
    mockExchangeInstance.createMarketBuyOrder = vi
      .fn()
      .mockRejectedValue(new Error('Order rejected'));
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const result = await c.closeShort('BTC/USDT', 0.1);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Order rejected/);
  });

  it('emits trade event on successful closeShort', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.closeShort('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].direction).toBe('short');
    expect(handler.mock.calls[0][0].side).toBe('buy');
  });
});

// ---------------------------------------------------------------------------
// closeAllPositions
// ---------------------------------------------------------------------------

describe('BybitConnector — closeAllPositions', () => {
  it('returns empty array when no positions are open', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const results = await c.closeAllPositions();
    expect(results).toHaveLength(0);
  });

  it('closes one long position', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 0.1,
        entryPrice: 50_000,
        unrealizedPnl: 100,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const results = await c.closeAllPositions();
    expect(results).toHaveLength(1);
    // Closing a long = sell with reduceOnly
    expect(mockExchangeInstance.createMarketSellOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      0.1,
      expect.objectContaining({ reduceOnly: true }),
    );
  });

  it('closes one short position', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'ETH/USDT',
        side: 'short',
        contracts: 1,
        entryPrice: 3_000,
        unrealizedPnl: -50,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const results = await c.closeAllPositions();
    expect(results).toHaveLength(1);
    // Closing a short = buy with reduceOnly
    expect(mockExchangeInstance.createMarketBuyOrder).toHaveBeenCalledWith(
      'ETH/USDT',
      1,
      expect.objectContaining({ reduceOnly: true }),
    );
  });

  it('closes multiple positions and returns all results', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 0.1,
        entryPrice: 50_000,
        unrealizedPnl: 100,
        timestamp: 1_700_000_000_000,
      },
      {
        symbol: 'ETH/USDT',
        side: 'short',
        contracts: 1,
        entryPrice: 3_000,
        unrealizedPnl: -50,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const results = await c.closeAllPositions();
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getPositions
// ---------------------------------------------------------------------------

describe('BybitConnector — getPositions', () => {
  it('returns empty array when no positions', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const positions = await c.getPositions();
    expect(positions).toHaveLength(0);
  });

  it('filters out zero-size positions', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 0,          // zero — should be filtered
        entryPrice: 50_000,
        unrealizedPnl: 0,
        timestamp: 1_700_000_000_000,
      },
      {
        symbol: 'ETH/USDT',
        side: 'short',
        contracts: null,       // null — should be filtered
        entryPrice: 3_000,
        unrealizedPnl: 0,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const positions = await c.getPositions();
    expect(positions).toHaveLength(0);
  });

  it('maps CCXT position to ConnectorPosition correctly', async () => {
    const ts = 1_700_000_000_000;
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 0.2,
        entryPrice: 48_000,
        unrealizedPnl: 400,
        timestamp: ts,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const positions = await c.getPositions();
    expect(positions).toHaveLength(1);
    const pos = positions[0];
    expect(pos.symbol).toBe('BTC/USDT');
    expect(pos.direction).toBe('long');
    expect(pos.amount).toBe(0.2);
    expect(pos.entryPrice).toBe(48_000);
    expect(pos.unrealizedPnl).toBe(400);
    expect(pos.openedAt).toBe(ts);
  });

  it('maps short CCXT position direction correctly', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'ETH/USDT',
        side: 'short',
        contracts: 1,
        entryPrice: 3_000,
        unrealizedPnl: -100,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const positions = await c.getPositions();
    expect(positions[0].direction).toBe('short');
  });

  it('uses abs() so negative contracts (Bybit short representation) still work', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'SOL/USDT',
        side: 'short',
        contracts: -5,    // Some exchanges return negative contracts for shorts
        entryPrice: 100,
        unrealizedPnl: 0,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const positions = await c.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].amount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getPosition
// ---------------------------------------------------------------------------

describe('BybitConnector — getPosition', () => {
  it('returns null when symbol has no open position', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'ETH/USDT',
        side: 'long',
        contracts: 1,
        entryPrice: 3_000,
        unrealizedPnl: 0,
        timestamp: Date.now(),
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const pos = await c.getPosition('BTC/USDT');
    expect(pos).toBeNull();
  });

  it('returns position for matching symbol', async () => {
    mockExchangeInstance.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 0.1,
        entryPrice: 50_000,
        unrealizedPnl: 200,
        timestamp: 1_700_000_000_000,
      },
    ]);
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const pos = await c.getPosition('BTC/USDT');
    expect(pos).not.toBeNull();
    expect(pos!.symbol).toBe('BTC/USDT');
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe('BybitConnector — getBalance', () => {
  it('calls fetchBalance with type=swap', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    // Reset mock to track getBalance-specific calls (connect also calls fetchBalance)
    vi.clearAllMocks();
    await c.getBalance();
    expect(mockExchangeInstance.fetchBalance).toHaveBeenCalledWith({
      type: 'swap',
    });
  });

  it('maps USDT balance fields to ConnectorBalance', async () => {
    mockExchangeInstance.fetchBalance = vi.fn().mockResolvedValue({
      USDT: { total: 10_000, free: 7_500 },
      total: { USDT: 10_000 },
      free: { USDT: 7_500 },
    });
    const c = new BybitConnector(makeConfig());
    await c.connect();
    vi.clearAllMocks();
    // Re-mock because we cleared after connect
    mockExchangeInstance.fetchBalance = vi.fn().mockResolvedValue({
      USDT: { total: 10_000, free: 7_500 },
      total: { USDT: 10_000 },
      free: { USDT: 7_500 },
    });
    const balance = await c.getBalance();
    expect(balance.total).toBe(10_000);
    expect(balance.available).toBe(7_500);
  });

  it('returns zero balance when USDT key is absent', async () => {
    mockExchangeInstance.fetchBalance = vi.fn().mockResolvedValue({
      total: {},
      free: {},
    });
    const c = new BybitConnector(makeConfig());
    // connect also calls fetchBalance — re-mock after connect
    await c.connect();
    mockExchangeInstance.fetchBalance = vi.fn().mockResolvedValue({
      total: {},
      free: {},
    });
    const balance = await c.getBalance();
    expect(balance.total).toBe(0);
    expect(balance.available).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

describe('BybitConnector — events', () => {
  it('on() registers handler and receives trade events from openLong', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openLong('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      status: 'filled',
      direction: 'long',
    });
  });

  it('on() supports multiple handlers for the same event', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const h1 = vi.fn();
    const h2 = vi.fn();
    c.on('trade', h1);
    c.on('trade', h2);
    await c.openLong('BTC/USDT', 0.1);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('error event can be registered without throwing', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('error', handler);
    // Just registering should not throw
    expect(handler).not.toHaveBeenCalled();
  });

  it('disconnect event can be registered and is emitted on disconnect()', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const handler = vi.fn();
    c.on('disconnect', handler);
    await c.disconnect();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('trade events carry correct OrderResult shape', async () => {
    const c = new BybitConnector(makeConfig());
    await c.connect();
    const received: unknown[] = [];
    c.on('trade', (r) => received.push(r));
    await c.openLong('BTC/USDT', 0.1);
    await c.openShort('BTC/USDT', 0.1);
    expect(received).toHaveLength(2);
    const first = received[0] as { id: string; timestamp: number };
    const second = received[1] as { id: string; timestamp: number };
    expect(typeof first.id).toBe('string');
    expect(typeof first.timestamp).toBe('number');
    expect(typeof second.id).toBe('string');
  });
});
