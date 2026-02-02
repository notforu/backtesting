# Grid Search Improvements

**Date**: 2026-02-02 15:00
**Author**: docs-writer

## Summary
Comprehensive overhaul of the optimization (Grid Search) system addressing critical data loss bug, UI improvements, and user experience enhancements. Fixed history being overridden on each run, added real-time progress tracking via Server-Sent Events, implemented parameter range configuration UI, and renamed terminology from "Optimizer" to "Grid Search" throughout the interface.

## Changed
- **Fixed critical bug** where each optimization run replaced the previous one - database constraint was preventing multiple runs from being stored
- Renamed all user-facing references from "Optimizer" to "Grid Search" for clarity
- Refactored optimization history storage and retrieval
- Updated API endpoints to support run history and individual result deletion

## Added
- Real-time progress tracking using Server-Sent Events (SSE) streaming
- Parameter range configuration UI with min/max/step inputs for numeric parameters
- Boolean parameter testing options in grid search configuration
- Combination counter with warnings for excessive test counts
- `/latest` API endpoint to retrieve most recent optimization result
- Delete-by-ID endpoint for removing specific optimization runs
- `minTrades` filter for optimization result filtering
- Extended `optimizeFor` metric options: `sortinoRatio`, `maxDrawdownPercent`, `composite`
- Migration system to handle existing databases with old constraint structure

## Fixed
- **Critical**: History override bug - removed `UNIQUE(strategy_name, symbol, timeframe)` constraint that caused `INSERT OR REPLACE` to delete previous runs
- Progress indicator now shows real-time testing status during grid search
- Parameter configuration UI now properly reflects all available metric options

## Files Modified

- `/workspace/src/data/db.ts` - Removed UNIQUE constraint from optimized_params table, added migration, updated schema
- `/workspace/src/api/routes/optimize.ts` - Changed INSERT to plain INSERT, added SSE progress streaming, added /latest endpoint, added delete by ID endpoint
- `/workspace/src/web/api/client.ts` - Updated API calls to handle arrays of results, added SSE progress tracking
- `/workspace/src/web/hooks/useOptimization.ts` - Refactored to work with history array, added progress state management
- `/workspace/src/web/components/OptimizerModal/OptimizerModal.tsx` - Renamed UI labels, added parameter range inputs, added real-time progress display, added metric options
- `/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx` - Updated button text from "Run Optimization" to "Run Grid Search"
- `/workspace/src/web/types.ts` - Extended metric options in types, added range configuration types

## Context

### Why These Changes Were Made

1. **Data Loss Bug (Critical)**: Users were losing historical optimization runs because the database constraint forced replacement instead of creation of new records. This completely undermined the feature's usefulness for comparing runs.

2. **Terminology Clarity**: "Optimizer" was vague; "Grid Search" is a precise description of the algorithm being used, making the feature more discoverable and understandable.

3. **User Experience**: Without progress feedback, users had no idea if their grid search was working or how long it would take. Real-time SSE progress solves this.

4. **Configuration Flexibility**: Previously users couldn't control parameter ranges or steps, limiting the algorithm's usefulness. Full configuration UI makes it a professional optimization tool.

5. **Extended Metrics**: Sortino ratio and max drawdown are important risk-adjusted metrics; composite scoring allows custom weighting strategies.

### Migration Notes

Database migration is automatic on first run. Existing databases with old constraint structure will be handled gracefully. No manual intervention required.

### Testing Recommendations

- Verify multiple optimization runs are stored and retrievable
- Test SSE progress stream with various combination counts
- Validate parameter range inputs prevent invalid configurations
- Test /latest endpoint returns most recent result
- Verify delete-by-ID properly removes historical runs
- Confirm new metric options work with existing strategies
