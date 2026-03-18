/**
 * Connector Factory
 *
 * Creates an IConnector instance for the specified connector type.
 */

import type { ConnectorConfig, IConnector } from './types.js';
import { PaperConnector } from './paper-connector.js';

/**
 * Factory function that returns an IConnector for the given config.
 */
export function createConnector(config: ConnectorConfig): IConnector {
  switch (config.type) {
    case 'paper':
      return new PaperConnector(config);
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
