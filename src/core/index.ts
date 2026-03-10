/**
 * Core module exports
 */

// Types
export * from './types.js';

// Portfolio
export { Portfolio } from './portfolio.js';

// Broker
export { Broker, type BrokerConfig, type OrderRequest } from './broker.js';

// Engine
export {
  runBacktest,
  createBacktestConfig,
  validateBacktestConfig,
  type EngineConfig,
} from './engine.js';
