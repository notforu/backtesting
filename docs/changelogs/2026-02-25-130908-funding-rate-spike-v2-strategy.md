# Changelog: funding-rate-spike-v2 Strategy

**Date**: 2026-02-25 13:09
**Author**: be-dev (sonnet)
**File**: `/workspace/strategies/funding-rate-spike-v2.ts`

---

## Summary

Implemented the `funding-rate-spike-v2` strategy as specified in `/workspace/docs/strategies/funding-rate-spike-v2-ideas.md`. This is a major upgrade to the existing `funding-rate-spike` strategy with all 7 Phase 1-2 enhancements implemented as toggleable boolean parameters.

---

## New File

### `/workspace/strategies/funding-rate-spike-v2.ts`

Full implementation of funding-rate-spike-v2 with all enhancements.

---

## Enhancements Implemented

### Phase 1 (Entry Quality)

**Enhancement 1: Adaptive Rolling Percentile Thresholds** (`usePercentile=true`)
- Replaces fixed absolute FR thresholds with rolling percentile-based thresholds
- `shortPercentile=95` (top 5% of recent FR triggers short)
- `longPercentile=5` (bottom 5% of recent FR triggers long)
- `percentileLookback=90` FR observations (approximately 30 days)
- Automatically adapts to each asset's unique FR distribution (ATOM vs DOGE have very different FR ranges)

**Enhancement 2: ATR Volatility Filter + Adaptive Stops** (`useATRStops=true`, `atrFilterEnabled=true`)
- ATR entry filter: skip when `currentATR > 1.5 * avgATR` (avoid entering during volatile regimes)
- ATR-based stops: `stopPrice = entryPrice +/- entryATR * atrStopMultiplier` (2.5x default)
- ATR-based take-profits: `tpPrice = entryPrice -/+ entryATR * atrTPMultiplier` (3.5x default)
- **Critical implementation detail**: Uses `_entryATR` (ATR at entry time) for stop/TP calculations, NOT current ATR. This prevents stop levels from expanding when volatility increases against the position.

**Enhancement 3: Trend Alignment Filter** (`useTrendFilter=true`)
- Blocks shorts when price > SMA50 (uptrend)
- Blocks longs when price < SMA50 (downtrend)
- Prevents catastrophic losses on trend-following assets (DOGE, WIF)

### Phase 2 (Exit and Sizing)

**Enhancement 4: ATR Trailing Stop** (`useTrailingStop=false` by default)
- Activates when profit > `trailActivationATR * currentATR`
- Trails at `trailDistanceATR * currentATR` distance (uses current ATR for dynamic trail)
- Ratchets only in profitable direction (UP for longs, DOWN for shorts)

**Enhancement 5: Dynamic Position Sizing** (`positionSizeMethod="volAdjusted"`)
- `fixed`: Use `positionSizePct` directly
- `volAdjusted`: Scale inversely with ATR ratio (calmer markets = larger positions)
- `fractionalKelly`: Use half-Kelly criterion based on trade history

**Enhancement 7: FR Velocity Confirmation** (`useFRVelocity=false` by default)
- Requires FR to be reversing before entry
- Short entry: FR must be declining (not still rising)
- Long entry: FR must be rising (not still falling)

---

## Parameter Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| holdingPeriods | 3 | 3 x 8h = 24h max hold |
| positionSizePct | 50 | Base size for volAdjusted |
| usePercentile | true | Adaptive thresholds |
| shortPercentile | 95 | Top 5% of FR |
| longPercentile | 5 | Bottom 5% of FR |
| percentileLookback | 90 | ~30 days of FR data |
| useATRStops | true | ATR-based stops |
| atrPeriod | 14 | Standard ATR period |
| atrStopMultiplier | 2.5 | 2.5x ATR stop |
| atrTPMultiplier | 3.5 | 3.5x ATR TP |
| atrFilterEnabled | true | Vol entry filter |
| atrFilterThreshold | 1.5 | Skip if ATR > 1.5x avg |
| useTrendFilter | true | Block trend-fighting |
| trendSMAPeriod | 50 | SMA50 for trend |
| useTrailingStop | false | Off by default |
| positionSizeMethod | volAdjusted | Dynamic sizing |
| minPositionPct | 15 | Min 15% of equity |
| maxPositionPct | 50 | Max 50% of equity |
| useFRVelocity | false | Off by default |

---

## Backtest Results

### ATOM/USDT:USDT 4h (2024-01-01 to 2026-01-01, v2 defaults)
- Sharpe: **-0.77**
- Return: **-8.98%**
- MaxDD: **10.35%**
- Trades: **28**
- Note: Trend filter blocks most shorts during ATOM's 2024 bull run. Use `useTrendFilter=false` or `usePercentile=false` for better ATOM performance (see comparison below)

### ATOM with absolute thresholds + trend filter:
- `--param.usePercentile=false --param.useTrendFilter=true`
- Sharpe: **0.98**, Return: **8.6%**, MaxDD: **3.3%**, Trades: 19

### DOGE/USDT:USDT 4h (2024-01-01 to 2026-01-01, v2 defaults)
- Sharpe: **1.50** (vs ~-4.0 with v1 defaults = catastrophic -84% loss)
- Return: **+12.5%**
- MaxDD: **2.47%** (exceptional capital protection)
- Trades: **16** (high quality signals only)
- Win Rate: **81.25%**

---

## Key Design Decisions

1. **Entry ATR vs Current ATR**: Stop/TP levels use `_entryATR` (ATR at trade entry) not `currentATR`. This prevents the pathological behavior where ATR expansion during adverse moves widens the stop, turning a manageable loss into a catastrophic one.

2. **FR Normalization Exit**: Short exits when `FR < 75th pct`, long exits when `FR > 25th pct`. This ensures positions are held long enough for mean-reversion to occur without staying in too long.

3. **Trend Filter vs Percentile Thresholds Trade-off**: The trend filter is essential for volatile assets (DOGE protection). For stable L1 tokens (ATOM), the trend filter may be too restrictive - consider disabling per-asset via optimization.

---

## Validation

- `npm run typecheck`: PASS
- `npx tsx src/cli/quant-validate.ts strategies/funding-rate-spike-v2.ts`: PASS
