# Strategy: Volatility Squeeze Breakout (BB/KC Squeeze + Momentum)

> **Created**: 2026-02-03 11:00
> **Author**: quant-lead agent
> **Status**: Draft

## Executive Summary

The Volatility Squeeze Breakout strategy exploits the well-documented phenomenon that periods of low volatility in crypto markets tend to precede explosive directional moves. It detects "squeeze" conditions -- where Bollinger Bands contract inside Keltner Channels -- and enters on the breakout with momentum confirmation. An EMA trend filter reduces false signals in counter-trend environments.

---

## Hypothesis

Cryptocurrency markets exhibit strong volatility clustering: periods of low volatility persist and then resolve into sudden, large directional moves. This behavior is statistically documented in academic literature (Borrego Roldan 2025, Banerjee 2025) and is particularly pronounced in 24/7 crypto markets where there are no overnight gaps to dissipate accumulated pressure.

The Bollinger Band / Keltner Channel squeeze identifies the exact moment when volatility has contracted to unusually low levels. When BB width shrinks below KC width, price is coiling. The subsequent expansion -- when BBs break back outside KCs -- signals the start of a new volatility regime. By combining this with a momentum measure (linear regression of price deviation from midline), we can determine the direction of the breakout and ride it.

**Core Edge**: Volatility regime transitions are structural features of financial markets. The squeeze pattern captures the compression-to-expansion transition with high precision. In crypto specifically, these transitions are amplified by leveraged position liquidations, creating cascading moves.

**Why This Edge Persists**:
1. **Structural**: Volatility clustering is a fundamental property of financial time series, not an anomaly that gets arbitraged away.
2. **Behavioral**: During low-volatility periods, traders reduce position sizes and attention. When the move starts, they rush to enter, creating momentum.
3. **Mechanical**: In crypto, liquidation cascades amplify breakout moves beyond what fundamentals alone would produce.
4. **Regime-specific**: The squeeze explicitly waits for conditions to be right, avoiding the bulk of choppy, directionless periods.

**Market Conditions**:
- **Works best**: Trending markets, post-consolidation breakouts, periods transitioning from low to high volatility.
- **Works moderately**: During large range-bound periods (will capture range boundary breakouts).
- **Fails**: Extended choppy/whipsaw markets where squeezes fire but immediately reverse. Extremely low-volume conditions where breakouts lack follow-through.

**Academic/Empirical Backing**:
- Borrego Roldan (2025) demonstrated strong volatility clustering in Bitcoin across 2018-2024, confirming that low-vol periods predict subsequent high-vol periods.
- Banerjee (2025) showed that volatility regime detection (Expansion/Neutral/Contraction) produces materially different risk/return characteristics in crypto.
- Arda (2025) found that Bollinger Band breakout strategies outperformed mean-reversion in Bitcoin during accumulation and bull phases.
- PyQuantLab optimization study achieved Sharpe ratios exceeding 1.0 across 243 parameter combinations on BTC 2020-2025.
- Superalgos quantitative study achieved +87.65% profit on BTC/USDT with optimized squeeze strategy (vs 61% buy-and-hold).

---

## Classification

**Style**: volatility (with momentum confirmation)

**Holding Period**: swing (hours to days on 4h chart)

**Complexity**: Single-TF single-asset (simplest implementation; multi-TF enhancement possible via init())

**Market Type**: spot

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 4h

**Purpose**: Main signal generation, entry timing, position management.

**Rationale**: The 4h timeframe provides the best balance between signal quality and trade frequency for squeeze breakouts. Lower timeframes (1h, 15m) produce too many false squeezes in crypto due to microstructure noise. Daily is too slow and misses intraday regime changes. Research (LazyBear/TradingView backtests) confirms 1h-4h as optimal for crypto squeeze strategies. The 4h timeframe on crypto produces approximately 6 candles per day, giving enough resolution to catch breakouts while filtering noise.

### Secondary Timeframes

None required for base implementation. However, an enhancement could use the daily timeframe as a trend filter (pre-computed in init()).

---

## Asset Configuration

### Primary Asset

**Asset**: BTC/USDT

**Why This Asset**: Most liquid crypto pair, strongest volatility clustering characteristics, deepest order book (minimizes slippage), longest available data history for backtesting. BTC's boom-bust cycles are particularly well-suited to squeeze detection.

### Signal Assets

None required (single-asset strategy).

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| BTC/USDT | Large cap | Most liquid, primary development target |
| ETH/USDT | Large cap | Second most liquid, different volatility profile than BTC |
| SOL/USDT | Mid cap | Higher volatility, tests robustness on faster-moving assets |
| BNB/USDT | Large cap | Exchange token, different correlation dynamics |
| DOGE/USDT | Meme/speculative | High volatility, tests edge cases |

