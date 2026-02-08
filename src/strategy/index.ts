/**
 * Strategy module exports
 */

// Base types and interfaces
export {
  type Strategy,
  type StrategyContext,
  type StrategyParam,
  type StrategyParamType,
  type PortfolioState,
  type LogEntry,
  validateStrategyParams,
  getDefaultParams,
} from './base.js';

// Pairs strategy types
export {
  type PairsStrategy,
  type PairsStrategyContext,
} from './pairs-base.js';

// Strategy loader
export {
  loadStrategy,
  listStrategies,
  getStrategyDetails,
  getAllStrategyDetails,
  clearStrategyCache,
  strategyExists,
  type StrategyInfo,
} from './loader.js';
