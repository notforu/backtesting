/**
 * Connector Factory
 *
 * Creates an IConnector instance for the specified connector type.
 * All connector implementations are stubs until the concrete classes
 * (PaperConnector, BybitConnector) are built.
 */

import type { ConnectorConfig, IConnector } from './types.js';

/**
 * Factory function that returns an IConnector for the given config.
 *
 * Throws immediately for any type — implementations are placeholders
 * until PaperConnector and BybitConnector are built.
 */
export function createConnector(config: ConnectorConfig): IConnector {
  switch (config.type) {
    case 'paper':
      throw new Error(
        'PaperConnector not yet implemented — use PaperTradingEngine directly for now',
      );
    case 'bybit':
    case 'bybit-testnet':
      throw new Error('BybitConnector not yet implemented');
    default: {
      // TypeScript exhaustiveness check — this branch is only reachable at
      // runtime when an unknown type is passed (e.g. from an API request).
      const exhaustive: never = config.type;
      throw new Error(`Unknown connector type: "${exhaustive}"`);
    }
  }
}
