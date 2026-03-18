/**
 * PaperConnector Tests
 *
 * Tests for the paper trading connector that simulates exchange execution.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperConnector } from '../paper-connector.js';
import type { ConnectorConfig } from '../types.js';

// Helper: default config used by most tests
const defaultConfig: ConnectorConfig = {
  type: 'paper',
  initialCapital: 10_000,
  slippagePct: 0,
  feePct: 0,
};

// Helper: build a connected connector with a price set
async function connectedConnector(
  config: ConnectorConfig = defaultConfig,
  prices: Record<string, number> = { 'BTC/USDT': 50_000 },
): Promise<PaperConnector> {
  const c = new PaperConnector(config);
  await c.connect();
  for (const [symbol, price] of Object.entries(prices)) {
    c.setPrice(symbol, price);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------
describe('PaperConnector — constructor', () => {
  it('sets initial capital from config', async () => {
    const c = await connectedConnector({ type: 'paper', initialCapital: 25_000 });
    const balance = await c.getBalance();
    expect(balance.total).toBe(25_000);
    expect(balance.available).toBe(25_000);
    expect(balance.unrealizedPnl).toBe(0);
  });

  it('defaults to 0 slippage and 0 fee when not provided', async () => {
    const c = await connectedConnector({ type: 'paper', initialCapital: 10_000 });
    const result = await c.openLong('BTC/USDT', 0.1);
    // Fill price = 50_000 with 0 slippage, no extra fee
    expect(result.price).toBe(50_000);
    expect(result.fee).toBe(0);
    expect(result.status).toBe('filled');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
describe('PaperConnector — lifecycle', () => {
  it('is not connected before connect()', () => {
    const c = new PaperConnector(defaultConfig);
    expect(c.isConnected()).toBe(false);
  });

  it('connect() sets connected state', async () => {
    const c = new PaperConnector(defaultConfig);
    await c.connect();
    expect(c.isConnected()).toBe(true);
  });

  it('disconnect() clears connected state and emits disconnect event', async () => {
    const c = new PaperConnector(defaultConfig);
    await c.connect();
    const handler = vi.fn();
    c.on('disconnect', handler);
    await c.disconnect();
    expect(c.isConnected()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('type is "paper"', () => {
    const c = new PaperConnector(defaultConfig);
    expect(c.type).toBe('paper');
  });
});

// ---------------------------------------------------------------------------
// Trading when not connected — must throw
// ---------------------------------------------------------------------------
describe('PaperConnector — not connected guard', () => {
  it('openLong throws when not connected', async () => {
    const c = new PaperConnector(defaultConfig);
    c.setPrice('BTC/USDT', 50_000);
    await expect(c.openLong('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });

  it('openShort throws when not connected', async () => {
    const c = new PaperConnector(defaultConfig);
    c.setPrice('BTC/USDT', 50_000);
    await expect(c.openShort('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });

  it('closeLong throws when not connected', async () => {
    const c = new PaperConnector(defaultConfig);
    c.setPrice('BTC/USDT', 50_000);
    await expect(c.closeLong('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });

  it('closeShort throws when not connected', async () => {
    const c = new PaperConnector(defaultConfig);
    c.setPrice('BTC/USDT', 50_000);
    await expect(c.closeShort('BTC/USDT', 0.1)).rejects.toThrow('not connected');
  });
});

// ---------------------------------------------------------------------------
// openLong
// ---------------------------------------------------------------------------
describe('PaperConnector — openLong', () => {
  it('creates a long position and deducts cash (no fee)', async () => {
    const c = await connectedConnector();
    // BTC/USDT @ 50_000, buy 0.1 BTC → costs 5_000
    const result = await c.openLong('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('long');
    expect(result.side).toBe('buy');
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.price).toBe(50_000);
    expect(result.amount).toBe(0.1);
    expect(result.fee).toBe(0);

    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(5_000); // 10_000 - 5_000
  });

  it('returns rejected when insufficient cash', async () => {
    const c = await connectedConnector();
    // Try to buy 1 BTC = 50_000 but only have 10_000
    const result = await c.openLong('BTC/USDT', 1);
    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/insufficient/i);
  });

  it('returns rejected when no price is set for symbol', async () => {
    const c = new PaperConnector(defaultConfig);
    await c.connect();
    // No price set for ETH/USDT
    const result = await c.openLong('ETH/USDT', 1);
    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/no price/i);
  });

  it('applies slippage to fill price for long (price increases)', async () => {
    const config: ConnectorConfig = {
      type: 'paper',
      initialCapital: 10_000,
      slippagePct: 0.1, // 0.1%
      feePct: 0,
    };
    const c = await connectedConnector(config);
    const result = await c.openLong('BTC/USDT', 0.1);
    // Fill price = 50_000 * (1 + 0.001) = 50_050
    expect(result.price).toBeCloseTo(50_050);
    expect(result.status).toBe('filled');
  });

  it('deducts fee from cash', async () => {
    const config: ConnectorConfig = {
      type: 'paper',
      initialCapital: 10_000,
      slippagePct: 0,
      feePct: 0.1, // 0.1%
    };
    const c = await connectedConnector(config);
    // Buy 0.1 BTC @ 50_000 = 5_000, fee = 5_000 * 0.001 = 5
    const result = await c.openLong('BTC/USDT', 0.1);
    expect(result.fee).toBeCloseTo(5);
    expect(result.status).toBe('filled');
    const balance = await c.getBalance();
    // Paid 5_000 + 5 fee = 5_005 → remaining 4_995
    expect(balance.available).toBeCloseTo(4_995);
  });

  it('emits trade event on successful open', async () => {
    const c = await connectedConnector();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openLong('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    const result = handler.mock.calls[0][0];
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('long');
  });

  it('does not emit trade event for rejected orders', async () => {
    const c = await connectedConnector();
    const handler = vi.fn();
    c.on('trade', handler);
    await c.openLong('BTC/USDT', 100); // Insufficient funds
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// openShort
// ---------------------------------------------------------------------------
describe('PaperConnector — openShort', () => {
  it('creates a short position', async () => {
    const c = await connectedConnector();
    const result = await c.openShort('BTC/USDT', 0.1);
    expect(result.status).toBe('filled');
    expect(result.direction).toBe('short');
    expect(result.side).toBe('sell');
    expect(result.price).toBe(50_000);
    expect(result.amount).toBe(0.1);
  });

  it('short with fee deducts fee from cash (not full notional)', async () => {
    const config: ConnectorConfig = {
      type: 'paper',
      initialCapital: 10_000,
      slippagePct: 0,
      feePct: 0.1, // 0.1%
    };
    const c = await connectedConnector(config);
    // Short 0.1 BTC @ 50_000 → notional = 5_000, fee = 5
    const result = await c.openShort('BTC/USDT', 0.1);
    expect(result.fee).toBeCloseTo(5);
    const balance = await c.getBalance();
    // Only fee is deducted from cash (margin model)
    expect(balance.available).toBeCloseTo(9_995);
  });

  it('applies slippage for short (price decreases, worse fill)', async () => {
    const config: ConnectorConfig = {
      type: 'paper',
      initialCapital: 10_000,
      slippagePct: 0.1,
      feePct: 0,
    };
    const c = await connectedConnector(config);
    const result = await c.openShort('BTC/USDT', 0.1);
    // Fill price = 50_000 * (1 - 0.001) = 49_950
    expect(result.price).toBeCloseTo(49_950);
  });

  it('returns rejected for insufficient cash for fee', async () => {
    const config: ConnectorConfig = {
      type: 'paper',
      initialCapital: 1, // Almost no capital
      slippagePct: 0,
      feePct: 10, // 10% fee
    };
    const c = await connectedConnector(config);
    // Fee = 0.1 * 50_000 * 0.1 = 500, but only have 1
    const result = await c.openShort('BTC/USDT', 0.1);
    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/insufficient/i);
  });
});

// ---------------------------------------------------------------------------
// closeLong
// ---------------------------------------------------------------------------
describe('PaperConnector — closeLong', () => {
  it('closes long position with profit', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1); // Buy at 50_000

    // Price rises to 55_000 → profit = 0.1 * 5_000 = 500
    c.setPrice('BTC/USDT', 55_000);
    const result = await c.closeLong('BTC/USDT', 0.1);

    expect(result.status).toBe('filled');
    expect(result.direction).toBe('long');
    expect(result.side).toBe('sell');
    expect(result.price).toBe(55_000);
    expect(result.amount).toBe(0.1);
    expect(result.fee).toBe(0);
    // Cash after: started 10_000, paid 5_000, received 5_500 → 10_500
    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(10_500);
  });

  it('closes long position with loss', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1); // Buy at 50_000 → pay 5_000

    // Price drops to 45_000 → loss = 0.1 * 5_000 = 500
    c.setPrice('BTC/USDT', 45_000);
    const result = await c.closeLong('BTC/USDT', 0.1);

    expect(result.status).toBe('filled');
    // Cash after: 10_000 - 5_000 + 4_500 = 9_500
    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(9_500);
  });

  it('returns rejected when no long position exists', async () => {
    const c = await connectedConnector();
    const result = await c.closeLong('BTC/USDT', 0.1);
    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/no (long )?position/i);
  });

  it('returns rejected when no price set for symbol', async () => {
    const c = new PaperConnector(defaultConfig);
    await c.connect();
    // Manually set a position by opening with a known price first
    c.setPrice('ETH/USDT', 3_000);
    await c.openLong('ETH/USDT', 1);
    // Now clear price (simulate missing price scenario using unknown symbol)
    const result = await c.closeLong('BTC/USDT', 0.1);
    expect(result.status).toBe('rejected');
  });

  it('emits trade event on close', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1);
    const handler = vi.fn();
    c.on('trade', handler);
    await c.closeLong('BTC/USDT', 0.1);
    expect(handler).toHaveBeenCalledTimes(1);
    const result = handler.mock.calls[0][0];
    expect(result.direction).toBe('long');
    expect(result.side).toBe('sell');
  });
});

// ---------------------------------------------------------------------------
// closeShort
// ---------------------------------------------------------------------------
describe('PaperConnector — closeShort', () => {
  it('closes short position with profit (price fell)', async () => {
    const c = await connectedConnector();
    await c.openShort('BTC/USDT', 0.1); // Short at 50_000

    // Price drops to 45_000 → profit = 0.1 * 5_000 = 500
    c.setPrice('BTC/USDT', 45_000);
    const result = await c.closeShort('BTC/USDT', 0.1);

    expect(result.status).toBe('filled');
    expect(result.direction).toBe('short');
    expect(result.side).toBe('buy');
    expect(result.price).toBe(45_000);
    // Cash: 10_000 + 500 profit = 10_500
    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(10_500);
  });

  it('closes short position with loss (price rose)', async () => {
    const c = await connectedConnector();
    await c.openShort('BTC/USDT', 0.1); // Short at 50_000

    // Price rises to 55_000 → loss = 0.1 * 5_000 = 500
    c.setPrice('BTC/USDT', 55_000);
    const result = await c.closeShort('BTC/USDT', 0.1);

    expect(result.status).toBe('filled');
    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(9_500);
  });

  it('returns rejected when no short position exists', async () => {
    const c = await connectedConnector();
    const result = await c.closeShort('BTC/USDT', 0.1);
    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/no (short )?position/i);
  });
});

// ---------------------------------------------------------------------------
// closeAllPositions
// ---------------------------------------------------------------------------
describe('PaperConnector — closeAllPositions', () => {
  it('closes everything and returns results', async () => {
    const c = await connectedConnector(defaultConfig, {
      'BTC/USDT': 50_000,
      'ETH/USDT': 3_000,
    });
    await c.openLong('BTC/USDT', 0.1);
    await c.openShort('ETH/USDT', 1);

    const results = await c.closeAllPositions();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'filled')).toBe(true);

    const positions = await c.getPositions();
    expect(positions).toHaveLength(0);
  });

  it('returns empty array when no positions open', async () => {
    const c = await connectedConnector();
    const results = await c.closeAllPositions();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getPositions / getPosition
// ---------------------------------------------------------------------------
describe('PaperConnector — getPositions / getPosition', () => {
  it('getPositions returns all open positions', async () => {
    const c = await connectedConnector(defaultConfig, {
      'BTC/USDT': 50_000,
      'ETH/USDT': 3_000,
    });
    await c.openLong('BTC/USDT', 0.1);
    await c.openShort('ETH/USDT', 1);

    const positions = await c.getPositions();
    expect(positions).toHaveLength(2);
    const btcPos = positions.find((p) => p.symbol === 'BTC/USDT');
    const ethPos = positions.find((p) => p.symbol === 'ETH/USDT');
    expect(btcPos?.direction).toBe('long');
    expect(btcPos?.amount).toBe(0.1);
    expect(ethPos?.direction).toBe('short');
    expect(ethPos?.amount).toBe(1);
  });

  it('getPositions returns empty array when no positions', async () => {
    const c = await connectedConnector();
    const positions = await c.getPositions();
    expect(positions).toHaveLength(0);
  });

  it('getPosition returns null for unknown symbol', async () => {
    const c = await connectedConnector();
    const pos = await c.getPosition('UNKNOWN/USDT');
    expect(pos).toBeNull();
  });

  it('getPosition returns position for known symbol', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1);
    const pos = await c.getPosition('BTC/USDT');
    expect(pos).not.toBeNull();
    expect(pos!.symbol).toBe('BTC/USDT');
    expect(pos!.direction).toBe('long');
    expect(pos!.entryPrice).toBe(50_000);
    expect(pos!.amount).toBe(0.1);
  });

  it('getPosition returns null after position is closed', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1);
    await c.closeLong('BTC/USDT', 0.1);
    const pos = await c.getPosition('BTC/USDT');
    expect(pos).toBeNull();
  });

  it('unrealizedPnl reflects current price', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1); // Buy at 50_000
    c.setPrice('BTC/USDT', 55_000); // Price rises 5_000
    const pos = await c.getPosition('BTC/USDT');
    // Unrealized PnL = 0.1 * 5_000 = 500
    expect(pos!.unrealizedPnl).toBeCloseTo(500);
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------
describe('PaperConnector — getBalance', () => {
  it('getBalance returns correct total/available/unrealizedPnl', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1); // Pay 5_000

    // Price still 50_000 → unrealizedPnl = 0
    const balance = await c.getBalance();
    expect(balance.available).toBeCloseTo(5_000);
    expect(balance.unrealizedPnl).toBeCloseTo(0);
    expect(balance.total).toBeCloseTo(10_000); // cash + position market value
  });

  it('total equity reflects unrealized gains', async () => {
    const c = await connectedConnector();
    await c.openLong('BTC/USDT', 0.1); // Pay 5_000 @ 50_000
    c.setPrice('BTC/USDT', 60_000);   // Gain 0.1 * 10_000 = 1_000

    const balance = await c.getBalance();
    expect(balance.unrealizedPnl).toBeCloseTo(1_000);
    expect(balance.total).toBeCloseTo(11_000); // 5_000 cash + 6_000 position
    expect(balance.available).toBeCloseTo(5_000); // Cash unchanged
  });

  it('total equity reflects unrealized short losses', async () => {
    const c = await connectedConnector();
    await c.openShort('BTC/USDT', 0.1); // Short at 50_000, only fee deducted
    c.setPrice('BTC/USDT', 55_000); // Price rises → loss = 500

    const balance = await c.getBalance();
    expect(balance.unrealizedPnl).toBeCloseTo(-500);
    expect(balance.total).toBeCloseTo(9_500);
  });
});

// ---------------------------------------------------------------------------
// Multiple positions on different symbols
// ---------------------------------------------------------------------------
describe('PaperConnector — multiple positions', () => {
  it('tracks long + short positions on different symbols independently', async () => {
    const c = await connectedConnector(defaultConfig, {
      'BTC/USDT': 50_000,
      'ETH/USDT': 3_000,
    });
    await c.openLong('BTC/USDT', 0.1);  // Cost 5_000
    await c.openShort('ETH/USDT', 1);   // Cost 0 cash (margin), just fee = 0

    const positions = await c.getPositions();
    expect(positions).toHaveLength(2);

    // Close BTC only
    await c.closeLong('BTC/USDT', 0.1);
    const afterClose = await c.getPositions();
    expect(afterClose).toHaveLength(1);
    expect(afterClose[0].symbol).toBe('ETH/USDT');
  });

  it('entryPrice is stored per-symbol at time of opening', async () => {
    const c = await connectedConnector(defaultConfig, {
      'BTC/USDT': 50_000,
      'ETH/USDT': 3_000,
    });
    await c.openLong('BTC/USDT', 0.1);
    await c.openLong('ETH/USDT', 1);

    const btcPos = await c.getPosition('BTC/USDT');
    const ethPos = await c.getPosition('ETH/USDT');
    expect(btcPos!.entryPrice).toBe(50_000);
    expect(ethPos!.entryPrice).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------
describe('PaperConnector — events', () => {
  it('on() registers multiple handlers for the same event', async () => {
    const c = await connectedConnector();
    const h1 = vi.fn();
    const h2 = vi.fn();
    c.on('trade', h1);
    c.on('trade', h2);
    await c.openLong('BTC/USDT', 0.1);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('error event can be registered', async () => {
    const c = await connectedConnector();
    const handler = vi.fn();
    c.on('error', handler);
    // Just assert it doesn't throw registering
    expect(handler).not.toHaveBeenCalled();
  });

  it('closeAllPositions emits a trade event per closed position', async () => {
    const c = await connectedConnector(defaultConfig, {
      'BTC/USDT': 50_000,
      'ETH/USDT': 3_000,
    });
    await c.openLong('BTC/USDT', 0.1);
    await c.openShort('ETH/USDT', 1);

    const handler = vi.fn();
    c.on('trade', handler);
    await c.closeAllPositions();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
