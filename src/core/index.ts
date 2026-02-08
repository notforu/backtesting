/**
 * Core module exports
 */

// Types
export * from './types.js';

// Portfolio
export { Portfolio } from './portfolio.js';

// Pairs Portfolio
export { PairsPortfolio } from './pairs-portfolio.js';

// Broker
export { Broker, type BrokerConfig, type OrderRequest } from './broker.js';

// Engine
export {
  runBacktest,
  createBacktestConfig,
  validateBacktestConfig,
  type EngineConfig,
} from './engine.js';

// Pairs Engine
export { runPairsBacktest } from './pairs-engine.js';
