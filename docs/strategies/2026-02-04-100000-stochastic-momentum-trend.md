# Strategy: Stochastic Momentum Trend (Stochastic + SMA + ADX + ATR)

> **Created**: 2026-02-04 10:00
> **Author**: quant-lead agent
> **Status**: Draft

## Executive Summary

The Stochastic Momentum Trend strategy is a hybrid system that exploits both momentum crossovers and oversold/overbought mean-reversion signals from the Stochastic Oscillator, filtered by a Simple Moving Average (SMA) trend direction filter and an ADX trend strength gate. It uses ATR-based trailing stops for dynamic risk management. Unlike the existing EMA-MACD strategy (which uses EMA crossovers), this strategy uses an entirely different signal generator -- the Stochastic %K/%D oscillator -- providing signal diversification. Unlike the discarded RSI mean reversion (too few trades) and Donchian breakout (overfitting), this strategy generates frequent signals via dual-mode entry (momentum crossovers AND oversold/overbought bounces).

---

## Hypothesis

Cryptocurrency markets exhibit strong momentum persistence punctuated by sharp mean-reverting pullbacks. The Stochastic Oscillator captures both phenomena: %K/%D crossovers detect momentum shifts, while extreme oversold/overbought readings identify pullback exhaustion points. By requiring a trend-direction filter (price above/below SMA) and trend-strength filter (ADX above threshold), we ensure signals are only taken in trending environments where follow-through is statistically likely.

The key innovation of this strategy is the **dual-mode entry system**: it can enter both on momentum crossovers (catching new trends early) AND on oversold bounces in established trends (buying dips). This dual-mode approach dramatically increases trade frequency compared to single-signal strategies while maintaining signal quality through the ADX and SMA filters.

**Core Edge**: The Stochastic Oscillator's bounded nature (0-100) makes it inherently resistant to the "runaway signal" problem that plagues unbounded indicators in crypto. Combined with trend alignment, it provides high-frequency, well-filtered entry signals. The ATR trailing stop captures the full extent of trending moves once entered.

**Why This Edge Persists**:
1. **Behavioral**: In crypto markets dominated by retail traders, momentum persistence and oversold bounces are amplified by FOMO and panic selling. The Stochastic captures both behavioral patterns.
2. **Structural**: Leveraged liquidation cascades in crypto create sharp pullbacks that quickly revert (mean-reversion mode) and persistent trends that extend beyond fundamentals (momentum mode).
3. **Dual-mode versatility**: Unlike single-signal strategies, the dual entry mode captures a wider range of market conditions while the SMA+ADX filters prevent trading in genuinely adverse environments.
4. **Proven framework**: The Stochastic Oscillator was developed by George Lane in the 1950s and has been validated across decades of market data. PyQuantLab (2025) confirmed its effectiveness on crypto with rolling backtests on SOL-USD.

**Market Conditions**:
- **Works best**: Trending markets with periodic pullbacks (the ideal condition for dual-mode entry), markets transitioning from consolidation to trend.
- **Works moderately**: Strongly trending markets (momentum crossovers fire, but oversold signals are rare).
- **Fails**: Extended choppy/range-bound markets (ADX filter suppresses signals, but some whipsaws may occur at ADX threshold boundaries).

**Academic/Empirical Backing**:
- PyQuantLab (2025): Stochastic Momentum Strategy on SOL-USD using %K/%D crossovers + SMA trend filter + ATR trailing stops showed robust results across rolling 3-month backtests from 2020-2025.
- Kalariya et al. (2022): Stochastic neural network-based algorithmic trading for crypto achieved 6653% return with manageable drawdown.
- American University of Armenia Capstone (2025): Comparative backtesting of strategies using Stochastic, RSI, MACD, CCI, and ADX showed that combined indicator approaches outperformed single indicators on crypto.
- LuxAlgo (2025): Research found combining stochastic signals with volume confirmation improved scalping entry accuracy by 22% in cryptocurrency markets. Refining stochastic settings boosts win rates by 15-20%.
- QuantifiedStrategies: Stochastic overbought/oversold strategy on SPY showed 556 trades since 1993, profit factor of 2.2, max drawdown 19.8%.
- Karassavidis, Kateris & Ioannidis (2025, SSRN): Volatility-adjusted, momentum-confirmed trend-following generates excess returns in crypto.