**Generalizability Expectation**: Should work on all large-cap and mid-cap pairs. Edge is based on volatility clustering which is a universal feature of financial time series. May struggle on very low-volume altcoins where breakouts lack follow-through. Expected pass rate: 50-70% across test assets.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| BollingerBands | 4h | Volatility measurement (squeeze detection) | period: 20, stdDev: 2.0 | Upper/lower bands for squeeze comparison |
| KeltnerChannels | 4h | Volatility baseline (squeeze detection) | period: 20, multiplier: 1.5 | When BB inside KC = squeeze |
| EMA | 4h | Trend filter | period: 50 | Only trade in trend direction |
| ATR | 4h | Stop loss calculation, position sizing | period: 14 | Dynamic risk management |
| Linear Regression | 4h | Momentum direction & magnitude | period: 20 | Of price deviation from BB midline; determines breakout direction |

### Additional Data Requirements

None. Strategy operates purely on OHLCV data.

### Data Preprocessing

- **Linear Regression calculation**: Compute linear regression of `(close - BB_middle)` over the last N bars. The slope/value determines momentum direction. This is NOT available as a built-in indicator and must be implemented as a helper function.
- **Squeeze state tracking**: Must track whether squeeze was "on" in previous bars to detect the transition from squeeze-on to squeeze-off (the "fire" event).

---

## Entry Logic

### Long Entry Conditions

**ALL of the following must be true:**

1. **Squeeze Release (Fire)**: Bollinger Bands were inside Keltner Channels on the previous bar (squeeze was ON), and on the current bar they have expanded back outside (squeeze is OFF).
   - Squeeze ON: `BB_upper < KC_upper AND BB_lower > KC_lower`
   - Squeeze OFF (fire): the above condition was true on previous bar but is false on current bar
   - Timeframe: 4h

2. **Momentum Direction (Positive)**: The linear regression value of `(close - BB_middle)` over the last 20 bars is positive AND increasing (current > previous).
   - This indicates price is above the mean and accelerating upward.
   - Timeframe: 4h

3. **Trend Filter (Bullish)**: Current close is above the 50-period EMA.
   - This ensures we only take longs in uptrending markets.
   - Timeframe: 4h

**Position Sizing**:
- Formula: `positionSize = (equity * 0.95) / currentPrice`
- Standard 95% of available balance, no volatility adjustment for base version.

### Short Entry Conditions

**ALL of the following must be true:**

1. **Squeeze Release (Fire)**: Same as long -- squeeze transitions from ON to OFF.

2. **Momentum Direction (Negative)**: The linear regression value of `(close - BB_middle)` is negative AND decreasing (current < previous).
   - Price is below mean and accelerating downward.

3. **Trend Filter (Bearish)**: Current close is below the 50-period EMA.

**Position Sizing**: Same as long.

### Entry Examples

**Example 1**: Bullish Squeeze Fire
- Date: 2024-03-10, Time: 16:00 (4h candle close)
- BTC price: $69,000
- Previous bar: BB_upper ($70,200) < KC_upper ($70,500) AND BB_lower ($67,800) > KC_lower ($67,500) -- squeeze ON
- Current bar: BB_upper ($70,800) > KC_upper ($70,500) -- squeeze OFF (FIRE!)
- LinReg momentum value: +450 (positive, increasing from +320)
- EMA(50) = $65,500, close $69,000 > $65,500 (bullish trend confirmed)
- **Action**: Open long, amount = ($9,500 * 0.95) / $69,000 = 0.1308 BTC

**Example 2**: Bearish Squeeze Fire
- Date: 2024-06-15, Time: 08:00 (4h candle close)
- BTC price: $64,000
- Squeeze transitions from ON to OFF
- LinReg momentum: -380 (negative, decreasing from -250)
- EMA(50) = $66,500, close $64,000 < $66,500 (bearish trend confirmed)
- **Action**: Open short, amount = ($9,500 * 0.95) / $64,000 = 0.1410 BTC

---

## Exit Logic

### Stop Loss

**Type**: ATR-based dynamic stop loss.

**Calculation**:
- `stopPrice_long = entryPrice - (ATR * atrStopMultiplier)`
- `stopPrice_short = entryPrice + (ATR * atrStopMultiplier)`
- Default `atrStopMultiplier`: 2.0

**Adjustment**: Stop is set at entry time and does NOT trail in the base version. The ATR value at entry time is used (not recalculated each bar for the stop distance, though the check uses current price vs stop price).

### Take Profit

**Type**: ATR-based take profit.

**Calculation**:
- `takeProfitPrice_long = entryPrice + (ATR * atrProfitMultiplier)`
- `takeProfitPrice_short = entryPrice - (ATR * atrProfitMultiplier)`
- Default `atrProfitMultiplier`: 3.0 (1.5x risk-reward ratio)

