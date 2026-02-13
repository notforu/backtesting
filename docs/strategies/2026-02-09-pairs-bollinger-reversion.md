# Pairs Bollinger Band Reversion Strategy

## Overview
Pairs mean-reversion using Bollinger Bands on the OLS spread with RSI momentum confirmation and Keltner Channel squeeze detection. Focuses on higher-quality entries by requiring multiple confirmations.

## Strategy Name
`pairs-bollinger-reversion`

## File
`strategies/pairs-bollinger-reversion.ts`

## Interface
Implements `PairsStrategy` from `../src/strategy/pairs-base.js`. Use existing `pairs-zscore-scalper.ts` as structural reference.

## Key Innovations
1. **Bollinger Bands on spread** instead of raw z-score - includes SMA and bandwidth info
2. **RSI of spread** for overbought/oversold confirmation at entries
3. **Keltner squeeze detection** - BB inside KC signals low vol, expect expansion
4. **Reversal candle confirmation** - spread must show reversal bar at extreme before entry
5. **ATR-based stop loss** instead of fixed z-score stop

## Inline Helper Functions

### OLS Regression (reuse from v2)
Same `olsRegression()` function returning { alpha, beta }.

### Rolling Correlation (reuse from v2)
Same `rollingCorrelation()` function.

### Bollinger Bands on Spread
```
sma = sum(spread[i], i=t-period..t) / period
std = sqrt(sum((spread[i] - sma)^2) / period)
upperBand = sma + bbMultiplier * std
lowerBand = sma - bbMultiplier * std
bbWidth = (upperBand - lowerBand) / sma  // normalized bandwidth
%B = (spread - lowerBand) / (upperBand - lowerBand)  // position within bands (0=lower, 1=upper)
```

### RSI of Spread
```
For each bar, delta = spread_t - spread_{t-1}
gain = max(delta, 0), loss = max(-delta, 0)
avgGain = EMA(gain, rsiPeriod)
avgLoss = EMA(loss, rsiPeriod)
RS = avgGain / avgLoss
RSI = 100 - 100 / (1 + RS)

Use Wilder smoothing: EMA alpha = 1/rsiPeriod
```

### Keltner Channel
```
kcMiddle = EMA(spread, kcPeriod)
atr = EMA(|spread_t - spread_{t-1}|, kcPeriod)  // simplified ATR for spread
kcUpper = kcMiddle + kcMultiplier * atr
kcLower = kcMiddle - kcMultiplier * atr

squeeze = (bbUpper < kcUpper) && (bbLower > kcLower)  // BB inside KC
```

### Reversal Detection
```
spreadReversal = (spread_{t-1} < spread_{t-2}) && (spread_t > spread_{t-1})  // bottom reversal
                 OR (spread_{t-1} > spread_{t-2}) && (spread_t < spread_{t-1})  // top reversal
```

## Parameters

| Name | Label | Default | Min | Max | Step | Description |
|------|-------|---------|-----|-----|------|-------------|
| lookbackPeriod | OLS Lookback | 200 | 100 | 400 | 100 | OLS regression window |
| bbPeriod | BB Period | 30 | 20 | 60 | 10 | Bollinger Band SMA period |
| bbMultiplier | BB Multiplier | 2.0 | 1.5 | 3.0 | 0.25 | BB standard deviation multiplier |
| rsiPeriod | RSI Period | 14 | 10 | 20 | 2 | RSI calculation period on spread |
| rsiOverbought | RSI Overbought | 70 | 65 | 80 | 5 | RSI overbought threshold (short spread) |
| rsiOversold | RSI Oversold | 30 | 20 | 35 | 5 | RSI oversold threshold (long spread) |
| kcPeriod | KC Period | 20 | 15 | 30 | 5 | Keltner Channel EMA period |
| kcMultiplier | KC Multiplier | 1.5 | 1.0 | 2.0 | 0.25 | Keltner Channel ATR multiplier |
| requireSqueeze | Require Squeeze | 0 | 0 | 1 | 1 | Only enter during KC squeeze (0=off, 1=on) |
| requireReversal | Require Reversal | 1 | 0 | 1 | 1 | Require spread reversal bar (0=off, 1=on) |
| stopAtrMultiplier | Stop ATR Mult | 3.0 | 2.0 | 5.0 | 0.5 | ATR-based stop distance |
| maxHoldBars | Max Hold Bars | 80 | 40 | 150 | 20 | Maximum hold duration |
| positionSizePct | Position Size % | 80 | 50 | 90 | 10 | % of capital per trade |
| minCorrelation | Min Correlation | 0.7 | 0.5 | 0.8 | 0.1 | Min rolling correlation |
| minProfitBps | Min Profit (bps) | 60 | 20 | 120 | 20 | Min expected profit to enter |
| cooldownBars | Cooldown Bars | 5 | 0 | 15 | 5 | Post-trade cooldown |

## Entry Logic
1. Compute OLS regression (lookbackPeriod window) for hedge ratio
2. Compute spread residual = logA - alpha - beta*logB
3. Compute Bollinger Bands on spread (bbPeriod, bbMultiplier)
4. Compute RSI of spread (rsiPeriod)
5. Compute Keltner Channel (kcPeriod, kcMultiplier)
6. Check: rolling correlation >= minCorrelation
7. Check: cooldown elapsed
8. **Long spread entry** (spread below lower BB, expect reversion up):
   - %B < 0 (spread below lower Bollinger Band)
   - RSI < rsiOversold
   - If requireReversal=1: spread shows bottom reversal bar
   - If requireSqueeze=1: squeeze is active (BB inside KC)
   - Expected profit check (distance from spread to SMA, in bps) > minProfitBps
   - → Long A, Short B
9. **Short spread entry** (spread above upper BB, expect reversion down):
   - %B > 1 (spread above upper Bollinger Band)
   - RSI > rsiOverbought
   - If requireReversal=1: spread shows top reversal bar
   - If requireSqueeze=1: squeeze is active
   - Expected profit check > minProfitBps
   - → Short A, Long B
10. Hedge-ratio-weighted sizing

## Exit Logic
1. **Mean reversion**: spread crosses back to SMA (middle Bollinger Band)
   - Short spread exits when spread <= SMA
   - Long spread exits when spread >= SMA
2. **ATR stop**: spread moves stopAtrMultiplier * ATR against position
3. **Time stop**: maxHoldBars exceeded
4. Close all positions

## Optimization Target
BTC/LTC on 1h, 2024-01-01 to 2024-12-31. Optimize for sharpeRatio. Max 300 combinations.
