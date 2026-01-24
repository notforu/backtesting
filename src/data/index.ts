/**
 * Data module exports
 */

// Database
export {
  getDb,
  closeDb,
  saveCandles,
  getCandles,
  getCandleDateRange,
  deleteCandles,
  saveBacktestRun,
  getBacktestRun,
  getBacktestHistory,
  deleteBacktestRun,
  getTrades,
  saveTrades,
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
