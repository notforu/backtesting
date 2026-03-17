# Fix: Aggregation Config PUT and Add regenerate-ids Endpoint

**Date**: 2026-03-15

## Problem

When aggregation configs were updated via PUT with a new `subStrategies` list, the
`subStrategyConfigIds` array was not regenerated. This left the stored IDs stale
(e.g., fewer entries than `subStrategies`), causing the frontend to omit "View Config"
buttons for sub-strategies without a matching config reference.

Similarly, existing configs that became stale after strategy configs were deleted or
recreated had no way to repair their `subStrategyConfigIds` without deleting and
recreating the entire aggregation config.

## Changes

### `src/api/routes/aggregations.ts`

**PUT handler fix**: When `subStrategies` is included in the update payload, the
handler now:
1. Loads the existing aggregation config to get the current `allocationMode` and
   `maxPositions` (used as fallbacks when those fields are not in the update payload).
2. Calls `findOrCreateStrategyConfig()` for each sub-strategy — same logic as the
   POST handler.
3. Computes a new `contentHash` from the regenerated IDs.
4. Passes `subStrategyConfigIds` and `contentHash` to `updateAggregationConfig()`.

Returns 404 early if the config does not exist when loading for fallback values.
Returns 400 for empty-params errors from `findOrCreateStrategyConfig()`.

**New endpoint**: `POST /api/aggregations/:id/regenerate-ids`
- Loads the aggregation config by ID (404 if not found).
- Calls `findOrCreateStrategyConfig()` for every sub-strategy in the stored config.
- Updates the config with the fresh `subStrategyConfigIds` and `contentHash`.
- Returns the updated config.
- Designed to repair existing broken/stale configs without recreation.

### `src/api/routes/__tests__/aggregations.test.ts`

Added 10 new tests covering:

**PUT sub-tests:**
- Regenerates IDs and hash when `subStrategies` is updated
- Uses existing `allocationMode`/`maxPositions` for hash when not in update payload
- Returns 404 early when the config does not exist (subStrategies path)
- Returns 400 on empty-params error from `findOrCreateStrategyConfig`
- Does NOT call `findOrCreateStrategyConfig` when `subStrategies` is absent from payload

**regenerate-ids sub-tests:**
- Regenerates IDs for all sub-strategies and returns updated config
- Returns 404 when aggregation config not found
- Computes correct hash using existing `allocationMode`/`maxPositions`
- Returns 400 on empty-params error
- Returns 500 on generic DB error

All 26 tests pass. TypeScript compiles without errors.
