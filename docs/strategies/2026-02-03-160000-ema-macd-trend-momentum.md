# Strategy: EMA Crossover with MACD-ADX Trend Momentum

> **Created**: 2026-02-03 16:00
> **Author**: quant-lead agent
> **Status**: Draft

## Executive Summary

The EMA-MACD Trend Momentum strategy is a multi-indicator trend-following system that combines EMA crossovers for trend direction, MACD histogram for momentum confirmation, and ADX for trend strength filtering. It uses ATR-based trailing stops to ride trends and maximize winning trades. Unlike the discarded mean reversion strategy (too few trades) and the squeeze breakout (event-driven, infrequent), this strategy generates signals on EVERY EMA crossover that passes the momentum and trend-strength filters, producing significantly higher trade frequency.

---

## Hypothesis

Cryptocurrency markets exhibit strong momentum characteristics where trends, once established, tend to persist for extended periods. This behavior is well-documented in academic literature: Zarattini, Pagani & Barbon (2025, SSRN) demonstrated that trend-following with Donchian/momentum signals achieves Sharpe ratios above 1.5 on crypto. Grayscale Research showed that a 20d/100d moving average crossover on Bitcoin produced an annualized Sharpe of 1.7 (vs 1.3 buy-and-hold). Karassavidis et al. (2025, SSRN) confirmed that volatility-adjusted, momentum-confirmed trend-following generates statistically significant excess returns in crypto.

The key insight is that trend-following edges in crypto persist because of three structural factors: (1) retail-dominated markets where FOMO and panic create persistent trends; (2) leverage and liquidation cascades that amplify directional moves; and (3) information asymmetries in a 24/7 global market. By combining EMA crossovers with MACD momentum confirmation and ADX strength filtering, we enter trends early (via fast EMA crossover), confirm momentum is genuine (via MACD), and ensure the trend has sufficient strength to justify the trade (via ADX).

**Core Edge**: Dual-filtered trend entry catches real trends while rejecting false crossovers in choppy markets. The MACD histogram provides early warning of momentum shifts, and the ADX filter ensures we only trade when directional movement is strong enough to overcome transaction costs and slippage.

**Why This Edge Persists**:
1. **Behavioral**: Retail crypto traders chase momentum, creating self-reinforcing trends. EMA crossovers capture the moment this herd behavior begins.
2. **Structural**: Leveraged liquidations cascade in one direction, extending trends beyond what fundamentals would predict.
3. **Noise filtering**: The triple filter (EMA cross + MACD confirmation + ADX strength) eliminates the majority of false signals that destroy simple crossover strategies.
4. **Adaptive exits**: ATR-based trailing stops dynamically adjust to volatility, preventing premature exits in volatile crypto markets while protecting profits.

**Market Conditions**:
- **Works best**: Trending markets with clear directional bias, post-breakout continuation moves, markets transitioning from consolidation to trend.
- **Works moderately**: Markets with intermittent trends separated by brief consolidations (ADX filter will suppress trades during consolidation).
- **Fails**: Extended sideways/choppy markets where EMA crossovers whipsaw repeatedly (ADX filter mitigates but does not eliminate this risk).

**Academic/Empirical Backing**:
- Zarattini, Pagani & Barbon (2025) achieved Sharpe > 1.5 with Donchian-based trend-following on crypto, with 10.8% annualized alpha (SSRN).
- Karassavidis, Kateris & Ioannidis (2025) confirmed volatility-adjusted trend-following generates excess returns in crypto (SSRN).
- Grayscale Research demonstrated 20d/100d MA crossover on BTC produces annualized Sharpe of 1.7.
- Beluska & Vojtko (2024, SSRN) showed that trend-following in BTC works especially well at price maxima.
- PyQuantLab (2025) rolling backtest of EMA crossover + MACD + ADX + trailing stops showed robust results across crypto assets.
- ForexTester backtests showed ADX + EMA combination achieved 82% profit in one month on XAU/USD 1H.

---

## Classification

**Style**: trend (with momentum confirmation)

**Holding Period**: swing (hours to days on 4h chart)

**Complexity**: Single-TF single-asset

**Market Type**: spot

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 4h

**Purpose**: Main signal generation, entry timing, position management.

**Rationale**: The 4h timeframe provides clean EMA crossover signals with sufficient trade frequency for statistical significance. Research shows that EMA crossovers on 1H/4H provide cleaner signals than shorter timeframes while maintaining adequate trading opportunities. On BTC 4h, a fast/slow EMA crossover (e.g., 9/21) produces approximately 8-15 crossovers per month, which after MACD and ADX filtering yields 4-10 qualified signals per month (approximately 30-60 trades per 6-month period).