**Partial Exits**: Not implemented in base version (full exit only).

### Signal-Based Exit

**Exit Trigger**: Momentum reversal.
- For longs: Exit when the linear regression momentum value crosses below zero (momentum turns bearish).
- For shorts: Exit when the linear regression momentum value crosses above zero (momentum turns bullish).

**Priority**: Stop loss > Take profit > Signal-based exit (checked in this order each bar).

### Time-Based Exit

**Max Holding Period**: 30 candles (5 days on 4h chart).

**Rationale**: Squeeze breakouts are explosive, short-duration events. If a trade hasn't reached target or been stopped out within 5 days, the breakout has likely failed or the move is exhausted. This prevents capital from being tied up in dead trades.

### Exit Examples

**Example 1**: Stop Loss Exit
- Entry: $69,000 long, ATR = $1,200, stop = $69,000 - ($1,200 * 2.0) = $66,600
- Price drops to $66,500
- **Action**: Exit at $66,600, Loss: -3.5%

**Example 2**: Take Profit Exit
- Entry: $69,000 long, ATR = $1,200, target = $69,000 + ($1,200 * 3.0) = $72,600
- Price reaches $72,700
- **Action**: Exit at $72,600, Profit: +5.2%

**Example 3**: Momentum Reversal Exit
- Entry: $69,000 long
- After 12 bars, LinReg momentum value = -50 (crossed below zero)
- Current price: $70,200
- **Action**: Exit at $70,200, Profit: +1.7%

**Example 4**: Time-Based Exit
- Entry: $69,000 long
- After 30 bars (5 days), price = $69,500
- **Action**: Exit at $69,500, Profit: +0.7%

---

## Risk Management

### Position Sizing

**Method**: Fixed percentage of available capital.

**Base Size**: 95% of available balance per trade.

**Volatility Adjustment**: None in base version. (Enhancement: scale position by `avgATR / currentATR` to reduce size during high-vol periods.)

### Per-Trade Risk

**Max Risk Per Trade**: Approximately 3.5% of equity (determined by ATR stop distance at 2x ATR).

**Calculation**: The ATR-based stop provides dynamic risk sizing. With BTC's typical 4h ATR of ~1.5-2.5% of price, a 2x ATR stop gives ~3-5% risk per trade.

### Portfolio Risk

**Max Drawdown Limit**: Strategy does not implement portfolio-level drawdown kill switch (single-position strategy). This could be added as an enhancement.

**Max Concurrent Positions**: 1 (either long or short, never both).

### Leverage

**Max Leverage**: 1x (spot only).

**Rationale**: The squeeze breakout provides sufficient returns without leverage. Adding leverage would amplify false breakout losses disproportionately.

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| bbPeriod | number | 10 | 30 | 5 | 20 | Bollinger Bands period |
| bbStdDev | number | 1.5 | 2.5 | 0.5 | 2.0 | Bollinger Bands standard deviation |
| kcPeriod | number | 10 | 30 | 5 | 20 | Keltner Channel period |
| kcMultiplier | number | 1.0 | 2.0 | 0.5 | 1.5 | Keltner Channel ATR multiplier |
| emaPeriod | number | 30 | 80 | 10 | 50 | EMA trend filter period |
| momentumPeriod | number | 10 | 30 | 5 | 20 | Linear regression period for momentum |
| atrPeriod | number | 10 | 20 | 5 | 14 | ATR period for risk management |
| atrStopMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | ATR multiplier for stop loss |
| atrProfitMultiplier | number | 2.0 | 5.0 | 0.5 | 3.0 | ATR multiplier for take profit |
| maxHoldBars | number | 15 | 45 | 15 | 30 | Maximum bars to hold a position |
| enableShorts | boolean | - | - | - | true | Enable short positions |

**Parameter Dependencies**:
- `bbPeriod` and `kcPeriod` are typically the same value but can be optimized independently.
- `atrProfitMultiplier` should be >= `atrStopMultiplier` to maintain positive risk-reward.

**Optimization Notes**:
- Research suggests shorter BB periods (7-15) may outperform on crypto (PyQuantLab study). The range 10-30 captures this.
- KC multiplier of 1.5 is the most commonly cited optimal value (John Carter default). Range 1.0-2.0 allows exploration.
- The trend filter (EMA period) is less sensitive -- 50 is standard, 30-80 covers reasonable range.
- Most sensitive parameters: `bbStdDev`, `kcMultiplier` (these control squeeze sensitivity), and `atrStopMultiplier` (risk management).

**Total combinations**: 5 * 3 * 5 * 3 * 6 * 5 * 3 * 4 * 7 * 3 * 2 = very large. With max-combinations=500, the optimizer will sample effectively.

