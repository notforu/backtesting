# Fix: Aggregation Config subStrategyConfigIds Population

**Date**: 2026-03-14
**Type**: Bug Fix

## Summary

Fixed the aggregation config creation flow so that `subStrategyConfigIds` is properly populated instead of being hardcoded to `[]`. Sub-strategies can now be navigated to in the UI.

## Changes

### `src/api/routes/aggregations.ts`
- POST `/api/aggregations` handler now calls `findOrCreateStrategyConfig()` for each sub-strategy
- Collects the returned strategy config IDs and populates `subStrategyConfigIds` on the new aggregation config
- Computes `contentHash` using `computeAggregationConfigHash()` before saving

### `src/data/db.ts`
- `AggregationConfig` interface: added optional `contentHash` field
- `AggregationConfigRow` interface: added `content_hash` field
- `rowToAggregationConfig()`: maps `content_hash` column to `contentHash`
- `saveAggregationConfig()`: now persists `sub_strategy_config_ids` and `content_hash` columns (previously silently dropped them)
- `updateAggregationConfig()`: added `subStrategyConfigIds` and `contentHash` to the supported update fields
- All SELECT queries on `aggregation_configs` now include `content_hash`

### `scripts/backfill-strategy-config-ids.ts` (new)
- Standalone backfill script for production
- Finds all `aggregation_configs` where `sub_strategy_config_ids` is NULL or empty
- For each, calls `findOrCreateStrategyConfig()` for every sub-strategy in `sub_strategies`
- Updates `sub_strategy_config_ids` and `content_hash` on the aggregation config
- Safe to re-run (idempotent — skips configs that already have IDs)

### `src/api/routes/__tests__/aggregations.test.ts` (new)
- 15 unit tests covering the full aggregation route CRUD
- Key tests: verifies `findOrCreateStrategyConfig` is called per sub-strategy, IDs are saved, `contentHash` is computed correctly, empty params default to `{}`, error cases return correct HTTP status codes

## Root Cause

`saveAggregationConfig()` SQL INSERT did not include `sub_strategy_config_ids` or `content_hash` columns, so they were never persisted. The POST handler also hardcoded `subStrategyConfigIds: []` without calling `findOrCreateStrategyConfig`.
