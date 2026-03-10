/**
 * Shared constants for the backtesting engine.
 * Using named constants avoids magic numbers scattered across files
 * and makes it easy to update values in one place.
 */

// ============================================================================
// Fee Rates
// ============================================================================

/**
 * Conservative default taker fee rate (0.1%).
 * Used in the single-asset engine when no exchange fee can be fetched.
 * This is intentionally conservative to avoid over-estimating performance.
 */
export const DEFAULT_TAKER_FEE_RATE = 0.001;

/**
 * Bybit's actual taker fee rate (0.055%).
 * Used in the aggregate engine and paper trading engine which target Bybit.
 */
export const DEFAULT_BYBIT_TAKER_FEE_RATE = 0.00055;

// ============================================================================
// Slippage
// ============================================================================

/**
 * Default slippage percentage applied to futures trades (0.05%).
 * Applied at entry and exit to simulate market impact in futures mode.
 */
export const DEFAULT_FUTURES_SLIPPAGE_PERCENT = 0.05;

// ============================================================================
// Metrics
// ============================================================================

/**
 * Cap for Sortino ratio when there are no negative returns (prevents infinity).
 */
export const SORTINO_CAP = 10;

/**
 * Rolling window size (in bars) used when computing rolling Sharpe ratio.
 */
export const ROLLING_SHARPE_WINDOW = 50;

/**
 * Cap for profit factor when gross loss is zero (prevents infinity).
 */
export const PROFIT_FACTOR_CAP = 10;