---

## System Gaps

### Required Extensions

**None**. The strategy can be fully implemented with the existing system capabilities:
- `BollingerBands` and `KeltnerChannels` are available in `technicalindicators` package.
- `ATR` and `EMA` are available.
- Linear regression must be implemented as a helper function within the strategy file (simple math, no external dependency).
- All entry/exit logic fits within the `onBar()` pattern.

### Workarounds

**For Linear Regression Momentum**: Since `technicalindicators` does not provide a linear regression indicator, we implement it as a simple helper function. Linear regression of N values is straightforward: compute slope using least-squares formula.

### Nice-to-Have Improvements

1. **Trailing Stop Enhancement**: After a certain profit threshold (e.g., 2x ATR in profit), switch from fixed stop to trailing stop at 1.5x ATR below current price.
2. **Volume Confirmation**: Add volume spike filter (volume > 1.5x average) on squeeze fire for higher-quality signals.
3. **Multi-Timeframe Enhancement**: Use daily EMA trend as additional filter (pre-compute in init()).
4. **Squeeze Duration Filter**: Only take signals from squeezes that lasted at least N bars (longer compression = bigger move).

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **Volatility Squeeze Breakout** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy detects when Bollinger Bands contract inside Keltner Channels (a "squeeze"), then enters a trade when the squeeze releases ("fires") with momentum confirmation and an EMA trend filter.

This strategy:
- Trades on **4h** timeframe
- Uses **BollingerBands, KeltnerChannels, EMA, ATR, and a custom linear regression momentum calculation**
- Entry: When squeeze fires (BB expands outside KC) with momentum in trend direction
- Exit: ATR-based stop loss, ATR-based take profit, momentum reversal, or time-based exit
- Risk: 2x ATR stop loss, 3x ATR take profit, 95% capital deployment

---

#### System Extensions Required

**NONE**. All required indicators are available in the `technicalindicators` package. Proceed directly to strategy implementation.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/volatility-squeeze-breakout.ts`

#### Step 1: Imports and Setup

```typescript
import { BollingerBands, KeltnerChannels, EMA, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';
```

#### Step 2: Helper Functions

Implement these helper functions BEFORE the strategy object:

```typescript
/**
 * Calculate Bollinger Bands with padding to align with candle array
 */
function calculateBB(closes: number[], period: number, stdDev: number): { upper: number; middle: number; lower: number; pb: number }[] {
  const result = BollingerBands.calculate({
    values: closes,
    period: period,
    stdDev: stdDev,
  });
  return result;
}

/**
 * Calculate Keltner Channels with padding
 */
function calculateKC(highs: number[], lows: number[], closes: number[], period: number, multiplier: number): { upper: number; middle: number; lower: number }[] {
  const result = KeltnerChannels.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: period,
    multiplier: multiplier,
    useSMA: false, // Use EMA (standard)
  });
  return result;
}

