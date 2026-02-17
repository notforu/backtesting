# PM Backtest Scan Script

**Date:** 2026-02-17 09:17:44
**Type:** New Feature

## Summary

Added `/workspace/scripts/pm-backtest-scan.ts` - a comprehensive CLI script that
runs the Phase 2 of the PM pipeline: backtesting all cached Polymarket markets,
discovering correlated pairs, running walk-forward validation, and producing
a ranked report.

## What was added

### `/workspace/scripts/pm-backtest-scan.ts`

A 5-step pipeline script:

**Step 1: Load manifest and cached markets**
- Reads `/workspace/results/pm-pipeline/manifest.json` (optional - falls back to DB discovery)
- Queries SQLite for all polymarket 1h candles grouped by symbol
- Filters to markets with >= 500 real candles (non-forward-filled)
- Logs count of ready markets

**Step 2: Single-asset backtests**
- Runs `pm-mean-reversion` and `pm-information-edge` on every cached market
- Uses `runBacktest()` from `src/core/engine.ts` directly
- Captures: totalReturn, sharpe, maxDD, winRate, profitFactor, trade count
- Computes `adjustedSharpe = sharpe * min(1.0, trades / 10)` to penalize low-trade-count results
- Classifies each result into: `high_confidence`, `promising`, `low_confidence`, `no_trades`
- Uses `skipFeeFetch: true` and `saveResults: false` for speed

**Step 3: Pairs discovery**
- Loads close prices (real candles only, volume > 0) for all markets
- Computes pairwise Pearson correlations for all market pairs
- Requires >= 500 overlapping bars and correlation >= 0.85
- Runs `pm-correlation-pairs` via `runPairsBacktest()` on qualifying pairs

**Step 4: Walk-forward validation**
- Selects top 20 markets by adjustedSharpe from single-asset results
- Splits data 70%/30% by timestamp
- Runs backtest on train period (in-sample) and test period (out-of-sample)
- Computes degradation: `(oosReturn - isReturn) / abs(isReturn)`
- Pass criteria: OOS Sharpe > 0.3, OOS trades >= 5, OOS return > 0, degradation < 60%

**Step 5: Generate report**
- Saves structured JSON to `/workspace/results/pm-pipeline/report.json`
- Prints formatted console report with sections:
  - HIGH CONFIDENCE (10+ trades, adj. Sharpe > 1.0)
  - PROMISING (5-9 trades, adj. Sharpe > 0.5)
  - PAIRS DISCOVERED (correlation > 0.85)
  - WALK-FORWARD RESULTS (70/30 split)
  - SUMMARY per strategy

## Usage

```bash
npx tsx scripts/pm-backtest-scan.ts
```

## Notes

- Works even with 0 cached markets (prints helpful message and exits)
- Handles missing manifest gracefully (discovers markets from DB directly)
- Sequential execution (not parallelized) for simplicity and stability
- All backtests use 1% slippage, 2% fee rate, no DB save, no fee API calls
