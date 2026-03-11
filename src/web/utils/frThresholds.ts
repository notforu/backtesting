/**
 * Utility functions for extracting funding rate thresholds from backtest config params.
 */

import type { BacktestResult } from '../types';

interface SubStrategy {
  symbol: string;
  params?: Record<string, unknown>;
}

/**
 * Extracts the short funding rate threshold for a given symbol from a backtest config.
 * Checks per-symbol subStrategy params first, then falls back to top-level params.
 */
export function getFrShortThreshold(
  result: BacktestResult,
  symbol?: string,
): number | undefined {
  const params = result?.config?.params;
  if (!params) return undefined;

  if (symbol) {
    const subs = (params as any)?.subStrategies as SubStrategy[] | undefined;
    const matchingSub = subs?.find((s) => s.symbol === symbol);
    const v = matchingSub?.params?.fundingThresholdShort ?? params?.fundingThresholdShort;
    return typeof v === 'number' ? v : undefined;
  }

  const v = (params as Record<string, unknown>)?.fundingThresholdShort;
  return typeof v === 'number' ? v : undefined;
}

/**
 * Extracts the long funding rate threshold for a given symbol from a backtest config.
 * Checks per-symbol subStrategy params first, then falls back to top-level params.
 */
export function getFrLongThreshold(
  result: BacktestResult,
  symbol?: string,
): number | undefined {
  const params = result?.config?.params;
  if (!params) return undefined;

  if (symbol) {
    const subs = (params as any)?.subStrategies as SubStrategy[] | undefined;
    const matchingSub = subs?.find((s) => s.symbol === symbol);
    const v = matchingSub?.params?.fundingThresholdLong ?? params?.fundingThresholdLong;
    return typeof v === 'number' ? v : undefined;
  }

  const v = (params as Record<string, unknown>)?.fundingThresholdLong;
  return typeof v === 'number' ? v : undefined;
}

/**
 * Converts a startDate or endDate config value (number or string) to a millisecond timestamp.
 */
export function configDateToTimestamp(value: number | string | null | undefined): number | undefined {
  if (value == null) return undefined;
  return typeof value === 'number' ? value : new Date(value).getTime();
}