/**
 * Calculate EMA with padding
 */
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  const result = EMA.calculate({ values: closes, period: period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate ATR with padding
 */
function calculateATR(highs: number[], lows: number[], closes: number[], period: number): (number | undefined)[] {
  const result = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: period,
  });
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/**
 * Simple linear regression value (least squares)
 * Returns the current regression value for the last `period` data points.
 * Positive value = price above mean and trending up; negative = below and trending down.
 */
function linearRegressionValue(values: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(undefined);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const n = slice.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < n; j++) {
      sumX += j;
      sumY += slice[j];
      sumXY += j * slice[j];
      sumX2 += j * j;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    // The regression value at the last point
    const regValue = intercept + slope * (n - 1);
    result.push(regValue);
  }
  return result;
}
```

#### Step 3: Define Strategy Metadata and Parameters

```typescript
const volatilitySqueezeBreakout: Strategy = {
  name: 'volatility-squeeze-breakout',
  description: 'Volatility squeeze breakout strategy using BB/KC squeeze detection with linear regression momentum and EMA trend filter. Enters when squeeze fires in trend direction.',
  version: '1.0.0',

  params: [
    {
      name: 'bbPeriod',
      label: 'BB Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 30,
      step: 5,
      description: 'Bollinger Bands period',
    },
    {
      name: 'bbStdDev',
      label: 'BB Std Dev',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 2.5,
      step: 0.5,
      description: 'Bollinger Bands standard deviation multiplier',
    },
    {
      name: 'kcPeriod',
      label: 'KC Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 30,
      step: 5,
      description: 'Keltner Channel period',
    },
    {
      name: 'kcMultiplier',
      label: 'KC Multiplier',
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 2.0,
      step: 0.5,
      description: 'Keltner Channel ATR multiplier',
    },
    {
      name: 'emaPeriod',
      label: 'EMA Period',
      type: 'number',
      default: 50,
      min: 30,
      max: 80,
      step: 10,
      description: 'EMA trend filter period',
    },
    {
      name: 'momentumPeriod',
      label: 'Momentum Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 30,
      step: 5,
      description: 'Linear regression period for momentum calculation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for stop loss and take profit',
    },
    {
      name: 'atrStopMultiplier',
      label: 'ATR Stop Multiplier',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for stop loss distance',
    },
    {
      name: 'atrProfitMultiplier',
      label: 'ATR Profit Multiplier',
      type: 'number',
      default: 3.0,
      min: 2.0,
      max: 5.0,
      step: 0.5,
      description: 'ATR multiplier for take profit distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 30,
      min: 15,
      max: 45,
      step: 15,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish squeeze fires',
    },
  ],
```

#### Step 4: Implement init() Hook

```typescript
  init(context: StrategyContext): void {
    const { params } = context;
    const bbPeriod = params.bbPeriod as number;
    const kcPeriod = params.kcPeriod as number;
    const emaPeriod = params.emaPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrProfitMultiplier = params.atrProfitMultiplier as number;

    // Validate: profit multiplier should be >= stop multiplier for positive R:R
    if (atrProfitMultiplier < atrStopMultiplier) {
      context.log(`WARNING: Profit multiplier (${atrProfitMultiplier}) < Stop multiplier (${atrStopMultiplier}). Negative risk-reward ratio.`);
    }

    context.log(
      `Initialized Volatility Squeeze Breakout: BB(${bbPeriod}), KC(${kcPeriod}), EMA(${emaPeriod}), Stops: ${atrStopMultiplier}x ATR, TP: ${atrProfitMultiplier}x ATR`
    );
  },
```

#### Step 5: Implement onBar() Hook

This is the main trading logic. CRITICAL implementation details:

```typescript
  onBar(context: StrategyContext): void {
    const {
      candleView,
      currentIndex,
      currentCandle,
      params,
      longPosition,
      shortPosition,
      balance,
      equity,
    } = context;

    // Extract parameters
    const bbPeriod = params.bbPeriod as number;
    const bbStdDev = params.bbStdDev as number;
    const kcPeriod = params.kcPeriod as number;
    const kcMultiplier = params.kcMultiplier as number;
    const emaPeriod = params.emaPeriod as number;
    const momentumPeriod = params.momentumPeriod as number;
    const atrPeriod = params.atrPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrProfitMultiplier = params.atrProfitMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;

    // Determine minimum data requirement
    const minBars = Math.max(bbPeriod, kcPeriod, emaPeriod, momentumPeriod, atrPeriod) + 1;
    if (currentIndex < minBars) {
      return;
    }

    // Get price arrays
    const closes = candleView.closes();
    const highs = candleView.highs();
    const lows = candleView.lows();
    const currentPrice = currentCandle.close;

    // Calculate indicators
    const bb = calculateBB(closes, bbPeriod, bbStdDev);
    const kc = calculateKC(highs, lows, closes, kcPeriod, kcMultiplier);
    const ema = calculateEMA(closes, emaPeriod);
    const atr = calculateATR(highs, lows, closes, atrPeriod);

    // Calculate momentum: linear regression of (close - BB middle)
    // First, compute close - BB middle for each bar where BB exists
    const bbMiddles = bb.map(b => b.middle);
    // BB result array is shorter than closes (no padding from BollingerBands.calculate)
    // We need to align: BB starts at index (bbPeriod - 1) of the closes array
    const bbOffset = closes.length - bb.length;
    const deviations: number[] = [];
    for (let i = 0; i < bb.length; i++) {
      deviations.push(closes[bbOffset + i] - bb[i].middle);
    }
    const momentum = linearRegressionValue(deviations, momentumPeriod);

    // Get current and previous values
    // BB and KC arrays are not padded - get last elements
    const currentBB = bb[bb.length - 1];
    const prevBB = bb[bb.length - 2];
    const currentKC = kc[kc.length - 1];
    const prevKC = kc[kc.length - 2];
    const currentEMA = ema[ema.length - 1];
    const currentATR = atr[atr.length - 1];
    const currentMomentum = momentum[momentum.length - 1];
    const prevMomentum = momentum[momentum.length - 2];

    // Validate all values exist
    if (
      !currentBB || !prevBB || !currentKC || !prevKC ||
      currentEMA === undefined || currentATR === undefined ||
      currentMomentum === undefined || prevMomentum === undefined
    ) {
      return;
    }

    // Determine squeeze state
    // Squeeze ON: BB is INSIDE KC
    const prevSqueezeOn = prevBB.upper < prevKC.upper && prevBB.lower > prevKC.lower;
    const currentSqueezeOn = currentBB.upper < currentKC.upper && currentBB.lower > currentKC.lower;

    // Squeeze FIRE: was ON, now OFF
    const squeezeFired = prevSqueezeOn && !currentSqueezeOn;

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryPrice = longPosition.entryPrice;

      // Track bars held using a simple approach:
      // We store entryBar on the strategy object when opening
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Use stored ATR at entry for consistent stop/TP
      const entryATR = (this as any)._entryATR || currentATR;

      // 1. Stop Loss (highest priority)
      const stopPrice = entryPrice - (entryATR * atrStopMultiplier);
      if (currentPrice <= stopPrice) {
        context.log(`STOP LOSS: Price ${currentPrice.toFixed(2)} <= Stop ${stopPrice.toFixed(2)}`);
        context.closeLong();
        return;
      }

      // 2. Take Profit
      const takeProfitPrice = entryPrice + (entryATR * atrProfitMultiplier);
      if (currentPrice >= takeProfitPrice) {
        context.log(`TAKE PROFIT: Price ${currentPrice.toFixed(2)} >= Target ${takeProfitPrice.toFixed(2)}`);
        context.closeLong();
        return;
      }

      // 3. Momentum Reversal (momentum crosses below zero)
      if (currentMomentum < 0 && prevMomentum >= 0) {
        context.log(`MOMENTUM EXIT: Momentum crossed below zero (${currentMomentum.toFixed(2)})`);
        context.closeLong();
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        return;
      }
    }

    if (shortPosition) {
      const entryPrice = shortPosition.entryPrice;
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = (this as any)._entryATR || currentATR;

      // 1. Stop Loss
      const stopPrice = entryPrice + (entryATR * atrStopMultiplier);
      if (currentPrice >= stopPrice) {
        context.log(`STOP LOSS (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${stopPrice.toFixed(2)}`);
        context.closeShort();
        return;
      }

      // 2. Take Profit
      const takeProfitPrice = entryPrice - (entryATR * atrProfitMultiplier);
      if (currentPrice <= takeProfitPrice) {
        context.log(`TAKE PROFIT (SHORT): Price ${currentPrice.toFixed(2)} <= Target ${takeProfitPrice.toFixed(2)}`);
        context.closeShort();
        return;
      }

      // 3. Momentum Reversal (momentum crosses above zero)
      if (currentMomentum > 0 && prevMomentum <= 0) {
        context.log(`MOMENTUM EXIT (SHORT): Momentum crossed above zero (${currentMomentum.toFixed(2)})`);
        context.closeShort();
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition && squeezeFired) {
      // LONG ENTRY
      if (currentMomentum > 0 && currentMomentum > prevMomentum && currentPrice > currentEMA) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: Squeeze fired, momentum=${currentMomentum.toFixed(2)} (positive & rising), price ${currentPrice.toFixed(2)} > EMA ${currentEMA.toFixed(2)}`
          );
          // Store entry metadata for exit logic
          (this as any)._entryBar = currentIndex;
          (this as any)._entryATR = currentATR;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY
      if (enableShorts && currentMomentum < 0 && currentMomentum < prevMomentum && currentPrice < currentEMA) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: Squeeze fired, momentum=${currentMomentum.toFixed(2)} (negative & falling), price ${currentPrice.toFixed(2)} < EMA ${currentEMA.toFixed(2)}`
          );
          (this as any)._entryBar = currentIndex;
          (this as any)._entryATR = currentATR;
          context.openShort(amount);
        }
      }
    }
  },
