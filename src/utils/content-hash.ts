/**
 * Content hash utilities for deterministic SHA256 hashing of strategy
 * and aggregation configs. Used for deduplication in the database.
 */

import { createHash } from 'crypto';

/**
 * Compute content hash for a strategy config.
 * Keys are alphabetically ordered to produce deterministic output
 * regardless of the order in which properties are provided.
 *
 * Note: Migration-backfilled configs may have SQL-computed hashes that differ
 * from this function's output. That is intentional — the app always looks up
 * by its own computed hash, so dedup works correctly for all app-created configs.
 * Migration configs remain linked to their historical runs.
 */
export function computeStrategyConfigHash(config: {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
}): string {
  const canonical = JSON.stringify({
    params: sortKeysDeep(config.params ?? {}),
    strategy_name: config.strategyName,
    symbol: config.symbol,
    timeframe: config.timeframe,
  });

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute content hash for an aggregation config.
 * Strategy config IDs are sorted to ensure the hash is independent
 * of insertion order.
 */
export function computeAggregationConfigHash(config: {
  allocationMode: string;
  maxPositions: number;
  strategyConfigIds: string[];
}): string {
  const canonical = JSON.stringify({
    allocation_mode: config.allocationMode,
    max_positions: config.maxPositions,
    strategy_config_ids: [...config.strategyConfigIds].sort(),
  });

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Deep sort all object keys recursively for deterministic serialization.
 * Arrays are preserved as-is (element order is significant).
 * null/undefined values are normalised to an empty object at the top level;
 * nested nulls are kept as null.
 */
export function sortKeysDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) return {};
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}
