# Optimizer Quality Improvements

**Date**: 2026-01-25 14:38
**Author**: orchestrator

## Summary
Enhanced the parameter optimization system with three critical improvements: a minimum trades filter to prevent statistically invalid results, multi-timeframe support for realistic strategy parameterization, and randomized sampling jitter to improve parameter space coverage. These changes ensure optimizer results are more statistically meaningful and reflect real trading scenarios across different timeframes.

## Changed
- **Minimum Trades Filter**: OptimizationConfig now enforces a `minTrades` parameter (default: 10) that filters out parameter combinations producing fewer trades. Prevents meaningless Sharpe ratios from single-trade backtest runs.
- **Timeframe Support**: Optimized parameters are now keyed by (strategy, symbol, timeframe) triple instead of just (strategy, symbol), allowing different timeframes to have different optimal parameters
- **Improved Sampling**: Grid search now applies randomized jitter to sampling points, preventing systematic gaps in parameter exploration when using maxCombinations limit

## Added
- `minTrades` field in OptimizationConfig (integer, default: 10)
- Timeframe column in database schema for storing timeframe with optimization results
- Randomized jitter function in grid search sampling algorithm
- Database migration for timeframe support

## Fixed
- Parameter combinations with unrealistic trade counts (1-2 trades) no longer appear in optimization results
- Parameter space coverage improved when using maxCombinations limit (no more systematic sampling gaps)
- Optimization results are now properly segregated by timeframe, preventing cross-timeframe parameter confusion

## Files Modified
- `/workspace/src/core/optimizer.ts` - Added minTrades filter logic, timeframe parameter tracking, and jitter-based sampling
- `/workspace/src/data/db.ts` - Added timeframe column to optimization results table, database migration, updated function signatures to accept/return timeframe
- `/workspace/src/api/routes/optimize.ts` - Updated REST endpoints to include timeframe in route path: `/api/optimize/:strategy/:symbol/:timeframe`
- `/workspace/src/web/types.ts` - Added timeframe field to OptimizationResult type definition
- `/workspace/src/web/api/client.ts` - Updated API client methods to pass timeframe parameter in requests
- `/workspace/src/web/hooks/useOptimization.ts` - Updated hook to manage and pass timeframe state through optimization flow
- `/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx` - Updated UI to display timeframe in result badges

## Context
Parameter optimization is critical for developing profitable trading strategies, but garbage-in produces garbage-out. A single successful trade can produce misleading metrics that don't reflect real trading performance. By enforcing a minimum trade count, users get results that are statistically valid and representative of actual strategy behavior.

Timeframe support addresses a fundamental reality: optimal parameters differ across timeframes. A 5-minute strategy needs different parameters than a daily strategy even on the same symbol. This allows backtesting to be more realistic and improves strategy validation for live trading.

The sampling jitter improvement fixes a subtle but important issue: when maxCombinations limits the grid search, systematic sampling (e.g., every 5th point) can miss optimal regions if they don't align with the sampling interval. Random jitter ensures better coverage with the same number of evaluations.

Together, these improvements make the optimizer produce results that are more trustworthy for live trading deployment.
