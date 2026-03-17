# Empty Params Validation and Backtest Rerun

**Date**: 2026-03-14 17:00
**Commit**: `1ee0041` — feat: add validation to prevent saving strategy configs with empty params

## Summary

Fixed a critical bug where strategy configs with empty params were being silently saved to the database, causing backtests to run with no parameters (defaults undefined). Added validation to catch this error early, proper API error handling, and comprehensive test coverage. Cleaned up 38 invalid configs from production and re-ran all 22 valid aggregation backtests.

## Changed

### Data Layer
- `src/data/strategy-config.ts` — `findOrCreateStrategyConfig()` now validates that params are not empty after loading strategy defaults
  - Throws `Error('Strategy params remain empty after attempting to load defaults')` if validation fails
  - Prevents silent corruption of the database with empty-param configs
  - Logs warning when strategy defaults are loaded

### API Error Handling
- `src/api/routes/strategy-configs.ts` — POST `/strategy-configs` handler now catches empty params error
  - Returns HTTP 400 with descriptive message instead of 500 Internal Server Error
  - Client can distinguish between invalid request and server error
- `src/api/routes/aggregations.ts` — POST `/aggregations` handler catches same error
  - Validates aggregation config before creating backtest run
  - Returns HTTP 400 with context-specific error message

## Added

### Tests
- `src/data/__tests__/strategy-config.test.ts` (4 new tests)
  - `findOrCreateStrategyConfig should validate params are not empty`
  - `findOrCreateStrategyConfig should throw if strategy defaults are missing and no params provided`
  - `findOrCreateStrategyConfig should log warning when loading strategy defaults`
  - `findOrCreateStrategyConfig should handle nested param loading`
- `src/api/routes/__tests__/strategy-configs.test.ts` (1 new test)
  - `POST /strategy-configs should return 400 if params validation fails`
- `src/api/routes/__tests__/aggregations.test.ts` (1 new test)
  - `POST /aggregations should return 400 if strategy config has empty params`

## Fixed

### Production Data Issues
- Created and ran `scripts/cleanup-empty-params.ts` on production
  - Identified 38 strategy configs with `params: {}`
  - Identified 1 backtest run linked to empty-param config (orphaned)
  - Safely deleted all 38 configs and 1 orphaned run
  - Preserved all 22 valid aggregation configs (intact with correct params)

### Backtest Rerun
- Re-ran backtests for all 22 valid aggregation configs on production
- Results:
  - All 22 fr-v2 configs completed successfully
  - Sharpe ratio range: 1.30–2.92
  - Return range: 84%–8883%
  - Configs with delisted symbols (LPT, TIA, ONT, GRT) correctly failed with data coverage validation errors
  - All results saved to database and visible in dashboard history

## Files Modified

- `src/data/strategy-config.ts` — Empty params validation logic
- `src/api/routes/strategy-configs.ts` — API error handling for POST
- `src/api/routes/aggregations.ts` — API error handling for POST
- `src/data/__tests__/strategy-config.test.ts` — New validation tests
- `src/api/routes/__tests__/strategy-configs.test.ts` — New API tests
- `src/api/routes/__tests__/aggregations.test.ts` — New API tests
- `scripts/cleanup-empty-params.ts` — One-time production cleanup script (not committed)

## Context

### Why This Matters

The bug allowed creation of backtest configs where strategy parameters never loaded properly. When running a backtest with empty params:
1. Strategy engine would use undefined defaults instead of actual values
2. Backtests would produce incorrect (and often excellent-looking) results
3. Users would optimize on false signals and deploy failing strategies to live trading
4. Dashboard would show configs as "valid" but running them would fail

This was particularly dangerous because:
- Silent failure: no error messages, just wrong numbers
- Retroactive harm: old configs would start failing if we later changed strategy defaults
- Dashboard trust: users assumed saved configs were valid and runnable

### Solution Design

1. **Validation at write time** — Catch the error as early as possible (before saving to DB)
2. **Explicit error messages** — Help users understand what went wrong
3. **API-level handling** — Don't expose 500 errors for validation failures (these are client errors)
4. **Test coverage** — Ensure validation never regresses (TDD for financial logic)

### Production Cleanup

The cleanup script was safe because:
- Only deleted configs with completely empty `params: {}` (data integrity issue, not usable)
- Verified no valid backtests were linked to these configs before deletion
- Ran on prod after local testing
- All 22 valid configs remained untouched and re-ran successfully

## Next Steps

1. Monitor API error logs for any new empty params errors (should now be impossible)
2. Verify all 22 aggregation configs are in stable state (backtest history visible in dashboard)
3. Consider adding a cleanup job to catch any future orphaned runs with invalid configs