---

## Classification

**Style**: momentum (with mean-reversion hybrid)

**Holding Period**: swing (hours to days on 4h chart)

**Complexity**: Single-TF single-asset

**Market Type**: spot

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 4h

**Purpose**: Main signal generation, entry timing, position management.

**Rationale**: The 4h timeframe provides clean Stochastic signals with sufficient trade frequency for statistical significance. On BTC 4h with Stochastic(14,3,3) and dual-mode entry, we expect 8-15 qualified entries per month. The 4h timeframe on crypto produces approximately 6 candles per day, giving enough resolution to catch momentum shifts while filtering noise from shorter timeframes.

### Secondary Timeframes

None required for base implementation.

---

## Asset Configuration

### Primary Asset

**Asset**: BTC/USDT

**Why This Asset**: Most liquid crypto pair, strongest momentum characteristics, deepest order book minimizing slippage.

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| BTC/USDT | Large cap | Most liquid, primary development target |
| ETH/USDT | Large cap | Second most liquid, strong trending characteristics |
| SOL/USDT | Mid cap | Higher volatility, validated by PyQuantLab backtest |
| XRP/USDT | Large cap | Different volatility profile |
| BNB/USDT | Large cap | Exchange token dynamics |

**Generalizability Expectation**: Should work on all trending crypto pairs. The Stochastic's bounded nature makes it inherently adaptable across volatility regimes. Expected pass rate: 50-70% across test assets.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| Stochastic (%K, %D) | 4h | Momentum crossovers + oversold/overbought detection | period: 14, signalPeriod: 3 | Core signal generator |
| SMA | 4h | Trend direction filter | period: 30 | Only long above SMA, short below |
| ADX | 4h | Trend strength filter | period: 14 | Only trade when ADX > threshold |
| ATR | 4h | Trailing stop, risk management | period: 14 | Dynamic risk management |

### Additional Data Requirements

None. Strategy operates purely on OHLCV data.

### Data Preprocessing

- **Stochastic calculation**: The `technicalindicators` Stochastic class accepts `{ high, low, close, period, signalPeriod }` and produces `{ k, d }` output via `nextValue({ high, low, close })`.
- **Dual-mode signal detection**: Track both (1) %K/%D crossovers in the oversold/overbought zones and (2) %K crossing above/below the oversold/overbought thresholds. Both produce entry signals when trend filters align.

---

## Entry Logic

### Long Entry Conditions

**Mode 1 - Momentum Crossover (ALL must be true):**

1. **Stochastic Bullish Crossover**: %K crosses above %D (previous bar: %K <= %D, current bar: %K > %D).
2. **Stochastic Zone**: %K was below the oversold threshold (20) when the crossover occurred OR %K is currently rising and below 50 (mid-zone momentum entry).
3. **Trend Direction Filter (Bullish)**: Current close > SMA(30).
4. **ADX Trend Strength**: ADX(14) >= adxThreshold (default: 20).

**Mode 2 - Oversold Bounce (ALL must be true):**

1. **Stochastic Oversold Recovery**: %K crosses above the oversold level (default 20) from below.
2. **Stochastic Confirmation**: %K > %D (bullish alignment).
3. **Trend Direction Filter (Bullish)**: Current close > SMA(30).
4. **ADX Trend Strength**: ADX(14) >= adxThreshold (default: 20).

**Position Sizing**:
- Formula: `positionSize = (equity * 0.95) / currentPrice`

### Short Entry Conditions

**Mode 1 - Momentum Crossover (ALL must be true):**

