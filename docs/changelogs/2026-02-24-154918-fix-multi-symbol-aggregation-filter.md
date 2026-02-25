# Fix: Aggregation Runs Leaking into Strategy History

**Date:** 2026-02-24
**File:** `src/data/db.ts`

## Problem

67 aggregation backtest runs (multi-asset portfolio backtests) were appearing in the strategy history tab because they were saved with `aggregation_id = NULL`. Scripts like `scripts/explore-fr-aggregations.ts` call `saveBacktestRun(result)` without passing an aggregation ID, so the existing filter `aggregation_id IS NULL` treated these as regular strategy runs.

All such orphaned runs have `config->>'symbol' = 'MULTI'`, which uniquely identifies them as multi-asset aggregation runs.

## Fix

Updated the `runType` filter logic in two functions in `src/data/db.ts`:

### `getBacktestSummaries()` (line 513)
```sql
-- Before
strategies:    br.aggregation_id IS NULL
aggregations:  br.aggregation_id IS NOT NULL

-- After
strategies:    br.aggregation_id IS NULL AND br.config->>'symbol' != 'MULTI'
aggregations:  (br.aggregation_id IS NOT NULL OR br.config->>'symbol' = 'MULTI')
```

### `getBacktestGroups()` (line 649)
```sql
-- Before
strategies:    aggregation_id IS NULL
aggregations:  aggregation_id IS NOT NULL

-- After
strategies:    aggregation_id IS NULL AND config->>'symbol' != 'MULTI'
aggregations:  (aggregation_id IS NOT NULL OR config->>'symbol' = 'MULTI')
```

## Result

- MULTI symbol runs are always classified as aggregations, regardless of whether `aggregation_id` is set.
- No database migration needed — purely a query-level fix.
- TypeScript typecheck passes with no errors.