### Secondary Timeframes

None required for base implementation.

---

## Asset Configuration

### Primary Asset

**Asset**: BTC/USDT

**Why This Asset**: Most liquid, strongest trending characteristics during bull/bear phases, deepest order book.

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| BTC/USDT | Large cap | Most liquid, primary development target |
| ETH/USDT | Large cap | Second most liquid, strong trending characteristics |
| SOL/USDT | Mid cap | Higher volatility, more frequent crossovers |
| XRP/USDT | Large cap | Different volatility profile |
| DOGE/USDT | Meme | Very high volatility stress test |
| BNB/USDT | Large cap | Exchange token dynamics |

**Generalizability Expectation**: Should work on all trending crypto pairs. The edge is based on trend persistence, which is a universal feature of momentum-driven markets. Expected pass rate: 50-70% across test assets.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| EMA (fast) | 4h | Trend direction (fast component) | period: 9 | Short-term trend |
| EMA (slow) | 4h | Trend direction (slow component) | period: 21 | Medium-term trend |
| MACD | 4h | Momentum confirmation | fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 | Histogram confirms momentum direction |
| ADX | 4h | Trend strength filter | period: 14 | Only trade when ADX > threshold |
| ATR | 4h | Trailing stop, position risk | period: 14 | Dynamic risk management |

### Additional Data Requirements

None. Strategy operates purely on OHLCV data.

### Data Preprocessing

- **EMA crossover detection**: Compare fast EMA vs slow EMA on current and previous bars. Bullish crossover: prev fast <= prev slow AND current fast > current slow. Bearish crossover: prev fast >= prev slow AND current fast < current slow.
- **MACD histogram direction**: Use the sign AND direction of MACD histogram. For long entries, histogram must be positive OR rising. For short entries, histogram must be negative OR falling. This is more permissive than requiring both, increasing trade frequency.
- **ADX threshold**: ADX above threshold (default 20) indicates sufficient trend strength. Note: using 20 instead of 25 to increase trade frequency while still filtering the weakest signals.

---

## Entry Logic

### Long Entry Conditions

**ALL of the following must be true:**

1. **EMA Bullish Crossover**: Fast EMA crosses above Slow EMA on the current bar.
   - Condition: `prevFastEMA <= prevSlowEMA AND currentFastEMA > currentSlowEMA`
   - Timeframe: 4h

2. **MACD Momentum Confirmation**: MACD histogram is positive (MACD line above signal line).
   - Condition: `MACD_histogram > 0`
   - This confirms upward momentum is present, not just a price crossover.
   - Timeframe: 4h

3. **ADX Trend Strength**: ADX(14) >= adxThreshold (default: 20).
   - This ensures the market has directional strength, filtering out weak/choppy crossovers.
   - Timeframe: 4h

**Position Sizing**:
- Formula: `positionSize = (equity * 0.95) / currentPrice`
- Standard 95% of available balance.

### Short Entry Conditions

**ALL of the following must be true:**

1. **EMA Bearish Crossover**: Fast EMA crosses below Slow EMA on the current bar.
   - Condition: `prevFastEMA >= prevSlowEMA AND currentFastEMA < currentSlowEMA`

2. **MACD Momentum Confirmation**: MACD histogram is negative (MACD line below signal line).
   - Condition: `MACD_histogram < 0`

3. **ADX Trend Strength**: ADX(14) >= adxThreshold (default: 20).

**Position Sizing**: Same as long.

### Entry Examples

**Example 1**: Bullish Entry
- Date: 2024-03-15, Time: 12:00 (4h candle close)
- BTC price: $68,500
- Fast EMA(9) = $67,800, Slow EMA(21) = $67,500 (fast just crossed above slow)
- Previous bar: Fast EMA = $67,400, Slow EMA = $67,500 (fast was below slow)
- MACD histogram = +120 (positive: momentum confirmed)
- ADX(14) = 28 (above 20: trend strength confirmed)
- **Action**: Open long, amount = ($9,500 * 0.95) / $68,500 = 0.1318 BTC
- Set trailing stop at $68,500 - (ATR * 2.0) = $68,500 - $1,600 = $66,900

**Example 2**: Bearish Entry
- Date: 2024-06-20, Time: 08:00
- ETH price: $3,200
- Fast EMA crosses below Slow EMA
- MACD histogram = -45 (negative: bearish momentum)
- ADX = 24 (above 20)
- **Action**: Open short

