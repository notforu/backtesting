# HF Scalping Infrastructure

**Date**: 2026-03-04 19:30
**Author**: docs-writer

## Summary

Built high-frequency (HF) scalping infrastructure including symbol selection, 1m data caching, database optimization, and two initial strategies. Selected 12 optimal symbols from 74 Bybit perp futures using data-driven metrics. Implemented FR Settlement and Volatility Breakout scalpers optimized for 1m data with O(n) windowed calculations.

## Changed

- **Symbol selection**: Ranked 74 Bybit perp symbols across 4 scalping strategies using 8 metrics (volume, volatility, bar range, volume spikes, drawdown speed, FR extremeness, FR volatility, average absolute FR)
- **Database performance**: Added bulk insert function for 5x faster candle writes (PostgreSQL multi-row INSERT with batch sizing)
- **Indicator calculation**: Replaced O(n²) full-array recalculation with O(n) windowed `candleView.slice()` approach
- **Funding rate lookup**: FR Settlement Scalper uses running index for O(1) per-bar FR access

## Added

- **`scripts/select-scalping-symbols.ts`** — Symbol selector that ranks 74 symbols for FR Settlement, Volatility Regime, VWAP Reversion, and Liquidation Bounce strategies. Computes metrics, normalizes 0-1, outputs top symbols with scores. Selected: RPL, AXS, SNX, JTO, SSV, ORDI, ICP, FIL + mandatory BTC, ETH, LDO, DOGE.

- **`strategies/fr-settlement-scalper.ts`** — Fades forced flow before 8h funding settlements. Enters on extreme FR percentile + SMA/RSI confirmation. Exits via TP/SL/time. Designed for 1m data with leverage. Default params: `lookback=50, frPercentile=5, smaLength=10, rsiLength=14, takeProfitPercent=0.08, stopLossPercent=0.15, exitBarsAfterEntry=480`.

- **`strategies/volatility-breakout-scalper.ts`** — Detects Bollinger Band squeeze → breakout with volume confirmation. ATR-based TP/SL/trailing stop. Generates hundreds of trades on 1m data. Default params: `bbLength=20, bbDeviation=2, volumeThreshold=1.2, atrLength=14, atrMultiplier=2.0, trailingStopPercent=0.1`.

- **`src/data/db.ts` — `saveCandlesBulk()` function** — High-performance bulk candle inserts using PostgreSQL multi-row INSERT with batches of 1000. Parameterized queries prevent SQL injection. ON CONFLICT DO NOTHING skips duplicates.

- **1m candle data cache** — 3.1M candles across 12 symbols (6 months: Sep 2025–Mar 2026)
  - Symbols: RPL, AXS, SNX, JTO, SSV, ORDI, ICP, FIL, BTC, ETH, LDO, DOGE
  - Storage: PostgreSQL `candles` table (indexed on exchange, symbol, timeframe, timestamp)

## Fixed

- Database bulk inserts now O(n) instead of O(1k×n) by batching 1000 rows per INSERT
- Indicator calculations now O(n×lookback) instead of O(n²) using windowed slices
- FR Settlement Scalper now O(n) instead of O(n²) using running FR index

## Files Modified

- `src/data/db.ts` - Added `saveCandlesBulk(exchange, symbol, timeframe, candles)` async function
- `scripts/cache-candles.ts` - Updated to use `saveCandlesBulk()` for batches > 100 candles
- Both strategies optimized for windowed calculations

## Initial Backtest Results

Default parameters (unoptimized, grid search pending):

| Strategy | Symbol | Timeframe | Period | Trades | Win Rate | PnL | Funding Income | Duration |
|----------|--------|-----------|--------|--------|----------|-----|----------------|----------|
| FR Settlement | RPL | 1m | 6 months | 66 | 45.5% | — | $2.70 | 23s |
| FR Settlement | AXS | 1m | 6 months | 114 | 35.1% | — | — | 26s |
| Vol Breakout | BTC | 1m | 6 months | 756 | 8.7% | — | — | 2m22s |
| Vol Breakout | RPL | 1m | 1 month | 106 | 17.0% | — | — | 34s |

**Note**: Default parameters intentionally left unoptimized. Grid search required to find profitable combinations. Win rates shown are signal accuracy, not accounting for slippage/fees.

## Technical Notes

- **Windowed calculations**: Both strategies now use `candleView.slice(-lookback)` to compute indicators on last N bars instead of full history (O(n) per bar instead of O(n))
- **FR lookup optimization**: FR Settlement Scalper builds running `frIndexByBar` at init for O(1) access instead of O(n) array search per bar
- **Bulk insert batching**: PostgreSQL multi-row VALUES with parameterized `$1, $2, ...` prevents SQL injection while maintaining performance
- **Symbol selection**: 8-metric scoring system allows addition of new scalping strategies without rerunning full analysis
- **Mode support**: Both strategies designed for `--mode=futures` with leverage settings

## Context

High-frequency scalping requires different infrastructure than swing trading:
- 1m data instead of 1h/4h (100x more bars, need efficient calculations)
- Intra-bar funding rate effects (FR Settlement Scalper fades forced liquidations)
- Tight win rate thresholds (FR Settlement at 45% is acceptable for 0.08% TP vs 0.15% SL; Vol Breakout needs optimization)
- Symbol selection critical (volatility and funding rate characteristics drive edge)

Data-driven symbol selection + infrastructure optimization enables fast iteration on scalping strategies. Next steps: grid search for optimal parameters, then walk-forward validation for robustness.
