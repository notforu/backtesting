# Pairs RSI Divergence Strategy

## Overview
Multi-indicator pairs mean-reversion combining RSI divergence on spread with MACD histogram timing and z-score confirmation. Focuses on fewer, higher-quality entries where multiple indicators agree.

## Strategy Name
`pairs-rsi-divergence`

## File
`strategies/pairs-rsi-divergence.ts`

## Interface
Implements `PairsStrategy` from `../src/strategy/pairs-base.js`. Use existing `pairs-zscore-scalper.ts` as structural reference.

## Key Innovations
1. **RSI as primary signal** instead of z-score - better at identifying overbought/oversold
2. **MACD histogram direction change** for timing - enter when momentum shifts
3. **Z-score as confirmation filter** (secondary, not primary)
4. **MACD-based exit** - exit when MACD momentum shifts back (not fixed z-score level)
5. **Triple confirmation** = fewer trades but higher win rate

## Inline Helper Functions

### OLS Regression (reuse)
Same function returning { alpha, beta }.

### Rolling Correlation (reuse)
Same function.

### Rolling Mean / Std (reuse)
Same functions for z-score calculation.

### RSI of Spread (Wilder smoothing)
```
delta = spread_t - spread_{t-1}
gain = max(delta, 0), loss = max(-delta, 0)

First avgGain/avgLoss: simple average over rsiPeriod
Subsequent:
  avgGain = (prevAvgGain * (rsiPeriod - 1) + gain) / rsiPeriod
  avgLoss = (prevAvgLoss * (rsiPeriod - 1) + loss) / rsiPeriod

RS = avgGain / avgLoss
RSI = 100 - 100 / (1 + RS)
```

### MACD of Spread
```
fastEMA = EMA(spread, macdFast)     // e.g., 12
slowEMA = EMA(spread, macdSlow)     // e.g., 26
macdLine = fastEMA - slowEMA
signalLine = EMA(macdLine, macdSignal) // e.g., 9
histogram = macdLine - signalLine

EMA formula: ema_t = alpha * value + (1-alpha) * ema_{t-1}, alpha = 2/(period+1)
```

### Histogram Direction Change
```
histogramTurningUp = histogram_t > histogram_{t-1} && histogram_{t-1} <= histogram_{t-2}
histogramTurningDown = histogram_t < histogram_{t-1} && histogram_{t-1} >= histogram_{t-2}
```

## Parameters

| Name | Label | Default | Min | Max | Step | Description |
|------|-------|---------|-----|-----|------|-------------|
| lookbackPeriod | OLS Lookback | 200 | 100 | 400 | 100 | OLS regression window |
| zScorePeriod | Z-Score Period | 60 | 30 | 80 | 10 | Z-score normalization period |
| rsiPeriod | RSI Period | 14 | 10 | 20 | 2 | RSI period on spread |
| rsiOverbought | RSI Overbought | 75 | 65 | 80 | 5 | Short spread entry threshold |
| rsiOversold | RSI Oversold | 25 | 20 | 35 | 5 | Long spread entry threshold |
| macdFast | MACD Fast | 12 | 8 | 16 | 2 | MACD fast EMA period |
| macdSlow | MACD Slow | 26 | 20 | 30 | 2 | MACD slow EMA period |
| macdSignal | MACD Signal | 9 | 7 | 12 | 1 | MACD signal line period |
| minZScore | Min Z-Score | 1.5 | 1.0 | 2.5 | 0.25 | Min z-score for confirmation |
| stopZScore | Stop Z-Score | 4.0 | 3.0 | 5.0 | 0.5 | Z-score stop loss |
| maxHoldBars | Max Hold Bars | 100 | 50 | 200 | 25 | Maximum hold duration |
| positionSizePct | Position Size % | 80 | 50 | 90 | 10 | Capital per trade |
| minCorrelation | Min Correlation | 0.7 | 0.5 | 0.8 | 0.1 | Min rolling correlation |
| minProfitBps | Min Profit (bps) | 60 | 20 | 120 | 20 | Min expected profit |
| cooldownBars | Cooldown Bars | 8 | 0 | 20 | 4 | Post-trade cooldown |

## Entry Logic (Triple Confirmation)
1. Compute OLS regression for hedge ratio and spread
2. Compute z-score of spread
3. Compute RSI of spread
4. Compute MACD of spread (lines + histogram)
5. Check: rolling correlation >= minCorrelation
6. Check: cooldown elapsed
7. **Long spread entry** (expect spread to rise):
   - RSI < rsiOversold (primary signal)
   - z-score < -minZScore (confirmation - spread is statistically low)
   - MACD histogram turning up (timing - momentum shifting)
   - Expected profit > minProfitBps
   - → Long A, Short B
8. **Short spread entry** (expect spread to fall):
   - RSI > rsiOverbought (primary signal)
   - z-score > minZScore (confirmation)
   - MACD histogram turning down (timing)
   - Expected profit > minProfitBps
   - → Short A, Long B
9. Hedge-ratio-weighted sizing

## Exit Logic
1. **MACD momentum exit** (primary):
   - Long spread: exit when MACD histogram turns down (from positive, momentum reversing)
   - Short spread: exit when MACD histogram turns up (from negative)
2. **RSI mean reversion exit**:
   - Long spread: exit when RSI > 50 (back to neutral)
   - Short spread: exit when RSI < 50
3. **Stop loss**: z-score exceeds stopZScore in wrong direction
4. **Time stop**: maxHoldBars exceeded
5. Use the FIRST exit signal that fires

## Optimization Target
BTC/LTC on 1h, 2024-01-01 to 2024-12-31. Optimize for sharpeRatio. Max 300 combinations.
