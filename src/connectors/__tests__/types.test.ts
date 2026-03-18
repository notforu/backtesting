/**
 * Connector Factory Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createConnector } from '../connector-factory.js';
import { PaperConnector } from '../paper-connector.js';
import { BybitConnector } from '../bybit-connector.js';
import type { ConnectorConfig } from '../types.js';

// Mock CCXT so BybitConnector construction does not try to instantiate the
// real ccxt.bybit class (which would fail in unit test environment).
vi.mock('ccxt', async () => {
  class MockBybit {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public readonly _constructorArgs: any) {}
    loadMarkets = vi.fn().mockResolvedValue({});
    fetchBalance = vi.fn().mockResolvedValue({ total: {}, free: {} });
    createMarketBuyOrder = vi.fn();
    createMarketSellOrder = vi.fn();
    fetchPositions = vi.fn().mockResolvedValue([]);
  }
  return {
    default: { bybit: MockBybit },
    bybit: MockBybit,
  };
});

describe('createConnector', () => {
  it('returns a PaperConnector for type "paper"', () => {
    const config: ConnectorConfig = { type: 'paper', initialCapital: 10_000 };
    const connector = createConnector(config);
    expect(connector).toBeInstanceOf(PaperConnector);
    expect(connector.type).toBe('paper');
  });

  it('returns a BybitConnector for type "bybit"', () => {
    const config: ConnectorConfig = {
      type: 'bybit',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    };
    const connector = createConnector(config);
    expect(connector).toBeInstanceOf(BybitConnector);
    expect(connector.type).toBe('bybit');
  });

  it('returns a BybitConnector for type "bybit-testnet"', () => {
    const config: ConnectorConfig = {
      type: 'bybit-testnet',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      testnet: true,
    };
    const connector = createConnector(config);
    expect(connector).toBeInstanceOf(BybitConnector);
    expect(connector.type).toBe('bybit-testnet');
  });

  it('throws for bybit type when apiKey is missing', () => {
    const config: ConnectorConfig = {
      type: 'bybit',
      apiSecret: 'test-secret',
    };
    expect(() => createConnector(config)).toThrow(
      'Bybit API key and secret are required',
    );
  });

  it('throws with unknown connector type name in the error message', () => {
    // Cast to defeat TypeScript exhaustiveness check — simulates a runtime unknown type
    const config = { type: 'unknown-exchange' } as unknown as ConnectorConfig;
    expect(() => createConnector(config)).toThrow(
      'Unknown connector type: "unknown-exchange"',
    );
  });
});
