/**
 * Multi-Asset Funding Rate Spike Aggregator Strategy
 *
 * This strategy orchestrates multiple independent funding-rate-spike backtests
 * across different assets and timeframes, then combines the results into a
 * single portfolio-level view.
 *
 * The actual backtesting is done via the API endpoint /api/backtest/multi/run,
 * not in the onBar method. This is a "meta-strategy" for UI purposes.
 *
 * Requires: futures mode, funding rate data cached for all assets
 */

import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// Asset presets
const PRESETS: Record<string, string> = {
  conservative: 'ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h',
  moderate: 'ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h,LINK/USDT:USDT@4h,AVAX/USDT:USDT@4h,LTC/USDT:USDT@4h',
};

const strategy: Strategy = {
  name: 'fr-spike-aggr',
  description: 'Multi-asset portfolio: runs funding-rate-spike independently across N assets with equal capital allocation, then combines results.',
  version: '1.0.0',

  // Mark as multi-asset (similar to isPairs for pairs strategies)
  isMultiAsset: true,

  params: [
    {
      name: 'preset',
      type: 'select',
      default: 'conservative',
      options: ['conservative', 'moderate', 'custom'],
      description: 'Asset preset or custom selection',
    },
    {
      name: 'assets',
      type: 'string',
      default: PRESETS.conservative,
      description: 'Comma-separated assets in SYMBOL@TIMEFRAME format (used when preset is custom)',
    },
  ] as StrategyParam[],

  /**
   * This is a meta-strategy that doesn't execute trades in onBar.
   * The actual execution is orchestrated by the API endpoint.
   */
  onBar(_context: StrategyContext): void {
    // No-op: actual backtesting is done via API endpoint
  },
};

// Export both the strategy and presets for use by API endpoint
export default strategy;
export { PRESETS };
