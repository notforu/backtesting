# Pairs Higher-Timeframe Filtered Mean Reversion Strategy

## Overview
Z-score pairs mean reversion with multi-period trend alignment and volatility regime filtering. Uses slow-period spread statistics as a higher-timeframe filter on standard z-score entries. Only trades when conditions are favorable across multiple time horizons.

## Strategy Name
`pairs-htf-mean-reversion`

## File
`strategies/pairs-htf-mean-reversion.ts`

## Interface
Implements `PairsStrategy` from `../src/strategy/pairs-base.js`. Use existing `pairs-zscore-scalper.ts` as structural reference.

## Key Innovations
1. **Dual-period spread analysis**: fast z-score for entry, slow z-score for trend filter
2. **Spread mean reversion regime detection**: only trade when slow spread is range-bound (not trending)
3. **Volatility percentile filter**: only trade in moderate vol (not too low = no opportunity, not too high = breakout/regime change)
4. **Adaptive entry threshold**: wider entry when vol is high, tighter when vol is low
5. **Correlation decay weighting**: recent correlation weighted more heavily

## Inline Helper Functions

### OLS Regression (reuse)
Same function returning { alpha, beta }.

### Rolling Mean / Std (reuse)

### Rolling Correlation (reuse)

### Volatility Percentile
```
Maintain rolling window of spreadStd values (volLookback bars)
Current percentile = rank of current spreadStd within the window / window length
```

### Exponentially Weighted Correlation
```
Standard correlation but with exponential weights:
w_i = lambda^(end-i) for i in [start, end]
Weighted means, variances, covariance using these weights
lambda = 0.97 (or derived from corrDecayPeriod: lambda = 1 - 2/(corrDecayPeriod+1))
```

### Spread Trend Detection (Hurst-like)
```
Use the ratio of long-period std to short-period std:
trendRatio = slowStd / (fastStd * sqrt(slowPeriod/fastPeriod))
If trendRatio > 1.2: spread is trending (avoid trading)
If trendRatio < 0.8: spread is mean-reverting (good to trade)
If 0.8-1.2: random walk (neutral)
```

## Parameters

| Name | Label | Default | Min | Max | Step | Description |
|------|-------|---------|-----|-----|------|-------------|
| lookbackPeriod | OLS Lookback | 200 | 100 | 400 | 100 | OLS regression window |
| fastZPeriod | Fast Z Period | 40 | 20 | 60 | 10 | Fast z-score window (entry signal) |
| slowZPeriod | Slow Z Period | 168 | 100 | 250 | 25 | Slow z-score window (trend filter, ~7 days at 1h) |
| entryZScore | Entry Z-Score | 2.0 | 1.5 | 3.0 | 0.25 | Base entry threshold |
| exitZScore | Exit Z-Score | 0.5 | 0.0 | 1.0 | 0.25 | Mean reversion exit |
| stopZScore | Stop Z-Score | 4.0 | 3.0 | 5.0 | 0.5 | Stop loss threshold |
| maxSlowZ | Max Slow Z | 1.5 | 0.5 | 2.0 | 0.25 | Max slow z-score (above = trending, don't trade) |
| volLookback | Vol Lookback | 200 | 100 | 300 | 50 | Window for vol percentile calculation |
| minVolPctile | Min Vol %ile | 20 | 10 | 30 | 5 | Minimum vol percentile to trade |
| maxVolPctile | Max Vol %ile | 80 | 70 | 90 | 5 | Maximum vol percentile to trade |
| trendThreshold | Trend Threshold | 1.2 | 1.0 | 1.5 | 0.1 | Hurst ratio above which spread is trending |
| maxHoldBars | Max Hold Bars | 100 | 50 | 200 | 25 | Max hold duration |
| positionSizePct | Position Size % | 80 | 50 | 90 | 10 | Capital per trade |
| minCorrelation | Min Correlation | 0.7 | 0.5 | 0.8 | 0.1 | Min weighted correlation |
| corrDecayPeriod | Corr Decay Period | 100 | 50 | 200 | 50 | Correlation decay half-life in bars |
| minProfitBps | Min Profit (bps) | 60 | 20 | 120 | 20 | Min expected profit |
| cooldownBars | Cooldown Bars | 8 | 0 | 20 | 4 | Post-trade cooldown |

## Entry Logic
1. Compute OLS regression for hedge ratio and spread
2. Compute fast z-score (fastZPeriod window)
3. Compute slow z-score (slowZPeriod window)
4. Compute spread volatility percentile
5. Compute trend ratio (slow std / scaled fast std)
6. Compute exponentially weighted correlation
7. **Regime filters** (ALL must pass):
   - Weighted correlation >= minCorrelation
   - |slowZScore| < maxSlowZ (slow spread not trending away)
   - volPercentile in [minVolPctile, maxVolPctile] (moderate vol)
   - trendRatio < trendThreshold (spread is mean-reverting, not trending)
   - Cooldown elapsed
8. **Entry signals** (after regime filters pass):
   - fastZScore > entryZScore → short-spread (Short A, Long B)
   - fastZScore < -entryZScore → long-spread (Long A, Short B)
   - Expected profit > minProfitBps
9. Hedge-ratio-weighted sizing

## Exit Logic
1. **Mean reversion**: fast z-score reverts to exitZScore (same as v2)
2. **Regime break**: correlation drops below minCorrelation (force close)
3. **Stop loss**: fast z-score exceeds stopZScore
4. **Time stop**: maxHoldBars exceeded
5. Close all positions

## Optimization Target
BTC/LTC on 1h, 2024-01-01 to 2024-12-31. Optimize for sharpeRatio. Max 300 combinations.

## Expected Behavior
- Fewer trades than base z-score strategy due to multiple regime filters
- Higher win rate because only trading in favorable regimes
- Better drawdown control from volatility and trend filtering
- The Hurst-like trend detection should avoid entering during spread breakouts
