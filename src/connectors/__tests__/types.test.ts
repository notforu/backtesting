/**
 * Connector Factory Tests
 */

import { describe, it, expect } from 'vitest';
import { createConnector } from '../connector-factory.js';
import { PaperConnector } from '../paper-connector.js';
import type { ConnectorConfig } from '../types.js';

describe('createConnector', () => {
  it('returns a PaperConnector for type "paper"', () => {
    const config: ConnectorConfig = { type: 'paper', initialCapital: 10_000 };
    const connector = createConnector(config);
    expect(connector).toBeInstanceOf(PaperConnector);
    expect(connector.type).toBe('paper');
  });

  it('throws for bybit connector (not yet implemented)', () => {
    const config: ConnectorConfig = {
      type: 'bybit',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    };
    expect(() => createConnector(config)).toThrow(
      'BybitConnector not yet implemented',
    );
  });

  it('throws for bybit-testnet connector (not yet implemented)', () => {
    const config: ConnectorConfig = {
      type: 'bybit-testnet',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      testnet: true,
    };
    expect(() => createConnector(config)).toThrow(
      'BybitConnector not yet implemented',
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