```

#### Step 6: Implement onEnd() Hook

```typescript
  onEnd(context: StrategyContext): void {
    if (context.longPosition) {
      context.log('Closing remaining long position at end of backtest');
      context.closeLong();
    }
    if (context.shortPosition) {
      context.log('Closing remaining short position at end of backtest');
      context.closeShort();
    }
  },
};

export default volatilitySqueezeBreakout;
```

#### Important Implementation Notes

1. **BollingerBands.calculate() and KeltnerChannels.calculate() return arrays WITHOUT padding**. The result array length = `closes.length - period + 1` for BB (approximately). You must handle alignment carefully when comparing BB and KC values. Both should be called with the same period for easy alignment, or compute offsets.

2. **KeltnerChannels from technicalindicators** requires `{ high, low, close, period, multiplier, useSMA }`. Set `useSMA: false` to use EMA (standard Keltner Channel behavior). The `multiplier` parameter controls the ATR multiplier for channel width.

3. **Linear regression momentum**: This is a custom function. It computes the regression value (not slope) of the deviation series `(close - BB_middle)`. The value tells us where price is relative to the mean AND the direction of the trend. Positive and rising = bullish momentum; negative and falling = bearish momentum.

4. **State tracking via `this`**: We use `(this as any)._entryBar` and `(this as any)._entryATR` to track entry metadata. This is the standard pattern for storing state between bars in the strategy framework. These properties are set at entry and read during exit checks.

5. **Indicator alignment**: Since `BollingerBands.calculate()` and `KeltnerChannels.calculate()` may produce arrays of slightly different lengths (due to internal calculations), always use the LAST elements of each array for current values. Do not assume they have the same length -- use `array[array.length - 1]` and `array[array.length - 2]`.

6. **Squeeze detection logic**: `prevSqueezeOn && !currentSqueezeOn` detects the transition. This means on the EXACT bar where bands expand back outside channels, we enter. This is the "fire" event.

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates successfully:
  ```bash
  npx tsx src/cli/quant-validate.ts strategies/volatility-squeeze-breakout.ts
  ```
- [ ] Quick backtest runs and generates trades:
  ```bash
  npx tsx src/cli/quant-backtest.ts --strategy=volatility-squeeze-breakout --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 --timeframe=4h
  ```
- [ ] Parameters are within specified ranges
- [ ] Risk management enforced (stops, position sizing)
- [ ] All entry/exit conditions implemented correctly
- [ ] Proper handling of edge cases (insufficient data, undefined values)

---

#### Edge Cases to Handle

1. **Insufficient Data**: Early return if not enough candles for longest period indicator.
2. **Undefined Indicator Values**: Check ALL indicator values before using in conditions.
3. **BB/KC Array Alignment**: These indicators return unpadded arrays of potentially different lengths. Always index from the end.
4. **Division by Zero**: Validate denominators in position sizing calculations (`currentPrice > 0`).
5. **Concurrent Positions**: Ensure only one position (long OR short) at a time.
6. **Balance Checks**: Ensure `amount > 0` before opening positions.
7. **State Reset**: `_entryBar` and `_entryATR` should be set fresh each entry. No need to clear on exit since they are overwritten on next entry.

---

#### Testing Instructions

```bash
# 1. Validate strategy file
npx tsx src/cli/quant-validate.ts strategies/volatility-squeeze-breakout.ts

