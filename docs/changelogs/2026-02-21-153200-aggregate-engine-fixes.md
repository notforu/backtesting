# Aggregate Engine Bug Fixes

**Date**: 2026-02-21 15:32
**Author**: engineering-team

## Summary
Fixed critical bugs in the signal aggregation framework affecting parameter UI rendering and date handling in the backtest engine. All fixes are defensive and maintain backward compatibility. End-to-end validation confirms correct behavior across single and multi-asset configurations.

## Fixed

### 1. Missing Parameter Labels in Aggregate Strategies
**Problem**: UI was rendering blank labels for critical parameters in `fr-spike-aggr.ts` and `signal-aggr.ts` because the `label` field was missing from param definitions.

**Solution**: Added descriptive `label` fields to all params:
- `strategies/fr-spike-aggr.ts`: "Asset Preset", "Assets (symbol@timeframe)"
- `strategies/signal-aggr.ts`: "Allocation Mode", "Max Positions", "Asset Preset", "Assets (symbol@timeframe)"

**Impact**: UI now displays clear, user-friendly labels for all aggregation parameters.

### 2. String Date Handling in Aggregate Engine
**Problem**: `src/core/aggregate-engine.ts` was passing string dates directly to `getCandles()`, which expects numeric timestamps (milliseconds). This caused type mismatches and potential data fetching failures.

**Solution**: Added defensive type conversion:
```typescript
typeof config.startDate === 'string' ? new Date(config.startDate).getTime() : config.startDate
```
Applied to both `startDate` and `endDate` throughout the engine.

**Impact**: Engine now correctly handles dates from JSON configs and API calls, preventing silent failures.

## Verified

- **Multi-asset aggregation** (2-asset and 5-asset configs)
- **Allocation modes**: `single_strongest` and `top_n` both produce valid results
- **Per-asset breakdowns**: Individual asset metrics calculated correctly
- **Funding income tracking**: Cumulative and per-asset funding recorded accurately
- **Signal history**: Proper ordering and component signal attribution

## Files Modified

- `strategies/fr-spike-aggr.ts` - Added param labels for asset preset and assets list
- `strategies/signal-aggr.ts` - Added param labels for allocation mode, max positions, asset preset, and assets list
- `src/core/aggregate-engine.ts` - Added defensive string-to-number date conversion for `startDate` and `endDate`

## Context

The aggregation framework enables portfolio-level backtesting by combining signals from multiple independent strategies. Param labels are essential for UI usability, and robust date handling prevents runtime errors when configs flow through different code paths (CLI, API, JSON files). All fixes are non-breaking and improve type safety.
