/**
 * Intra-bar SL/TP resolution module.
 *
 * Pure logic for determining whether a candle triggers a stop-loss or
 * take-profit, and for resolving chronological order when both trigger
 * on the same bar using sub-candle data.
 */

import type { Candle, Timeframe } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface IntraBarExitResult {
  /** Whether the exit was caused by a stop-loss or take-profit */
  exitType: 'stop_loss' | 'take_profit';
  /** The exact SL or TP price level (not the sub-candle price) */
  exitPrice: number;
  /** Sub-candle timestamp where exit occurred (or main candle timestamp if no sub-candles) */
  exitTimestamp: number;
}

export interface SlTpTriggerResult {
  slTriggered: boolean;
  tpTriggered: boolean;
}

// ============================================================================
// checkSlTpTrigger
// ============================================================================

/**
 * Check if a candle triggers SL and/or TP for a position.
 *
 * Long positions:
 *   - SL triggered if candle.low <= stopLoss
 *   - TP triggered if candle.high >= takeProfit
 *
 * Short positions:
 *   - SL triggered if candle.high >= stopLoss
 *   - TP triggered if candle.low <= takeProfit
 *
 * Returns { slTriggered: false, tpTriggered: false } if both are null.
 */
export function checkSlTpTrigger(
  candle: Candle,
  side: 'long' | 'short',
  stopLoss: number | null,
  takeProfit: number | null,
): SlTpTriggerResult {
  let slTriggered = false;
  let tpTriggered = false;

  if (side === 'long') {
    if (stopLoss !== null && candle.low <= stopLoss) {
      slTriggered = true;
    }
    if (takeProfit !== null && candle.high >= takeProfit) {
      tpTriggered = true;
    }
  } else {
    // short
    if (stopLoss !== null && candle.high >= stopLoss) {
      slTriggered = true;
    }
    if (takeProfit !== null && candle.low <= takeProfit) {
      tpTriggered = true;
    }
  }

  return { slTriggered, tpTriggered };
}

// ============================================================================
// resolveAmbiguousExit
// ============================================================================

/**
 * Resolve which exit happened first when BOTH SL and TP triggered on the same bar.
 *
 * Iterates sub-candles chronologically. For each sub-candle:
 *   - If ONLY SL triggered: return stop_loss
 *   - If ONLY TP triggered: return take_profit
 *   - If BOTH triggered (same sub-candle): pessimistic fill (stop_loss)
 *
 * If no sub-candles available OR none trigger either level: pessimistic fallback (stop_loss).
 *
 * Fill price is always the exact SL or TP level (not the sub-candle price).
 * This is realistic because stop/limit orders fill at the specified level.
 */
export function resolveAmbiguousExit(
  subCandles: Candle[],
  side: 'long' | 'short',
  stopLoss: number,
  takeProfit: number,
): IntraBarExitResult {
  for (const sub of subCandles) {
    const { slTriggered, tpTriggered } = checkSlTpTrigger(sub, side, stopLoss, takeProfit);

    if (slTriggered && tpTriggered) {
      // Both triggered on same sub-candle: pessimistic fill (SL wins)
      return {
        exitType: 'stop_loss',
        exitPrice: stopLoss,
        exitTimestamp: sub.timestamp,
      };
    }

    if (slTriggered) {
      return {
        exitType: 'stop_loss',
        exitPrice: stopLoss,
        exitTimestamp: sub.timestamp,
      };
    }

    if (tpTriggered) {
      return {
        exitType: 'take_profit',
        exitPrice: takeProfit,
        exitTimestamp: sub.timestamp,
      };
    }
  }

  // No sub-candles available or none triggered: pessimistic fallback (SL wins)
  const fallbackTimestamp = subCandles.length > 0
    ? subCandles[0].timestamp
    : 0;

  return {
    exitType: 'stop_loss',
    exitPrice: stopLoss,
    exitTimestamp: fallbackTimestamp,
  };
}

// ============================================================================
// getSubTimeframe
// ============================================================================

/**
 * Determine the appropriate sub-timeframe for intra-bar SL/TP resolution.
 *
 * Mapping:
 *   1m  → 1m  (already smallest)
 *   5m  → 1m
 *   15m → 1m
 *   30m → 1m
 *   1h  → 1m
 *   4h  → 5m
 *   1d  → 15m
 *   1w  → 1h
 */
export function getSubTimeframe(mainTimeframe: Timeframe): Timeframe {
  const map: Record<Timeframe, Timeframe> = {
    '1m': '1m',
    '5m': '1m',
    '15m': '1m',
    '30m': '1m',
    '1h': '1m',
    '4h': '5m',
    '1d': '15m',
    '1w': '1h',
  };
  return map[mainTimeframe];
}