---

## Exit Logic

### Trailing Stop Loss (Primary Exit)

**Type**: ATR-based trailing stop that only moves in the favorable direction.

**Calculation**:
- Long: `trailingStop = max(trailingStop, currentPrice - ATR * trailMultiplier)`
- Short: `trailingStop = min(trailingStop, currentPrice + ATR * trailMultiplier)`
- Default `trailMultiplier`: 2.0

**Initialization**: On entry, the trailing stop is set at `entryPrice - (ATR * trailMultiplier)` for longs and `entryPrice + (ATR * trailMultiplier)` for shorts.

**Update Rule**: The trailing stop updates EVERY bar using the current ATR value. For longs, the stop only moves UP (never down). For shorts, the stop only moves DOWN (never up). This locks in profits as the trade moves in the favorable direction.

**Exit Trigger**: Long exits when `currentPrice <= trailingStop`. Short exits when `currentPrice >= trailingStop`.

### Signal-Based Exit (EMA Re-Cross)

**Exit Trigger**: When the EMA crossover reverses:
- For longs: Exit when Fast EMA crosses below Slow EMA (bearish re-cross).
- For shorts: Exit when Fast EMA crosses above Slow EMA (bullish re-cross).

**Rationale**: An EMA re-cross definitively signals that the trend that prompted entry has reversed. This exit catches trend reversals even if the trailing stop hasn't been hit.

### MACD Momentum Exit

**Exit Trigger**: When MACD histogram changes sign against the position:
- For longs: Exit when MACD histogram crosses from positive to negative (momentum shift).
- For shorts: Exit when MACD histogram crosses from negative to positive.

**Rationale**: MACD histogram sign change is an early warning of momentum exhaustion. This provides a faster exit than waiting for a full EMA re-cross.

### Time-Based Exit

**Max Holding Period**: 60 bars (10 days on 4h chart).

**Rationale**: Trend-following trades on 4h should capture their move within 10 days. Positions held longer than this are likely in a consolidation zone and tying up capital.

### Exit Priority

Trailing stop > EMA re-cross > MACD momentum exit > Time-based exit (checked in this order each bar).

### Exit Examples

**Example 1**: Trailing Stop Exit (Profitable)
- Entry: $68,500 long, initial trailing stop = $66,900
- After 8 bars, price rises to $72,000. Trailing stop updates to $72,000 - $1,500 = $70,500
- Price drops to $70,400
- **Action**: Exit at $70,500 (trailing stop hit). Profit: +2.9%

**Example 2**: EMA Re-Cross Exit
- Entry: $68,500 long
- After 15 bars, Fast EMA crosses back below Slow EMA. Price = $69,800
- **Action**: Exit at $69,800. Profit: +1.9%

**Example 3**: MACD Momentum Exit
- Entry: $68,500 long
- After 6 bars, MACD histogram crosses from +80 to -10. Price = $69,200
- **Action**: Exit at $69,200. Profit: +1.0%

---

## Risk Management

### Position Sizing

**Method**: Fixed percentage of available capital.

**Base Size**: 95% of available balance per trade.

### Per-Trade Risk

**Max Risk Per Trade**: Approximately 2-4% of equity (determined by ATR trailing stop distance at 2x ATR). On BTC 4h, typical ATR is ~1.5-2.5% of price, so 2x ATR = ~3-5% stop distance.

### Portfolio Risk

**Max Concurrent Positions**: 1 (either long or short, never both).

### Leverage

**Max Leverage**: 1x (spot only).

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| fastEmaPeriod | number | 5 | 15 | 2 | 9 | Fast EMA period |
| slowEmaPeriod | number | 15 | 35 | 5 | 21 | Slow EMA period |
| macdFastPeriod | number | 8 | 16 | 4 | 12 | MACD fast EMA period |
| macdSlowPeriod | number | 20 | 30 | 5 | 26 | MACD slow EMA period |
| macdSignalPeriod | number | 5 | 12 | 1 | 9 | MACD signal line period |
| adxPeriod | number | 10 | 20 | 5 | 14 | ADX calculation period |
| adxThreshold | number | 15 | 30 | 5 | 20 | ADX minimum for trend strength |
| atrPeriod | number | 10 | 20 | 5 | 14 | ATR period for trailing stop |
| trailMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | ATR multiplier for trailing stop |
| maxHoldBars | number | 30 | 90 | 15 | 60 | Maximum bars to hold a position |
| enableShorts | boolean | - | - | - | true | Enable short positions |