# 2. Quick backtest on BTC (should generate trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=volatility-squeeze-breakout \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 3. Test with parameter overrides
npx tsx src/cli/quant-backtest.ts \
  --strategy=volatility-squeeze-breakout \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h \
  --param.bbPeriod=15 \
  --param.kcMultiplier=1.0 \
  --param.bbStdDev=1.5

# 4. Test on ETH
npx tsx src/cli/quant-backtest.ts \
  --strategy=volatility-squeeze-breakout \
  --symbol=ETH/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 5. Walk-forward test
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=volatility-squeeze-breakout \
  --symbol=BTC/USDT \
  --from=2023-01-01 \
  --to=2024-12-31 \
  --timeframe=4h \
  --train-ratio=0.7 \
  --optimize-for=sharpeRatio \
  --max-combinations=500

# 6. Multi-asset validation
npx tsx src/cli/quant-multi-asset.ts \
  --strategy=volatility-squeeze-breakout \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 7. Longs-only test (disable shorts)
npx tsx src/cli/quant-backtest.ts \
  --strategy=volatility-squeeze-breakout \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h \
  --param.enableShorts=false
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.2
- Target Win Rate: 50-60%
- Target Total Return: 30-80% annually (varies by market regime)
- Max Acceptable Drawdown: < 18%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.8
- Target OOS Degradation: < 25%
- Target Win Rate: 45-55%
- Max Acceptable Drawdown: < 22%

**Trading Activity**:
- Expected Trades per Month: 3-8 (squeeze events are relatively infrequent on 4h)
- Average Trade Duration: 2-5 days (8-30 bars on 4h chart)
- Typical Position Size: 95% of capital

**Multi-Asset Performance**:
- Expected Pass Rate: 50-70% of tested assets
- Works Best On: Large-cap, liquid pairs (BTC, ETH, BNB)
- May Struggle On: Low-volume altcoins with insufficient liquidity for clean breakouts

---

## References

**Academic Papers**:

1. "Volatility Clustering in Bitcoin", Gabriel Borrego Roldan, SSRN, 2025
   - URL: https://papers.ssrn.com/sol3/Delivery.cfm/5073986.pdf?abstractid=5073986&mirid=1
   - Key Finding: Strong evidence of volatility clustering in Bitcoin across 2018-2024, particularly in shorter time frames, allowing for statistically significant predictions of market movements.

2. "Detecting Volatility Regimes in Crypto Markets using Realized Volatility Structure and Normalized Momentum", Kaustuv Banerjee, SSRN, 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5920642
   - Key Finding: Regime detection (Expansion/Neutral/Contraction) based on realized volatility structure produces materially different risk/return characteristics in crypto.

