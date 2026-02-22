# Fix Per-Asset Capital Base Calculation

**Date**: 2026-02-22 09:45
**Author**: dev-agent

## Summary
Fixed per-asset metrics (Total Return %, Max Drawdown %, Sharpe Ratio) in aggregate backtesting. These metrics were incorrectly calculated against an artificial equal split of capital instead of the full initial capital. A $461 return on a $10k portfolio was showing as +23% instead of +4.6%. Now uses full initial capital as the base for all per-asset percentage calculations.

## Changed
- Per-asset equity curves now use full initial capital as the base
- Per-asset Total Return % reflects actual portfolio impact
- Per-asset Max Drawdown % reflects actual portfolio impact
- Per-asset Sharpe Ratio calculated correctly against full capital

## Fixed
- Misleading percentage metrics in per-asset analytics
- Capital allocation visualization now accurately represents portfolio composition
- All 303 existing tests continue to pass

## Files Modified
- `src/core/aggregate-engine.ts` (line 403) - Changed `perAssetCapital` calculation from `initialCapital / adaptersWithData.length` to `initialCapital`

## Context
In multi-strategy aggregate backtesting, the system splits portfolio analysis by asset (sub-strategy). Previously, it calculated per-asset metrics using an artificial equal capital split (e.g., $2,000 each for 5 strategies on a $10k portfolio). This made percentage returns and drawdowns misleading at the portfolio level.

The fix ensures per-asset metrics use the full initial capital as the denominator, making percentages accurately reflect each asset's contribution to overall portfolio performance. Per-asset equity curves still show strategy-specific returns, but percentages now correctly contextualize them within the full portfolio.

Quality checks:
- TypeScript compilation: PASS
- All 303 existing tests: PASS
- No breaking changes to API or data structures