**Parameter Dependencies**:
- `fastEmaPeriod` must be < `slowEmaPeriod` (validated in init).
- `macdFastPeriod` must be < `macdSlowPeriod` (MACD definition).
- `adxThreshold` of 15-20 is deliberately lower than the typical 25 to increase trade frequency while still filtering noise.

**Optimization Notes**:
- Most sensitive parameters: `fastEmaPeriod` and `slowEmaPeriod` (control signal frequency), `adxThreshold` (controls filter strictness), `trailMultiplier` (controls risk/reward).
- Research suggests EMA periods of 9/21 and 12/26 are most effective for crypto on 4h.
- ADX threshold of 20 balances signal quality with frequency.
- Trail multiplier of 1.5-2.0 is tighter than breakout strategies because trend entries should be closer to the move start.

**Total combinations**: 6 * 5 * 3 * 3 * 8 * 3 * 4 * 3 * 4 * 5 * 2 = ~622,080. With max-combinations=500, the optimizer will sample effectively.

---

## System Gaps

### Required Extensions

**None**. All indicators (EMA, MACD, ADX, ATR) are available in `technicalindicators`. The MACD class provides `MACD`, `signal`, and `histogram` outputs. ADX provides `adx`, `pdi`, `mdi`. All support the `nextValue()` streaming API.

### Workarounds

None needed.

### Nice-to-Have Improvements

1. **Volume confirmation**: Add volume filter (volume > 1.2x average) on crossover bars for higher-quality signals.
2. **Multi-timeframe filter**: Use daily EMA as additional trend confirmation (pre-compute in init()).
3. **Partial exits**: Close 50% at 1.5x ATR profit, trail remainder.
4. **Re-entry logic**: Allow re-entry in same direction after trailing stop exit if EMA alignment persists.

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **EMA-MACD Trend Momentum** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy combines EMA crossovers for trend direction, MACD histogram for momentum confirmation, and ADX for trend strength filtering. It enters on confirmed trend crossovers and uses ATR-based trailing stops to ride trends.

This strategy:
- Trades on **4h** timeframe
- Uses **EMA (fast/slow), MACD (histogram), ADX, ATR**
- Entry: EMA crossover + MACD histogram confirmation + ADX strength filter
- Exit: ATR trailing stop, EMA re-cross, MACD histogram sign change, or time-based exit
- Risk: ATR trailing stop (2.0x ATR default), 95% capital deployment

---

#### System Extensions Required

