# Pairs Kalman Reversion Strategy

## Overview
Adaptive pairs mean-reversion using Kalman filter for real-time hedge ratio estimation and half-life-based dynamic exits. Key improvement over OLS: no fixed lookback window, adapts instantly to regime changes.

## Strategy Name
`pairs-kalman-reversion`

## File
`strategies/pairs-kalman-reversion.ts`

## Interface
Implements `PairsStrategy` from `../src/strategy/pairs-base.js`. Use the existing `pairs-zscore-scalper.ts` as reference for the overall structure (IIFE closure pattern for state, same entry/exit framework).

## Key Innovations
1. **Kalman filter** replaces OLS regression for hedge ratio - adapts in real-time
2. **Half-life estimation** from spread AR(1) coefficient for dynamic time-based exit
3. **Exponentially weighted z-score** instead of simple rolling z-score for faster reaction
4. **Spread velocity filter** - only enter when spread is decelerating (about to revert)

## Inline Helper Functions

### Kalman Filter for Hedge Ratio
```
State: beta_t (hedge ratio)
Observation: y_t = logA_t, x_t = logB_t
Model: y_t = beta_t * x_t + epsilon_t

Prediction step:
  beta_pred = beta_{t-1}
  P_pred = P_{t-1} + Q  (Q = process noise variance, parameter)

Update step:
  K = P_pred * x_t / (x_t * P_pred * x_t + R)  (R = observation noise variance, parameter)
  beta_t = beta_pred + K * (y_t - beta_pred * x_t)
  P_t = (1 - K * x_t) * P_pred

Spread residual = y_t - beta_t * x_t
```

Initialize: beta_0 = 1.0, P_0 = 1.0

### Half-Life Estimation
```
From the last N spread residuals, compute AR(1) coefficient:
  rho = sum(spread_t * spread_{t-1}) / sum(spread_{t-1}^2)  (for demeaned spread)
  halfLife = -log(2) / log(abs(rho))
  Clamp halfLife to [5, maxHoldBars]
```

### Exponentially Weighted Z-Score
```
ewma_mean = alpha * spread_t + (1-alpha) * ewma_mean_{t-1}
ewma_var = alpha * (spread_t - ewma_mean)^2 + (1-alpha) * ewma_var_{t-1}
ewma_std = sqrt(ewma_var)
z = (spread_t - ewma_mean) / ewma_std

alpha = 2 / (ewmaPeriod + 1)
```

### Spread Velocity
```
velocity = spread_t - spread_{t-1}
acceleration = velocity_t - velocity_{t-1}
Spread is decelerating when: sign(velocity) != sign(acceleration)
```

## Parameters

| Name | Label | Default | Min | Max | Step | Description |
|------|-------|---------|-----|-----|------|-------------|
| kalmanQ | Process Noise | 0.0001 | 0.00001 | 0.001 | 0.0001 | Kalman filter process noise (higher = more adaptive) |
| kalmanR | Observation Noise | 0.001 | 0.0001 | 0.01 | 0.001 | Kalman filter observation noise (higher = smoother) |
| ewmaPeriod | EWMA Period | 40 | 20 | 80 | 10 | Exponential weighted z-score period |
| entryZScore | Entry Z-Score | 2.0 | 1.5 | 3.0 | 0.25 | Entry threshold |
| exitZScore | Exit Z-Score | 0.5 | 0.0 | 1.0 | 0.25 | Mean reversion exit threshold |
| stopZScore | Stop Z-Score | 4.0 | 3.0 | 5.0 | 0.5 | Stop loss z-score |
| maxHoldBars | Max Hold Bars | 120 | 60 | 200 | 20 | Maximum hold (overridden by half-life when available) |
| halfLifeMultiplier | Half-Life Mult | 2.0 | 1.5 | 3.0 | 0.5 | Exit after this many half-lives |
| positionSizePct | Position Size % | 80 | 50 | 90 | 10 | % of capital per trade |
| minCorrelation | Min Correlation | 0.7 | 0.5 | 0.8 | 0.1 | Min rolling correlation |
| minProfitBps | Min Profit (bps) | 80 | 20 | 120 | 20 | Min expected profit to enter |
| cooldownBars | Cooldown Bars | 8 | 0 | 20 | 4 | Post-trade cooldown |
| requireDeceleration | Require Decel | 1 | 0 | 1 | 1 | Only enter when spread decelerating (0=off, 1=on) |
| warmupBars | Warmup Bars | 100 | 50 | 200 | 50 | Bars before Kalman stabilizes |

## Entry Logic
1. Wait for warmupBars for Kalman to stabilize
2. Compute Kalman hedge ratio and spread residual
3. Compute exponentially weighted z-score
4. Compute rolling correlation (use 200-bar window on log prices)
5. Check: correlation >= minCorrelation
6. Check: |z-score| > entryZScore
7. Check: expected profit > minProfitBps (same formula as v2 scalper)
8. Check: cooldown elapsed
9. If requireDeceleration=1: check spread velocity is decelerating
10. Enter: z>0 → short-spread (short A, long B), z<0 → long-spread (long A, short B)
11. Use hedge-ratio-weighted sizing: notionalA = total/(1+|beta|), notionalB = total*|beta|/(1+|beta|)

## Exit Logic
1. Compute current z-score
2. Mean reversion: short-spread exits when z <= exitZScore, long-spread when z >= -exitZScore
3. Stop loss: z exceeds stopZScore in wrong direction
4. Time stop: min(maxHoldBars, halfLifeMultiplier * estimatedHalfLife) bars
5. Close all positions on exit

## Optimization Target
BTC/LTC on 1h, 2024-01-01 to 2024-12-31. Optimize for sharpeRatio. Max 300 combinations.

## Notes
- All math is inline, no external libraries
- Kalman filter state variables stored in IIFE closure
- The Kalman Q/R ratio controls adaptiveness: high Q/R = fast adaptation but noisy, low = smooth but slow
