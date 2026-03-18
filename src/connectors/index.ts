/**
 * Trading Connectors — barrel exports
 *
 * Public API for the connector abstraction layer.
 */

export type {
  ConnectorType,
  ConnectorConfig,
  OrderRequest,
  OrderResult,
  ConnectorPosition,
  ConnectorBalance,
  ConnectorEventMap,
  IConnector,
} from './types.js';

export { createConnector } from './connector-factory.js';
export { PaperConnector } from './paper-connector.js';
export { BybitConnector } from './bybit-connector.js';
