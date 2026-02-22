/**
 * Data module exports
 */

// Database
export {
  getPool,
  initDb,
  closeDb,
  saveCandles,
  getCandles,
  getCandleDateRange,
  deleteCandles,
  saveBacktestRun,
  getBacktestRun,
  getBacktestHistory,
  getBacktestSummaries,
  deleteBacktestRun,
  deleteAllBacktestRuns,
  getTrades,
  saveTrades,
  saveOptimizedParams,
  getOptimizedParams,
  getAllOptimizedParams,
  deleteOptimizedParams,
  type OptimizationResult,
  type BacktestSummary,
  type HistoryFilters,
  getBacktestGroups,
  type BacktestGroup,
  getFundingRates,
  getFundingRateDateRange,
  saveAggregationConfig,
  getAggregationConfig,
  getAggregationConfigs,
  updateAggregationConfig,
  deleteAggregationConfig,
  type AggregationConfig,
} from './db.js';

// Providers
export {
  getProvider,
  getSupportedExchanges,
  isExchangeSupported,
  type DataProvider,
  RateLimiter,
  BinanceProvider,
  type SupportedExchange,
} from './providers/index.js';