3. "Bollinger Bands under Varying Market Regimes: A Comparative Study of Breakout and Mean-Reversion Strategies in BTC/USDT", Efe Arda, SSRN, 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5775962
   - Key Finding: Bollinger Band breakout strategies outperformed mean-reversion in Bitcoin during accumulation and bull phases.

4. "Quantitative Evaluation of Volatility-Adaptive Trend-Following Models in Cryptocurrency Markets", Karassavidis, Kateris & Ioannidis, SSRN, 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5821842
   - Key Finding: Volatility-adjusted, momentum-confirmed trend-following systems generate statistically and economically significant excess returns in crypto.

**Industry Research**:

1. "Optimizing the Bollinger Band - Keltner Channel Squeeze Strategy", PyQuantLab, 2024
   - URL: https://pyquantlab.medium.com/optimizing-the-bollinger-band-keltner-channel-squeeze-strategy-volatility-breakout-trading-in-70b49101cb30
   - Summary: Tested 243 parameter combinations; achieved Sharpe ratios exceeding 1.0 with total returns above 200% on BTC 2020-2025. Shorter BB periods (5-7) outperformed; KC multiplier of 1.5 was optimal.

2. "A Quantitative Study of the Bollinger Bands Squeeze Strategy", Thomas Huault, Superalgos, Medium
   - URL: https://medium.com/superalgos/a-quantitative-study-of-the-bollinger-bands-squeeze-strategy-9f47143f33fb
   - Summary: BTC/USDT backtest achieved +87.65% profit with optimized SL/TP (4x ATR / 6x ATR) vs 61% buy-and-hold. 26 trades, 54% hit ratio.

3. "TTM Squeeze Indicator: How It Works, Signals & Trading Strategy", TrendSpider
   - URL: https://trendspider.com/learning-center/introduction-to-ttm-squeeze/
   - Summary: Comprehensive overview of the BB/KC squeeze mechanism and its use in identifying volatility breakout opportunities.

4. "Bollinger Band Squeeze Strategy - Backtest and Performance Insights", QuantifiedStrategies
   - URL: https://www.quantifiedstrategies.com/bollinger-band-squeeze-strategy/
   - Summary: Backtest results showing squeeze-based strategies with proper risk management can outperform in multiple market conditions.

**Books/Guides**:

1. "Mastering the Trade" (Chapter 11), John Carter, 2005 (3rd edition 2019)
   - Relevant Chapter: Chapter 11 - The Squeeze Play
   - Key Concept: Original TTM Squeeze concept: BB inside KC = volatility compression; fire on expansion with momentum direction for trade entry.

2. "Bollinger on Bollinger Bands", John Bollinger, 2001
   - Relevant Chapter: Chapters on Bandwidth and Squeeze
   - Key Concept: Bandwidth contraction (the "squeeze") is a leading indicator of volatility expansion.

**Similar Strategies**:

1. Squeeze Momentum Indicator by LazyBear (TradingView)
   - URL: https://www.tradingview.com/script/G40dtEbK-Squeeze-Momentum-Indicator-Strategy-LazyBear-PineIndicators/
   - Similarities: Uses BB/KC squeeze with linear regression momentum for direction.
   - Differences: Our version adds EMA trend filter and structured exit logic (ATR stops, time exits).

---

## Change Log

**Version 1.0** - 2026-02-03
- Initial specification
- Based on BB/KC Squeeze (John Carter TTM Squeeze variant) with momentum and EMA trend filter
- Includes comprehensive parameter ranges for grid search optimization
- Full implementation prompt with testing instructions

---

## Notes

1. **Transaction costs**: With typical 0.1% taker fees on Binance (round-trip 0.2%), the strategy needs trades to produce at least 0.2% profit to break even. Given the ATR-based targets (typically 3-5% on BTC 4h), this overhead is minimal.

2. **Squeeze frequency**: On BTC/USDT 4h, expect roughly 1-3 squeezes per week. Not all will fire in the trend direction, so actual trade frequency is lower.

3. **Market regime sensitivity**: This strategy naturally adapts to different regimes because the squeeze mechanism fires less often in trending markets (where BB stays wide) and more often in consolidating markets (where BB contracts). The EMA filter prevents taking signals against the prevailing trend.

4. **Future enhancements**: Consider adding a "squeeze duration" parameter (minimum bars the squeeze must be ON before a fire counts). Longer squeezes tend to produce bigger moves. Also consider adding volume confirmation on the fire bar.

5. **Short selling in crypto**: While spot markets technically don't support shorting, the backtesting system simulates short positions. For real implementation, shorts would require a futures exchange (Binance Futures, Bybit, etc.). The strategy works well as long-only too -- just disable shorts.