1. **Stochastic Bearish Crossover**: %K crosses below %D.
2. **Stochastic Zone**: %K was above the overbought threshold (80) when the crossover occurred OR %K is currently falling and above 50.
3. **Trend Direction Filter (Bearish)**: Current close < SMA(30).
4. **ADX Trend Strength**: ADX(14) >= adxThreshold.

**Mode 2 - Overbought Reversal (ALL must be true):**

1. **Stochastic Overbought Recovery**: %K crosses below the overbought level (default 80) from above.
2. **Stochastic Confirmation**: %K < %D (bearish alignment).
3. **Trend Direction Filter (Bearish)**: Current close < SMA(30).
4. **ADX Trend Strength**: ADX(14) >= adxThreshold.

---

## Exit Logic

### ATR Trailing Stop (Primary Exit)

**Type**: ATR-based trailing stop that only moves in the favorable direction.

**Calculation**:
- Long: `trailingStop = max(trailingStop, currentPrice - ATR * trailMultiplier)`
- Short: `trailingStop = min(trailingStop, currentPrice + ATR * trailMultiplier)`
- Default `trailMultiplier`: 2.0

### Stochastic Signal Exit

**Exit Trigger**:
- For longs: Exit when %K crosses below %D while %K is in the overbought zone (above 80). This indicates momentum exhaustion.
- For shorts: Exit when %K crosses above %D while %K is in the oversold zone (below 20).

### Time-Based Exit

**Max Holding Period**: 50 bars (~8.3 days on 4h chart).

### Exit Priority

Trailing stop > Stochastic signal exit > Time-based exit.

---

## Risk Management

### Position Sizing

**Method**: Fixed percentage of available capital.
**Base Size**: 95% of available balance per trade.

### Per-Trade Risk

**Max Risk Per Trade**: Approximately 3-5% of equity (determined by ATR trailing stop at 2x ATR).

### Portfolio Risk

**Max Concurrent Positions**: 1 (either long or short, never both).

### Leverage

**Max Leverage**: 1x (spot only).

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| stochPeriod | number | 8 | 20 | 4 | 14 | Stochastic %K lookback period |
| stochSignalPeriod | number | 3 | 5 | 1 | 3 | Stochastic %D smoothing period |
| oversoldLevel | number | 15 | 25 | 5 | 20 | Stochastic oversold threshold |
| overboughtLevel | number | 75 | 85 | 5 | 80 | Stochastic overbought threshold |
| smaPeriod | number | 20 | 50 | 10 | 30 | SMA trend filter period |
| adxPeriod | number | 10 | 20 | 5 | 14 | ADX calculation period |
| adxThreshold | number | 15 | 30 | 5 | 20 | Minimum ADX for trend confirmation |
| atrPeriod | number | 10 | 20 | 5 | 14 | ATR period for trailing stop |
| trailMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | ATR multiplier for trailing stop distance |
| maxHoldBars | number | 30 | 70 | 10 | 50 | Maximum bars to hold a position |
| enableShorts | boolean | - | - | - | true | Enable short positions |

**Total parameters**: 11 (within the 8-14 target range)

**Optimization Notes**:
- Most sensitive parameters: `stochPeriod` (controls signal frequency), `adxThreshold` (filter strictness), `trailMultiplier` (risk/reward).
- Stochastic period of 14 with signalPeriod of 3 is the standard setting (14,3,3). Periods 8-12 produce faster signals suitable for crypto's higher volatility.
- ADX threshold of 20 balances signal quality with frequency. The existing EMA-MACD strategy found ADX=30 optimal, but the Stochastic generates more signals at lower ADX thresholds.
- SMA(30) is deliberately shorter than the EMA(50) used in the squeeze strategy, producing more responsive trend filtering suitable for the higher signal frequency.

---

## System Gaps

### Required Extensions

**None**. All indicators (Stochastic, SMA, ADX, ATR) are available in `technicalindicators` with streaming `nextValue()` API. Stochastic accepts `{ high, low, close }` in nextValue and returns `{ k, d }`.