**NONE**. All required indicators are available in `technicalindicators`. Proceed directly to strategy implementation.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/ema-macd-trend-momentum.ts`

#### Step 1: Imports and Setup

```typescript
import { EMA, MACD, ADX, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';
```

#### Step 2: Indicator State Interface

Define the state interface for streaming indicators (stored on `this` between bars):

```typescript
interface IndicatorState {
  fastEmaStream: InstanceType<typeof EMA>;
  slowEmaStream: InstanceType<typeof EMA>;
  macdStream: InstanceType<typeof MACD>;
  adxStream: InstanceType<typeof ADX>;
  atrStream: InstanceType<typeof ATR>;

  // Cached values for crossover detection (need current + previous)
  fastEmaValues: number[];
  slowEmaValues: number[];
  macdHistValues: number[];
  adxValues: number[];
  atrValues: number[];

  processedBars: number;
}
```

#### Step 3: Define Strategy Metadata and Parameters

```typescript
const emaMacdTrendMomentum: Strategy = {
  name: 'ema-macd-trend-momentum',
  description: 'Trend-following strategy using EMA crossover with MACD momentum confirmation and ADX trend strength filter. Uses ATR trailing stop for dynamic exits.',
  version: '1.0.0',

  params: [
    {
      name: 'fastEmaPeriod',
      label: 'Fast EMA Period',
      type: 'number',
      default: 9,
      min: 5,
      max: 15,
      step: 2,
      description: 'Fast EMA period for crossover signal',
    },
    {
      name: 'slowEmaPeriod',
      label: 'Slow EMA Period',
      type: 'number',
      default: 21,
      min: 15,
      max: 35,
      step: 5,
      description: 'Slow EMA period for crossover signal',
    },
    {
      name: 'macdFastPeriod',
      label: 'MACD Fast Period',
      type: 'number',
      default: 12,
      min: 8,
      max: 16,
      step: 4,
      description: 'MACD fast EMA period',
    },
    {
      name: 'macdSlowPeriod',
      label: 'MACD Slow Period',
      type: 'number',
      default: 26,
      min: 20,
      max: 30,
      step: 5,
      description: 'MACD slow EMA period',
    },
    {
      name: 'macdSignalPeriod',
      label: 'MACD Signal Period',
      type: 'number',
      default: 9,
      min: 5,
      max: 12,
      step: 1,
      description: 'MACD signal line period',
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
      default: 60,
      min: 30,
      max: 90,
      step: 15,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish crossovers',
    },
  ],
```

#### Step 4: Implement init() Hook

```typescript
  init(context: StrategyContext): void {
    const { params } = context;
    const fastEmaPeriod = params.fastEmaPeriod as number;
    const slowEmaPeriod = params.slowEmaPeriod as number;
    const macdFastPeriod = params.macdFastPeriod as number;
    const macdSlowPeriod = params.macdSlowPeriod as number;
    const macdSignalPeriod = params.macdSignalPeriod as number;
    const adxPeriod = params.adxPeriod as number;
    const atrPeriod = params.atrPeriod as number;

    // Validate parameter constraints
    if (fastEmaPeriod >= slowEmaPeriod) {
      throw new Error(
        `Fast EMA period (${fastEmaPeriod}) must be less than Slow EMA period (${slowEmaPeriod})`
      );
    }

    // Initialize streaming indicator instances
    const state: IndicatorState = {
      fastEmaStream: new EMA({ period: fastEmaPeriod, values: [] }),
      slowEmaStream: new EMA({ period: slowEmaPeriod, values: [] }),
      macdStream: new MACD({
        fastPeriod: macdFastPeriod,
        slowPeriod: macdSlowPeriod,
        signalPeriod: macdSignalPeriod,
        SimpleMAOscillator: false, // Use EMA
        SimpleMASignal: false, // Use EMA for signal
        values: [],
      }),
      adxStream: new ADX({ period: adxPeriod, high: [], low: [], close: [] }),
      atrStream: new ATR({ period: atrPeriod, high: [], low: [], close: [] }),

      fastEmaValues: [],
      slowEmaValues: [],
      macdHistValues: [],
      adxValues: [],
      atrValues: [],

      processedBars: 0,
    };

    (this as any)._state = state;

    // Position tracking state
    (this as any)._entryBar = 0;
    (this as any)._trailingStop = 0;
    (this as any)._isLong = false;

    context.log(
      `Initialized EMA-MACD Trend Momentum (streaming): FastEMA(${fastEmaPeriod}), SlowEMA(${slowEmaPeriod}), MACD(${macdFastPeriod}/${macdSlowPeriod}/${macdSignalPeriod}), ADX(${adxPeriod})>=${params.adxThreshold}, Trail=${params.trailMultiplier}x ATR`
    );
  },
```

#### Step 5: Implement onBar() Hook

This is the main trading logic. CRITICAL: uses streaming indicators for O(n) performance.

```typescript
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
    const adxThreshold = params.adxThreshold as number;
    const trailMultiplier = params.trailMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;

    const currentPrice = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;

    // --- Feed current candle to all streaming indicators (O(1) per indicator) ---

    // Fast EMA
    const fastEma = state.fastEmaStream.nextValue(currentPrice);
    if (fastEma !== undefined) {
      state.fastEmaValues.push(fastEma);
    }

    // Slow EMA
    const slowEma = state.slowEmaStream.nextValue(currentPrice);
    if (slowEma !== undefined) {
      state.slowEmaValues.push(slowEma);
    }

    // MACD
    const macdVal = state.macdStream.nextValue(currentPrice);
    if (macdVal && macdVal.histogram !== undefined) {
      state.macdHistValues.push(macdVal.histogram);
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
      state.fastEmaValues.length < 2 ||
      state.slowEmaValues.length < 2 ||
      state.macdHistValues.length < 2 ||
      state.adxValues.length < 1 ||
      state.atrValues.length < 1
    ) {
      return;
    }

    // --- Read current and previous indicator values ---
    const currentFastEma = state.fastEmaValues[state.fastEmaValues.length - 1];
    const prevFastEma = state.fastEmaValues[state.fastEmaValues.length - 2];
    const currentSlowEma = state.slowEmaValues[state.slowEmaValues.length - 1];
    const prevSlowEma = state.slowEmaValues[state.slowEmaValues.length - 2];
    const currentMacdHist = state.macdHistValues[state.macdHistValues.length - 1];
    const prevMacdHist = state.macdHistValues[state.macdHistValues.length - 2];
    const currentAdx = state.adxValues[state.adxValues.length - 1];
    const currentAtr = state.atrValues[state.atrValues.length - 1];

    // Detect crossovers
    const bullishCrossover = prevFastEma <= prevSlowEma && currentFastEma > currentSlowEma;
    const bearishCrossover = prevFastEma >= prevSlowEma && currentFastEma < currentSlowEma;

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

      // 2. EMA Re-Cross (bearish crossover while long)
      if (bearishCrossover) {
        context.log(`EMA RE-CROSS EXIT: Fast EMA crossed below Slow EMA`);
        context.closeLong();
        return;
      }

      // 3. MACD Momentum Exit (histogram turns negative)
      if (currentMacdHist < 0 && prevMacdHist >= 0) {
        context.log(`MACD MOMENTUM EXIT: Histogram crossed below zero (${currentMacdHist.toFixed(2)})`);
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

      // 2. EMA Re-Cross
      if (bullishCrossover) {
        context.log(`EMA RE-CROSS EXIT (SHORT): Fast EMA crossed above Slow EMA`);
        context.closeShort();
        return;
      }

      // 3. MACD Momentum Exit (histogram turns positive)
      if (currentMacdHist > 0 && prevMacdHist <= 0) {
        context.log(`MACD MOMENTUM EXIT (SHORT): Histogram crossed above zero`);
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

    if (!longPosition && !shortPosition) {
      // Check ADX trend strength
      const hasTrendStrength = currentAdx >= adxThreshold;

      // LONG ENTRY: Bullish EMA crossover + positive MACD histogram + ADX strength
      if (bullishCrossover && currentMacdHist > 0 && hasTrendStrength) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: EMA bullish crossover, MACD hist=${currentMacdHist.toFixed(2)} > 0, ADX=${currentAdx.toFixed(1)} >= ${adxThreshold}`
          );
          (this as any)._entryBar = currentIndex;
          (this as any)._trailingStop = currentPrice - currentAtr * trailMultiplier;
          (this as any)._isLong = true;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY: Bearish EMA crossover + negative MACD histogram + ADX strength
      if (enableShorts && bearishCrossover && currentMacdHist < 0 && hasTrendStrength) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: EMA bearish crossover, MACD hist=${currentMacdHist.toFixed(2)} < 0, ADX=${currentAdx.toFixed(1)} >= ${adxThreshold}`
          );
          (this as any)._entryBar = currentIndex;
          (this as any)._trailingStop = currentPrice + currentAtr * trailMultiplier;
          (this as any)._isLong = false;
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

export default emaMacdTrendMomentum;
```

#### Important Implementation Notes

1. **Streaming indicators**: All indicators use the `nextValue()` API from `technicalindicators`. Each indicator is instantiated in `init()` with empty arrays and stored on `this`. On every `onBar()` call, `nextValue()` is called with the current candle data. Results accumulate in arrays for crossover detection (which needs current + previous values).

2. **MACD streaming**: The MACD class accepts `values: []` in constructor and returns `{ MACD, signal, histogram }` from `nextValue(close)`. The histogram is the key signal: positive = bullish momentum, negative = bearish.

3. **ADX streaming**: The ADX class accepts `{ high: [], low: [], close: [] }` in constructor and returns `{ adx, pdi, mdi }` from `nextValue({ high, low, close })`. We only use the `adx` value for trend strength filtering.

4. **ATR streaming**: The ATR class accepts `{ high: [], low: [], close: [] }` and returns a single number from `nextValue({ high, low, close })`.

5. **Trailing stop logic**: The trailing stop is initialized at entry and updated EVERY bar. For longs, it only moves up (ratchet up). For shorts, it only moves down. The current ATR is used each bar for the trail distance calculation, making it adaptive to changing volatility.

6. **Crossover detection**: We compare current vs previous EMA values to detect the exact bar where the crossover occurs. This requires storing at least 2 values for each EMA.

7. **MACD confirmation**: We require the MACD histogram to be positive for long entries and negative for short entries. This is checked on the SAME bar as the crossover, ensuring momentum alignment at the moment of entry.

8. **ADX threshold**: Set at 20 by default (lower than the typical 25) to increase trade frequency. This still filters out the weakest, most choppy markets while allowing more trade signals.

9. **State arrays grow unboundedly**: Since we push to arrays every bar, they grow throughout the backtest. For very long backtests (10,000+ bars), consider trimming arrays to only keep the last 2 values. However, for typical 6-month to 2-year backtests on 4h (750-4380 bars), this is not a concern.

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates successfully:
  ```bash
  npx tsx src/cli/quant-validate.ts strategies/ema-macd-trend-momentum.ts
  ```
- [ ] Quick backtest runs and generates 30+ trades:
  ```bash
  npx tsx src/cli/quant-backtest.ts --strategy=ema-macd-trend-momentum --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 --timeframe=4h
  ```
- [ ] Trailing stop moves only in favorable direction
- [ ] All entry/exit conditions implemented correctly
- [ ] Proper handling of edge cases (insufficient data, undefined values)
- [ ] Streaming indicators used (no batch recalculation in onBar)

---

#### Edge Cases to Handle

1. **Insufficient Data**: Streaming indicators return `undefined` during warmup. Check ALL arrays have minimum 2 entries before trading.
2. **MACD warmup**: MACD requires `slowPeriod + signalPeriod` bars before producing output. This is the longest warmup period.
3. **ADX warmup**: ADX requires approximately `2 * period` bars. Handled by checking array length.
4. **Division by Zero**: Validate `currentPrice > 0` and `amount > 0` before opening positions.
5. **Concurrent Positions**: Ensure only one position (long OR short) at a time.
6. **Trailing stop initialization**: Must set trailing stop BEFORE opening position to avoid uninitialized state.
7. **Short trailing stop direction**: For shorts, trailing stop STARTS ABOVE current price and moves DOWN. Initialize correctly: `currentPrice + ATR * multiplier`.

---

#### Testing Instructions

```bash
# 1. Validate strategy file
npx tsx src/cli/quant-validate.ts strategies/ema-macd-trend-momentum.ts

# 2. Quick backtest on BTC (target: 30+ trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 3. Test with faster EMA (more trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h \
  --param.fastEmaPeriod=5 \
  --param.slowEmaPeriod=15

# 4. Test with lower ADX threshold (more trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h \
  --param.adxThreshold=15

# 5. Test on ETH
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=ETH/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 6. Test on SOL (higher volatility, should produce more trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=SOL/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 7. Walk-forward test
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=ema-macd-trend-momentum \
  --symbol=BTC/USDT \
  --from=2023-01-01 \
  --to=2024-12-31 \
  --timeframe=4h \
  --train-ratio=0.7 \
  --optimize-for=sharpeRatio \
  --max-combinations=500

# 8. Multi-asset validation
npx tsx src/cli/quant-multi-asset.ts \
  --strategy=ema-macd-trend-momentum \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT,XRP/USDT,BNB/USDT,DOGE/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=4h

# 9. Longs-only test
npx tsx src/cli/quant-backtest.ts \
  --strategy=ema-macd-trend-momentum \
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

**Trade Frequency (CRITICAL)**:
- Expected Trades per 6-month period (4h): **30-60 trades** (target: 50+)
- EMA(9/21) crosses approximately 8-15 times per month on BTC 4h
- After MACD + ADX filtering, approximately 5-10 qualified entries per month
- With shorts enabled, approximately 8-12 total entries per month

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.2
- Target Win Rate: 40-55% (trend-following has lower win rate but higher avg win)
- Target Total Return: 30-80% annually
- Max Acceptable Drawdown: < 20%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.7
- Target OOS Degradation: < 30%
- Target Win Rate: 35-50%
- Max Acceptable Drawdown: < 25%

**Trading Activity**:
- Average Trade Duration: 5-20 bars (20-80 hours on 4h)
- Typical Position Size: 95% of capital

**Multi-Asset Performance**:
- Expected Pass Rate: 50-70% of tested assets
- Works Best On: Trending large-cap pairs (BTC, ETH, SOL)
- May Struggle On: Very low-volume altcoins or stablecoins

---

## References

**Academic Papers**:

1. "Catching Crypto Trends: A Tactical Approach for Bitcoin and Altcoins", Carlo Zarattini, Alberto Pagani, Andrea Barbon, SSRN, May 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5209907
   - Key Finding: Ensemble Donchian-based trend following on crypto achieves Sharpe > 1.5 and annualized alpha of 10.8%, net of fees, on top 20 most liquid coins.

2. "Quantitative Evaluation of Volatility-Adaptive Trend-Following Models in Cryptocurrency Markets", Karassavidis, Kateris & Ioannidis, SSRN, November 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5821842
   - Key Finding: Volatility-adjusted, momentum-confirmed trend-following systems generate statistically and economically significant excess returns in crypto.

3. "Revisiting Trend-following and Mean-Reversion Strategies in Bitcoin", Beluska & Vojtko, SSRN, 2024
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4955617
   - Key Finding: Trend-following in BTC works especially well at price maxima. Confirmed from Nov 2015 to Aug 2024.

4. "Technical Analysis Meets Machine Learning: Bitcoin Evidence", arXiv, November 2025
   - URL: https://arxiv.org/html/2511.00665v1
   - Key Finding: MACD+ADX strategy outperformed pure EMA crossover on Bitcoin 2021-2024.

5. "Adaptive Optimization of a Dual Moving Average Strategy for Automated Cryptocurrency Trading", MDPI Mathematics, August 2025
   - URL: https://www.mdpi.com/2227-7390/13/16/2629
   - Key Finding: Dual SMA/EMA strategies remain effective for crypto with proper optimization across rolling windows.

**Industry Research**:

1. "The Trend is Your Friend: Managing Bitcoin's Volatility with Momentum Signals", Grayscale Research
   - URL: https://research.grayscale.com/reports/the-trend-is-your-friend-managing-bitcoins-volatility-with-momentum-signals
   - Key Finding: 20d/100d MA crossover on BTC produces annualized Sharpe of 1.7, outperforming buy-and-hold Sharpe of 1.3.

2. "Rolling Backtest of an EMA Crossover Trading Strategy with MACD, ADX, and Trailing Stops", PyQuantLab, Medium, June 2025
   - URL: https://pyquantlab.medium.com/rolling-backtest-of-an-ema-crossover-trading-strategy-with-macd-adx-and-trailing-stops-ddccbf5c19df
   - Summary: EmaMacdAdxStrategy with trailing stops showed robust performance across rolling backtests on crypto assets.

3. "EMA and ADX Strategy: Simple, Accurate, and Profitable", Mirapip, February 2024
   - URL: https://mirapip.com/ema-and-adx-strategy/
   - Summary: EMA + ADX combination achieved 82% profit in one month on XAU/USD 1H.

4. "MACD and ADX strategy: how to ride the trend", ForexTester
   - URL: https://forextester.com/blog/macd-adx-strategy/
   - Summary: MACD + ADX combination produces fewer but higher-quality signals than MACD alone.

**Similar Strategies**:

1. EmaMacdAdxStrategy (PyQuantLab)
   - Similarities: Uses EMA crossover + MACD + ADX + trailing stops.
   - Differences: Our version uses separate fast/slow EMA crossover instead of single EMA, adds time-based exit, uses MACD histogram sign change as independent exit.

2. Triple EMA Crossover with RSI and Volume (Medium/Sword Red)
   - Similarities: Multiple indicator confluence for trend entry.
   - Differences: Uses three EMAs instead of two, RSI instead of MACD, volume instead of ADX.

---

## Change Log

**Version 1.0** - 2026-02-03
- Initial specification
- Based on EMA crossover + MACD histogram + ADX trend strength with ATR trailing stop
- Designed for HIGH TRADE FREQUENCY (30-60+ trades per 6 months on 4h)
- Includes comprehensive parameter ranges for grid search optimization
- Full implementation prompt with streaming indicator approach and testing instructions

---

## Notes

1. **Trade frequency focus**: This strategy was specifically designed to generate MORE trades than the Volatility Squeeze Breakout (which averaged ~10-20 trades per 6 months) and far more than the discarded Adaptive RSI Mean Reversion (3-8 trades). The EMA crossover is a naturally high-frequency signal generator, and the MACD/ADX filters are configured to be permissive enough to maintain 30-60+ trades per 6-month period.

2. **ADX threshold set lower than typical**: The default ADX threshold of 20 (vs the typical 25) is intentional. This produces more signals while still filtering out the most choppy, directionless periods. The MACD histogram provides additional filtering on top of ADX.

3. **Trailing stop vs fixed stop**: Unlike the squeeze breakout strategy which uses fixed ATR stops, this strategy uses a trailing stop that updates every bar. This is more appropriate for trend-following where the goal is to ride trends as long as they persist, not to take fixed profit targets.

4. **Win rate expectations**: Trend-following strategies typically have win rates of 35-50%, which is lower than mean reversion (60-80%). The edge comes from average winning trades being significantly larger than average losing trades (high profit factor). The trailing stop enables this by letting winners run while cutting losers quickly.

5. **Complementary to squeeze breakout**: While both are trend-oriented, they trigger on different market conditions. The squeeze breakout fires on volatility compression-to-expansion transitions (event-driven). The EMA-MACD strategy fires on sustained directional movement (continuous). They would often take different trades, making them potentially complementary in a portfolio.

---

**END OF SPECIFICATION**
