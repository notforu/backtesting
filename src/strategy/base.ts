/**
 * Base strategy interface and types
 * All trading strategies must implement this interface
 */

import type { Candle, Position, Order } from '../core/types.js';

// ============================================================================
// Memory-Efficient Candle View
// ============================================================================

/** Memory-efficient view into candle data without copying arrays */
export interface CandleView {
  /** Number of candles visible in this view */
  readonly length: number;
  /** Get candle at index (0 = oldest, length-1 = current) */
  at(index: number): Candle | undefined;
  /** Get a slice of candles (allocates new array - use sparingly) */
  slice(start?: number, end?: number): Candle[];
  /** Get all close prices up to current bar */
  closes(): number[];
  /** Get all volumes up to current bar */
  volumes(): number[];
  /** Get all high prices up to current bar */
  highs(): number[];
  /** Get all low prices up to current bar */
  lows(): number[];
}

// ============================================================================
// Strategy Parameter Schema
// ============================================================================

/**
 * Parameter type for strategy configuration
 */
export type StrategyParamType = 'number' | 'string' | 'boolean' | 'select';

/**
 * Strategy parameter definition for UI generation
 */
export interface StrategyParam {
  /**
   * Parameter name (used as key in params object)
   */
  name: string;

  /**
   * Display label for the parameter
   */
  label?: string;

  /**
   * Parameter type
   */
  type: StrategyParamType;

  /**
   * Default value
   */
  default: unknown;

  /**
   * Minimum value (for number type)
   */
  min?: number;

  /**
   * Maximum value (for number type)
   */
  max?: number;

  /**
   * Step increment (for number type)
   */
  step?: number;

  /**
   * Available options (for select type)
   */
  options?: string[];

  /**
   * Human-readable description
   */
  description: string;
}

// ============================================================================
// Portfolio State
// ============================================================================

/**
 * Read-only portfolio state exposed to strategies
 */
export interface PortfolioState {
  /**
   * Available cash balance
   */
  cash: number;

  /**
   * Alias for cash (balance)
   */
  balance: number;

  /**
   * Total equity (cash + position value)
   */
  equity: number;

  /**
   * Current long position, or null if none
   */
  longPosition: Position | null;

  /**
   * Current short position, or null if none
   */
  shortPosition: Position | null;

  /**
   * @deprecated Use longPosition instead. Legacy position for backwards compatibility.
   */
  position?: Position | null;
}

// ============================================================================
// Strategy Context
// ============================================================================

/**
 * Log entry for strategy debugging
 */
export interface LogEntry {
  timestamp: number;
  message: string;
}

/**
 * Context provided to strategy on each bar
 */
export interface StrategyContext {
  // ===== Market Data =====
  /**
   * All candles up to and including current bar
   */
  candles: Candle[];

  /**
   * Memory-efficient view into candle data (use this for performance)
   */
  candleView: CandleView;

  /**
   * Index of the current candle in the candles array
   */
  currentIndex: number;

  /**
   * Current candle (convenience accessor)
   */
  currentCandle: Candle;

  /**
   * Strategy parameters (user-configured values)
   */
  params: Record<string, unknown>;

  // ===== Portfolio State (read-only) =====
  /**
   * Current portfolio state
   */
  portfolio: PortfolioState;

  /**
   * Convenience accessor for cash balance
   */
  balance: number;

  /**
   * Convenience accessor for total equity
   */
  equity: number;

  /**
   * Current long position, or null if none
   */
  longPosition: Position | null;

  /**
   * Current short position, or null if none
   */
  shortPosition: Position | null;

  // ===== Trading Actions =====
  /**
   * Open a long position (buy to open)
   * @param amount - Amount to buy (in base currency)
   */
  openLong(amount: number): void;

  /**
   * Close long position (sell to close)
   * @param amount - Amount to close, or undefined to close all
   */
  closeLong(amount?: number): void;

  /**
   * Open a short position (sell to open)
   * @param amount - Amount to short (in base currency)
   */
  openShort(amount: number): void;

  /**
   * Close short position (buy to close)
   * @param amount - Amount to close, or undefined to close all
   */
  closeShort(amount?: number): void;

  // ===== Legacy Actions (deprecated) =====
  /**
   * @deprecated Use openLong instead
   */
  buy(amount: number): void;

  /**
   * @deprecated Use closeLong instead
   */
  sell(amount: number): void;

  // ===== Utilities =====
  /**
   * Log a message for debugging
   * @param message - Message to log
   */
  log(message: string): void;
}

// ============================================================================
// Strategy Interface
// ============================================================================

/**
 * Base interface for all trading strategies
 */
export interface Strategy {
  /**
   * Unique strategy name (used for identification)
   */
  name: string;

  /**
   * Human-readable description
   */
  description: string;

  /**
   * Strategy version (semver recommended)
   */
  version: string;

  /**
   * Parameter definitions for UI generation and validation
   */
  params: StrategyParam[];

  /**
   * Called once at the start of the backtest
   * Use for initialization (e.g., calculating indicators)
   * @param context - Strategy context
   */
  init?(context: StrategyContext): void;

  /**
   * Called for each candle in the backtest
   * This is where trading logic should be implemented
   * @param context - Strategy context
   */
  onBar(context: StrategyContext): void;

  /**
   * Called when an order is filled
   * Use for position tracking or adjustments
   * @param context - Strategy context
   * @param order - The filled order
   */
  onOrderFilled?(context: StrategyContext, order: Order): void;

  /**
   * Called once at the end of the backtest
   * Use for cleanup or final calculations
   * @param context - Strategy context
   */
  onEnd?(context: StrategyContext): void;
}

// ============================================================================
// Strategy Validation
// ============================================================================

/**
 * Validate strategy parameters against their schema
 * @param strategy - Strategy to validate
 * @param params - User-provided parameters
 * @returns Validated parameters with defaults applied
 * @throws Error if validation fails
 */
export function validateStrategyParams(
  strategy: Strategy,
  params: Record<string, unknown>
): Record<string, unknown> {
  const validated: Record<string, unknown> = {};

  for (const paramDef of strategy.params) {
    const value = params[paramDef.name] ?? paramDef.default;

    // Type validation
    switch (paramDef.type) {
      case 'number': {
        if (typeof value !== 'number' || isNaN(value)) {
          throw new Error(
            `Parameter "${paramDef.name}" must be a number, got ${typeof value}`
          );
        }
        if (paramDef.min !== undefined && value < paramDef.min) {
          throw new Error(
            `Parameter "${paramDef.name}" must be >= ${paramDef.min}, got ${value}`
          );
        }
        if (paramDef.max !== undefined && value > paramDef.max) {
          throw new Error(
            `Parameter "${paramDef.name}" must be <= ${paramDef.max}, got ${value}`
          );
        }
        break;
      }
      case 'string': {
        if (typeof value !== 'string') {
          throw new Error(
            `Parameter "${paramDef.name}" must be a string, got ${typeof value}`
          );
        }
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          throw new Error(
            `Parameter "${paramDef.name}" must be a boolean, got ${typeof value}`
          );
        }
        break;
      }
      case 'select': {
        if (!paramDef.options?.includes(value as string)) {
          throw new Error(
            `Parameter "${paramDef.name}" must be one of [${paramDef.options?.join(', ')}], got "${value}"`
          );
        }
        break;
      }
    }

    validated[paramDef.name] = value;
  }

  return validated;
}

/**
 * Get default parameter values for a strategy
 */
export function getDefaultParams(strategy: Strategy): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const param of strategy.params) {
    defaults[param.name] = param.default;
  }
  return defaults;
}