### Workarounds

None needed. All indicators have proper streaming support.

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **Stochastic Momentum Trend** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy uses a dual-mode entry system combining Stochastic %K/%D crossovers and oversold/overbought bounces, filtered by SMA trend direction and ADX trend strength. It uses ATR trailing stops for exits.

This strategy:
- Trades on **4h** timeframe
- Uses **Stochastic (14,3), SMA(30), ADX(14), ATR(14)**
- Entry Mode 1: %K/%D crossover in oversold zone + trend alignment
- Entry Mode 2: %K crossing oversold/overbought threshold + trend alignment
- Exit: ATR trailing stop, Stochastic signal reversal, or time-based exit
- Risk: ATR trailing stop (2.0x ATR default), 95% capital deployment

---

#### System Extensions Required

**NONE**. All required indicators are available. Proceed directly to strategy implementation.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/stochastic-momentum-trend.ts`

**COMPLETE IMPLEMENTATION CODE:**

```typescript
import { Stochastic, SMA, ADX, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

interface IndicatorState {
  stochStream: InstanceType<typeof Stochastic>;
  smaStream: InstanceType<typeof SMA>;
  adxStream: InstanceType<typeof ADX>;
  atrStream: InstanceType<typeof ATR>;

  // Cached values for crossover detection (need current + previous)
  stochKValues: number[];
  stochDValues: number[];
  smaValues: number[];
  adxValues: number[];
  atrValues: number[];

  processedBars: number;
}

const stochasticMomentumTrend: Strategy = {
  name: 'stochastic-momentum-trend',
  description:
    'Hybrid momentum/mean-reversion strategy using Stochastic %K/%D crossovers and oversold/overbought bounces, filtered by SMA trend direction and ADX trend strength. Uses ATR trailing stop for dynamic exits.',
  version: '1.0.0',

  params: [
    {
      name: 'stochPeriod',
      label: 'Stochastic Period',
      type: 'number',
      default: 14,
      min: 8,
      max: 20,
      step: 4,
      description: 'Stochastic %K lookback period',
    },
    {
      name: 'stochSignalPeriod',
      label: 'Stochastic Signal Period',
      type: 'number',
      default: 3,
      min: 3,
      max: 5,
      step: 1,
      description: 'Stochastic %D smoothing period (signal line)',
    },
    {
      name: 'oversoldLevel',
      label: 'Oversold Level',
      type: 'number',
      default: 20,
      min: 15,
      max: 25,
      step: 5,
      description: 'Stochastic oversold threshold',
    },
    {
      name: 'overboughtLevel',
      label: 'Overbought Level',
      type: 'number',
      default: 80,
      min: 75,
      max: 85,
      step: 5,
      description: 'Stochastic overbought threshold',
    },
    {
      name: 'smaPeriod',
      label: 'SMA Period',
      type: 'number',
      default: 30,
      min: 20,
      max: 50,
      step: 10,
      description: 'SMA trend direction filter period',
    },
    {
      name: 'adxPeriod',
      label: 'ADX Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ADX calculation period for trend strength',
    },
    {
      name: 'adxThreshold',
      label: 'ADX Threshold',
      type: 'number',
      default: 20,
      min: 15,
      max: 30,
      step: 5,
      description: 'Minimum ADX value for trend strength confirmation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for trailing stop calculation',
    },
    {
      name: 'trailMultiplier',
      label: 'Trail Multiplier',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for trailing stop distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 50,
      min: 30,
      max: 70,
      step: 10,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish signals',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const stochPeriod = params.stochPeriod as number;
    const stochSignalPeriod = params.stochSignalPeriod as number;
    const smaPeriod = params.smaPeriod as number;
    const adxPeriod = params.adxPeriod as number;
    const atrPeriod = params.atrPeriod as number;

    // Initialize streaming indicator instances
    const state: IndicatorState = {
      stochStream: new Stochastic({
        period: stochPeriod,
        signalPeriod: stochSignalPeriod,
        high: [],
        low: [],
        close: [],
      }),
      smaStream: new SMA({ period: smaPeriod, values: [] }),
      adxStream: new ADX({ period: adxPeriod, high: [], low: [], close: [] }),
      atrStream: new ATR({ period: atrPeriod, high: [], low: [], close: [] }),

      stochKValues: [],
      stochDValues: [],
      smaValues: [],
      adxValues: [],
      atrValues: [],

      processedBars: 0,
    };

    (this as any)._state = state;
    (this as any)._entryBar = 0;
    (this as any)._trailingStop = 0;

    context.log(
      `Initialized Stochastic Momentum Trend (streaming): Stoch(${stochPeriod},${stochSignalPeriod}), SMA(${smaPeriod}), ADX(${adxPeriod})>=${params.adxThreshold}, Trail=${params.trailMultiplier}x ATR`
    );
  },

  onBar(context: StrategyContext): void {
    const {
      currentIndex,
      currentCandle,
      params,
      longPosition,
      shortPosition,
      balance,
    } = context;

    const state = (this as any)._state as IndicatorState;
    if (!state) return;

    // Extract parameters
    const oversoldLevel = params.oversoldLevel as number;
    const overboughtLevel = params.overboughtLevel as number;
    const adxThreshold = params.adxThreshold as number;
    const trailMultiplier = params.trailMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;

    const currentPrice = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;

    // --- Feed current candle to all streaming indicators (O(1) per indicator) ---

    // Stochastic
    const stochVal = state.stochStream.nextValue({ high, low, close: currentPrice } as any);
    if (stochVal && stochVal.k !== undefined && stochVal.d !== undefined) {
      state.stochKValues.push(stochVal.k);
      state.stochDValues.push(stochVal.d);
    }

    // SMA
    const smaVal = state.smaStream.nextValue(currentPrice);
    if (smaVal !== undefined) {
      state.smaValues.push(smaVal);
    }

    // ADX
    const adxVal = state.adxStream.nextValue({ high, low, close: currentPrice });
    if (adxVal && adxVal.adx !== undefined) {
      state.adxValues.push(adxVal.adx);
    }

    // ATR
    const atrVal = state.atrStream.nextValue({ high, low, close: currentPrice });
    if (atrVal !== undefined) {
      state.atrValues.push(atrVal);
    }

    state.processedBars++;

    // --- Check we have enough data for crossover detection (need current + previous) ---
    if (
      state.stochKValues.length < 2 ||
      state.stochDValues.length < 2 ||
      state.smaValues.length < 1 ||
      state.adxValues.length < 1 ||
      state.atrValues.length < 1
    ) {
      return;
    }

    // --- Read current and previous indicator values ---
    const currentK = state.stochKValues[state.stochKValues.length - 1];
    const prevK = state.stochKValues[state.stochKValues.length - 2];
    const currentD = state.stochDValues[state.stochDValues.length - 1];
    const prevD = state.stochDValues[state.stochDValues.length - 2];
    const currentSma = state.smaValues[state.smaValues.length - 1];
    const currentAdx = state.adxValues[state.adxValues.length - 1];
    const currentAtr = state.atrValues[state.atrValues.length - 1];

    // Detect crossovers
    const bullishKDCross = prevK <= prevD && currentK > currentD;
    const bearishKDCross = prevK >= prevD && currentK < currentD;

    // Detect oversold/overbought level crossovers
    const crossAboveOversold = prevK <= oversoldLevel && currentK > oversoldLevel;
    const crossBelowOverbought = prevK >= overboughtLevel && currentK < overboughtLevel;

    // Trend filters
    const isBullishTrend = currentPrice > currentSma;
    const isBearishTrend = currentPrice < currentSma;
    const hasTrendStrength = currentAdx >= adxThreshold;

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves UP for longs)
      const newTrailLevel = currentPrice - currentAtr * trailMultiplier;
      if (newTrailLevel > (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop (highest priority)
      if (currentPrice <= (this as any)._trailingStop) {
        context.log(`TRAILING STOP: Price ${currentPrice.toFixed(2)} <= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeLong();
        return;
      }

      // 2. Stochastic Signal Exit (bearish crossover in overbought zone)
      if (bearishKDCross && prevK >= overboughtLevel) {
        context.log(`STOCH EXIT: Bearish %K/%D crossover in overbought zone (K=${currentK.toFixed(1)}, D=${currentD.toFixed(1)})`);
        context.closeLong();
        return;
      }

      // 3. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        return;
      }
    }

    if (shortPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves DOWN for shorts)
      const newTrailLevel = currentPrice + currentAtr * trailMultiplier;
      if (newTrailLevel < (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop
      if (currentPrice >= (this as any)._trailingStop) {
        context.log(`TRAILING STOP (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeShort();
        return;
      }

      // 2. Stochastic Signal Exit (bullish crossover in oversold zone)
      if (bullishKDCross && prevK <= oversoldLevel) {
        context.log(`STOCH EXIT (SHORT): Bullish %K/%D crossover in oversold zone (K=${currentK.toFixed(1)})`);
        context.closeShort();
        return;
      }

      // 3. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition && hasTrendStrength) {
      // === LONG ENTRIES ===
      if (isBullishTrend) {
        // Mode 1: Bullish %K/%D crossover from oversold zone or mid-zone
        const mode1Long = bullishKDCross && (prevK < oversoldLevel || currentK < 50);

        // Mode 2: %K crossing above oversold level with bullish alignment
        const mode2Long = crossAboveOversold && currentK > currentD;

        if (mode1Long || mode2Long) {
          const positionValue = balance * 0.95;
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            const mode = mode1Long ? 'Crossover' : 'Oversold Bounce';
            context.log(
              `OPEN LONG [${mode}]: K=${currentK.toFixed(1)}, D=${currentD.toFixed(1)}, ADX=${currentAdx.toFixed(1)}, Price ${currentPrice.toFixed(2)} > SMA ${currentSma.toFixed(2)}`
            );
            (this as any)._entryBar = currentIndex;
            (this as any)._trailingStop = currentPrice - currentAtr * trailMultiplier;
            context.openLong(amount);
          }
        }
      }

      // === SHORT ENTRIES ===
      if (enableShorts && isBearishTrend) {
        // Mode 1: Bearish %K/%D crossover from overbought zone or mid-zone
        const mode1Short = bearishKDCross && (prevK > overboughtLevel || currentK > 50);

        // Mode 2: %K crossing below overbought level with bearish alignment
        const mode2Short = crossBelowOverbought && currentK < currentD;

        if (mode1Short || mode2Short) {
          const positionValue = balance * 0.95;
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            const mode = mode1Short ? 'Crossover' : 'Overbought Reversal';
            context.log(
              `OPEN SHORT [${mode}]: K=${currentK.toFixed(1)}, D=${currentD.toFixed(1)}, ADX=${currentAdx.toFixed(1)}, Price ${currentPrice.toFixed(2)} < SMA ${currentSma.toFixed(2)}`
            );
            (this as any)._entryBar = currentIndex;
            (this as any)._trailingStop = currentPrice + currentAtr * trailMultiplier;
            context.openShort(amount);
          }
        }
      }
    }
  },

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

export default stochasticMomentumTrend;
```

#### Important Implementation Notes

1. **Stochastic streaming**: The Stochastic class accepts `{ high: [], low: [], close: [], period, signalPeriod }` in the constructor. The `nextValue()` method takes `{ high, low, close }` for a single bar and returns `{ k, d }` or undefined during warmup. The `k` value is the fast %K line; `d` is the smoothed signal line.

2. **Dual-mode entry**: The strategy checks two independent entry conditions (Mode 1: crossover, Mode 2: level crossing). Either mode can trigger an entry as long as the trend filters (SMA + ADX) pass. This increases trade frequency significantly.

3. **%K/%D crossover detection**: Compare current vs previous %K and %D values. Bullish crossover: prevK <= prevD AND currentK > currentD. Bearish crossover: the reverse.

4. **Oversold level crossing**: `prevK <= oversoldLevel && currentK > oversoldLevel` detects the exact bar where %K crosses up through the oversold threshold.

5. **Trailing stop**: Updated every bar. For longs, stop only moves UP. For shorts, only moves DOWN. Uses current ATR for adaptive trail distance.

6. **Stochastic signal exit**: Only triggers when a crossover occurs in the extreme zone (overbought for longs, oversold for shorts). This prevents premature exits from mid-range crossovers.

7. **State arrays grow unboundedly**: For typical backtests (up to ~4000 bars on 4h), this is fine. For very long backtests, consider trimming arrays.

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates successfully:
  ```bash
  npx tsx src/cli/quant-validate.ts strategies/stochastic-momentum-trend.ts
  ```
- [ ] Quick backtest runs and generates 30+ trades:
  ```bash
  npx tsx src/cli/quant-backtest.ts --strategy=stochastic-momentum-trend --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 --timeframe=4h
  ```
- [ ] Trailing stop moves only in favorable direction
- [ ] Dual-mode entry conditions work correctly
- [ ] Proper handling of edge cases (insufficient data, undefined values)
- [ ] Streaming indicators used (no batch recalculation in onBar)

---

#### Testing Instructions

```bash
# 1. Validate strategy file
npx tsx src/cli/quant-validate.ts strategies/stochastic-momentum-trend.ts

# 2. Quick backtest on BTC (target: 30+ trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=stochastic-momentum-trend \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 3. Test with faster stochastic (more trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=stochastic-momentum-trend \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h \
  --param.stochPeriod=8

# 4. Test on ETH
npx tsx src/cli/quant-backtest.ts \
  --strategy=stochastic-momentum-trend \
  --symbol=ETH/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 5. Test on SOL (PyQuantLab validated)
npx tsx src/cli/quant-backtest.ts \
  --strategy=stochastic-momentum-trend \
  --symbol=SOL/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 6. Walk-forward test
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=stochastic-momentum-trend \
  --symbol=BTC/USDT \
  --from=2023-01-01 \
  --to=2024-12-31 \
  --timeframe=4h \
  --train-ratio=0.7 \
  --optimize-for=sharpeRatio \
  --max-combinations=500

# 7. Multi-asset validation
npx tsx src/cli/quant-multi-asset.ts \
  --strategy=stochastic-momentum-trend \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT,XRP/USDT,BNB/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Trade Frequency (CRITICAL)**:
- Expected Trades per 6-month period (4h): **35-70 trades** (target: 50+)
- Stochastic(14,3) on BTC 4h produces approximately 6-12 crossovers per month
- Dual-mode entry (crossovers + level crossings) increases signal count by ~40-60%
- After SMA + ADX filtering, approximately 6-12 qualified entries per month

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.0
- Target Win Rate: 45-55%
- Target Total Return: 25-60% annually
- Max Acceptable Drawdown: < 20%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.6
- Target OOS Degradation: < 30%
- Target Win Rate: 40-50%
- Max Acceptable Drawdown: < 25%

**Multi-Asset Performance**:
- Expected Pass Rate: 50-70% of tested assets
- Works Best On: Trending pairs with periodic pullbacks (BTC, ETH, SOL)

---

## References

**Academic Papers**:

1. "Quantitative Evaluation of Volatility-Adaptive Trend-Following Models in Cryptocurrency Markets", Karassavidis, Kateris & Ioannidis, SSRN, November 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5821842
   - Key Finding: Volatility-adjusted, momentum-confirmed trend-following systems generate statistically significant excess returns in crypto.

2. "Review and Applications of Cryptocurrency Algorithmic Trading Strategies", AUA Capstone, 2025
   - URL: https://cse.aua.am/wp-content/uploads/2025/06/Capstone-final.pdf
   - Key Finding: Comparative backtesting showed combined Stochastic+ADX indicator approaches outperformed single indicators on crypto.

3. "Catching Crypto Trends: A Tactical Approach for Bitcoin and Altcoins", Zarattini, Pagani & Barbon, SSRN, May 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5209907
   - Key Finding: Trend-following on crypto achieves Sharpe > 1.5 with proper momentum confirmation and risk management.

4. "Predicting Market Trends with Enhanced Technical Indicators", arXiv, October 2024
   - URL: https://arxiv.org/pdf/2410.06935
   - Key Finding: Machine learning models using Stochastic and other technical indicators achieved 86% accuracy on Bitcoin buy/sell signal prediction.

**Industry Research**:

1. "Stochastic Momentum Strategy: A Trend-Following and Mean-Reversion Hybrid", PyQuantLab, July 2025
   - URL: https://pyquantlab.medium.com/stochastic-momentum-strategy-a-trend-following-and-mean-reversion-hybrid-8360d081c334
   - Summary: Rolling backtest on SOL-USD 2020-2025 using Stochastic(14,3,3) + SMA(30) + ATR(14) trailing stops showed robust results across 3-month windows.

2. "Backtesting Stochastic Oscillator Settings: Step-by-Step", LuxAlgo, 2025
   - URL: https://www.luxalgo.com/blog/backtesting-stochastic-oscillator-settings-step-by-step/
   - Summary: Refining stochastic settings can boost win rates by 15-20%. Combining with volume confirmation improved scalping accuracy by 22%.

3. "Stochastic Indicator Strategy", QuantifiedStrategies
   - URL: https://www.quantifiedstrategies.com/stochastic-indicator-strategy/
   - Summary: Stochastic overbought/oversold strategy on SPY: 556 trades, profit factor 2.2, max drawdown 19.8%.

4. "Using the Stochastic Oscillator for Effective Crypto Trading", Altrady
   - URL: https://www.altrady.com/crypto-trading/technical-analysis/stochastic
   - Summary: Practical guide for Stochastic application in crypto with ADX trend filtering.

---

## Change Log

**Version 1.0** - 2026-02-04
- Initial specification
- Dual-mode entry system (momentum crossovers + oversold/overbought bounces)
- SMA trend direction + ADX trend strength dual filter
- ATR trailing stop for dynamic exits
- Designed for HIGH TRADE FREQUENCY (35-70+ trades per 6 months on 4h)
- Full implementation prompt with streaming indicator approach

---

## Notes

1. **Differentiation from existing strategies**: This strategy uses the Stochastic Oscillator, which is NOT used in any existing strategy. The EMA-MACD strategy uses EMA crossovers + MACD; the squeeze strategy uses BB/KC + linear regression. The Stochastic provides a fundamentally different signal source.

2. **Dual-mode advantage**: Unlike the discarded RSI mean reversion (3-8 trades per test period), this strategy's dual-mode entry system generates 6-12 entries per month. The key difference is that Mode 1 (crossovers) fires frequently even in trending markets, while Mode 2 (oversold bounces) adds signals during pullbacks.

3. **SMA vs EMA for trend filter**: This strategy uses SMA(30) instead of EMA for the trend filter. SMA is more stable and produces fewer whipsaws at the filter boundary, which is beneficial for a higher-frequency strategy that already has many signals.

4. **ADX threshold sensitivity**: The default ADX threshold of 20 is calibrated for the Stochastic's signal frequency. Lower thresholds (15) may produce too many whipsaw entries; higher thresholds (30) may reduce trades below the target.

5. **Complementary to existing strategies**: This strategy fires on different market conditions than the EMA-MACD (which requires EMA crossovers) and the squeeze (which requires BB/KC compression). Portfolio diversification benefit if multiple strategies are run.

---

**END OF SPECIFICATION**
