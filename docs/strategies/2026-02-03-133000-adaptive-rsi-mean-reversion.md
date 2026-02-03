# Strategy: Adaptive RSI Mean Reversion with Regime Filter

> **Created**: 2026-02-03 13:30
> **Author**: quant-lead agent
> **Status**: Draft

## Executive Summary

The Adaptive RSI Mean Reversion strategy exploits short-term oversold and overbought conditions in cryptocurrency markets using ultra-sensitive RSI(2) readings combined with Bollinger Band extremes, filtered by an ADX regime detector that suppresses signals during strong trends. Based on Larry Connors' extensively backtested RSI(2) framework (75%+ win rate on equities) and adapted for crypto's higher volatility, this strategy buys when price is deeply oversold at Bollinger Band lower extremes in range-bound markets, and exits on mean reversion to the middle band.

---

## Hypothesis

Cryptocurrency markets exhibit strong short-term mean-reverting behavior after extreme price dislocations. When price drops sharply over 1-2 bars, the RSI(2) plunges to single-digit readings, indicating an extreme oversold condition that statistically precedes a bounce. This effect is amplified when price simultaneously touches or breaches the lower Bollinger Band, confirming the move is statistically extreme (beyond 2 standard deviations from the mean).

However, this edge disappears during strong trending markets where "oversold" conditions persist and deepen. The critical innovation is the ADX regime filter: when ADX is above a threshold (indicating strong trend), the strategy stays flat, avoiding the primary failure mode of mean reversion strategies.

**Core Edge**: Ultra-short-term RSI(2) detects extreme oversold/overbought conditions with high sensitivity. The 2-period RSI oscillator was extensively tested by Larry Connors and Cesar Alvarez across thousands of stocks and decades of data, consistently showing 70-91% win rates. In crypto, the effect is amplified because emotional retail traders create larger overshoots that revert faster.

**Why This Edge Persists**:
1. **Behavioral**: Panic selling and FOMO buying create systematic overshoots. Retail-dominated crypto markets exhibit stronger behavioral biases than institutional equity markets.
2. **Structural**: Liquidation cascades in leveraged crypto markets create artificial price dislocations that quickly revert once the liquidation pressure subsides.
3. **Information asymmetry**: Short-term dislocations often reflect noise rather than fundamental changes. The 2-bar lookback captures noise-driven moves that revert within days.
4. **Regime filtering**: Most mean reversion strategies fail because they trade during trends. The ADX filter removes this failure mode, dramatically improving risk-adjusted returns (PyQuantLab: profits increased from $48K to $131K with ADX/ATR filtering).

**Market Conditions**:
- **Works best**: Range-bound/consolidating markets, markets with frequent short-term pullbacks within broader ranges, post-crash bounce scenarios.
- **Works moderately**: Mildly trending markets with periodic pullbacks (the ADX filter will reduce but not eliminate signals).
- **Fails**: Extended parabolic trends (but the ADX filter should suppress most signals during these periods). Also fails in flash crash scenarios where price continues falling through stops.

**Academic/Empirical Backing**:
- Connors & Alvarez (2008) demonstrated RSI(2) < 5 produced average returns of 0.92% per trade with 88% win rate on S&P 500 stocks.
- Beluska & Vojtko (2024, SSRN) confirmed mean-reversion works in Bitcoin after sharp drawdowns, particularly using 10-50 day lookback minimum price strategies.
- Arda (2025, SSRN) showed Bollinger Band mean-reversion regained profitability in BTC during accumulation/range-bound phases.
- Stochastic Patterns of Bitcoin Volatility (MDPI, 2024) confirmed RSI is effective for detecting overbought/oversold conditions tied to mean reversion in Bitcoin.
- PyQuantLab (2025) demonstrated RSI mean-reversion with ADX+ATR filters increased profits from $48K to $131K on crypto.
- Quantitativo (2024) showed cumulative RSI improved Sharpe from 1.05 to 1.18 over vanilla RSI(2).

---

## Classification

**Style**: meanReversion

**Holding Period**: intraday to swing (hours to a few days on 1h chart; typically 3-15 bars)

**Complexity**: Single-TF single-asset (simplest implementation)

**Market Type**: spot

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 1h

**Purpose**: Main signal generation, entry timing, position management.

**Rationale**: Mean reversion in crypto works best on shorter timeframes where noise-driven dislocations are most pronounced. The 1h timeframe provides the best balance between signal frequency and signal quality for RSI(2) mean reversion. Research on RSI(2) shows that 15m-1h produces the most trades with acceptable win rates in crypto. The 4h timeframe produces too few RSI(2) signals (the 2-bar lookback on 4h only captures 8h of price action, which is too coarse). The 1h timeframe gives ~6-12 trades per month on BTC, providing statistical significance for walk-forward testing.

### Secondary Timeframes

None required for base implementation.

---

## Asset Configuration

### Primary Asset

**Asset**: BTC/USDT

**Why This Asset**: Most liquid crypto pair, strongest mean-reverting characteristics after extreme moves, deepest order book minimizes slippage on quick reversals, longest available data history.

### Signal Assets

None required (single-asset strategy).

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| BTC/USDT | Large cap | Most liquid, primary development target |
| ETH/USDT | Large cap | Second most liquid, tests generalizability |
| SOL/USDT | Mid cap | Higher volatility, more frequent extreme RSI readings |
| BNB/USDT | Large cap | Exchange token, different dynamics |
| DOGE/USDT | Meme/speculative | Very high volatility, stress test for mean reversion |

**Generalizability Expectation**: Should work on all liquid pairs. Mean reversion after extreme moves is a universal behavioral phenomenon amplified in crypto. May struggle on very low-volume altcoins where spreads eat into the small per-trade returns. Expected pass rate: 50-70% across test assets.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| RSI | 1h | Core signal - extreme oversold/overbought detection | period: 2 | Ultra-short period for high sensitivity (Connors RSI2) |
| BollingerBands | 1h | Statistical extreme confirmation | period: 20, stdDev: 2.0 | Price at/below lower band confirms extreme |
| ADX | 1h | Regime filter - suppress signals during trends | period: 14 | ADX < threshold = range-bound (safe for mean reversion) |
| SMA | 1h | Trend direction filter | period: 200 | Only go long above SMA(200), short below |
| ATR | 1h | Dynamic stop loss calculation | period: 14 | Risk management |

### Additional Data Requirements

None. Strategy operates purely on OHLCV data.

### Data Preprocessing

- **Cumulative RSI(2) calculation**: Sum the last N bars of RSI(2) values. This provides a smoother, more reliable oversold/overbought signal than a single RSI(2) reading. For example, if RSI(2) was 8, 5, and 3 over the last 3 bars, cumulative RSI = 16. Entry is triggered when cumulative RSI drops below a threshold (default: 10 for 2-bar cumulative).
- **ADX regime classification**: ADX below threshold (default: 25) indicates range-bound market suitable for mean reversion. ADX above threshold indicates trending market where mean reversion is dangerous.

---

## Entry Logic

### Long Entry Conditions

**ALL of the following must be true:**

1. **Regime Filter (Range-bound)**: ADX(14) < adxThreshold (default: 25).
   - This ensures the market is NOT in a strong trend, where mean reversion fails.
   - Timeframe: 1h

2. **Trend Direction Filter (Bullish Bias)**: Current close > SMA(200).
   - Only take long positions when the broad trend is up. This prevents buying into sustained downtrends.
   - Timeframe: 1h

3. **Extreme Oversold (RSI)**: Cumulative RSI(2) over the last `cumulativeBars` bars < `rsiOversoldThreshold`.
   - Default: cumulative RSI(2) over 2 bars < 10 (meaning average RSI per bar < 5).
   - This is the primary signal: price has been deeply oversold for multiple consecutive bars.
   - Timeframe: 1h

4. **Bollinger Band Confirmation**: Current close <= lower Bollinger Band(20, 2.0).
   - Price must be at or below the lower Bollinger Band, confirming the move is statistically extreme (beyond 2 standard deviations from the mean).
   - Timeframe: 1h

**Position Sizing**:
- Formula: `positionSize = (equity * 0.95) / currentPrice`
- Standard 95% of available balance, no volatility adjustment for base version.

### Short Entry Conditions

**ALL of the following must be true:**

1. **Regime Filter (Range-bound)**: ADX(14) < adxThreshold (default: 25).

2. **Trend Direction Filter (Bearish Bias)**: Current close < SMA(200).
   - Only take short positions when the broad trend is down.

3. **Extreme Overbought (RSI)**: Cumulative RSI(2) over the last `cumulativeBars` bars > `rsiOverboughtThreshold`.
   - Default: cumulative RSI(2) over 2 bars > 190 (meaning average RSI per bar > 95).

4. **Bollinger Band Confirmation**: Current close >= upper Bollinger Band(20, 2.0).
   - Price must be at or above the upper Bollinger Band, confirming statistical extreme.

**Position Sizing**: Same as long.

### Entry Examples

**Example 1**: Bullish Mean Reversion Entry
- Date: 2024-04-15, Time: 14:00 (1h candle close)
- BTC price: $62,500
- ADX(14) = 18 (below 25, range-bound: OK)
- SMA(200) = $60,000, close $62,500 > $60,000 (bullish bias: OK)
- RSI(2) current bar = 3.2, RSI(2) previous bar = 6.1, cumulative = 9.3 (below 10: OVERSOLD)
- BB lower band = $62,800, close $62,500 < $62,800 (below lower BB: CONFIRMED)
- **Action**: Open long, amount = ($9,500 * 0.95) / $62,500 = 0.1444 BTC

**Example 2**: Bearish Mean Reversion Entry
- Date: 2024-05-20, Time: 08:00 (1h candle close)
- BTC price: $71,000
- ADX(14) = 21 (below 25: OK)
- SMA(200) = $72,500, close $71,000 < $72,500 (bearish bias: wait... this means we would NOT short here since close < SMA(200) but the trend is down. Actually, in this case close < SMA(200) means bearish bias is confirmed.)
- RSI(2) current bar = 97, RSI(2) previous bar = 94, cumulative = 191 (above 190: OVERBOUGHT)
- BB upper band = $70,800, close $71,000 > $70,800 (above upper BB: CONFIRMED)
- **Action**: Open short, amount = ($9,500 * 0.95) / $71,000 = 0.1271 BTC

---

## Exit Logic

### Stop Loss

**Type**: ATR-based dynamic stop loss.

**Calculation**:
- `stopPrice_long = entryPrice - (ATR * atrStopMultiplier)`
- `stopPrice_short = entryPrice + (ATR * atrStopMultiplier)`
- Default `atrStopMultiplier`: 2.5

**Adjustment**: Stop is set at entry time using the ATR value at entry. It does NOT trail. This wider stop (2.5x ATR vs typical 2.0x) accounts for the fact that mean reversion entries are at extreme levels where additional volatility is expected before the reversion begins.

### Take Profit

**Type**: Bollinger Band middle band (mean reversion target).

**Calculation**:
- `takeProfitPrice_long = BB_middle` (current value, checked each bar)
- `takeProfitPrice_short = BB_middle` (current value, checked each bar)
- The middle Bollinger Band IS the "mean" we are reverting to. This is the natural take-profit for mean reversion.

**Rationale**: The entire premise of the strategy is that price will revert to the mean. The BB middle band (20-period SMA) is the mean. Exiting at the mean captures the reversion move without waiting for an overshoot that may not come.

### Signal-Based Exit (RSI Normalization)

**Exit Trigger**:
- For longs: Exit when RSI(2) crosses above `rsiExitThreshold` (default: 65).
- For shorts: Exit when RSI(2) crosses below `rsiExitThresholdShort` (default: 35).

**Rationale**: RSI(2) returning to the 65-70 range indicates the extreme oversold condition has resolved. The reversion may or may not reach the BB middle band, but the momentum of the bounce is fading. This exit captures most of the reversion move.

**Priority**: Stop loss > BB middle band take profit > RSI normalization exit > Time-based exit (checked in this order each bar).

### Time-Based Exit

**Max Holding Period**: 12 bars (12 hours on 1h chart).

**Rationale**: Mean reversion trades are short-duration by nature. If price hasn't reverted within 12 hours, the "extreme" reading was likely the start of a trend, not a temporary dislocation. Connors' research showed the average holding period for RSI(2) trades is 3-4 bars. 12 bars provides ample time while preventing capital from being trapped.

### Exit Examples

**Example 1**: BB Middle Band Take Profit
- Entry: $62,500 long
- After 5 bars, BB middle band = $63,800, current price = $63,900
- Price crosses above BB middle band
- **Action**: Exit at $63,800, Profit: +2.1%

**Example 2**: RSI Normalization Exit
- Entry: $62,500 long
- After 3 bars, RSI(2) = 68 (crossed above 65), price = $63,200
- **Action**: Exit at $63,200, Profit: +1.1%

**Example 3**: Stop Loss Exit
- Entry: $62,500 long, ATR = $400, stop = $62,500 - ($400 * 2.5) = $61,500
- Price drops to $61,400
- **Action**: Exit at $61,500, Loss: -1.6%

**Example 4**: Time-Based Exit
- Entry: $62,500 long
- After 12 bars (12 hours), price = $62,700
- **Action**: Exit at $62,700, Profit: +0.3%

---

## Risk Management

### Position Sizing

**Method**: Fixed percentage of available capital.

**Base Size**: 95% of available balance per trade.

**Volatility Adjustment**: None in base version.

### Per-Trade Risk

**Max Risk Per Trade**: Approximately 1.6-2.5% of equity (determined by ATR stop distance at 2.5x ATR). On BTC 1h, typical ATR is ~0.3-0.5% of price, so 2.5x ATR = ~0.75-1.25% stop distance. With 95% capital deployment, max risk is ~0.7-1.2% of equity.

### Portfolio Risk

**Max Drawdown Limit**: Not implemented at portfolio level (single-position strategy).

**Max Concurrent Positions**: 1 (either long or short, never both).

### Leverage

**Max Leverage**: 1x (spot only).

**Rationale**: Mean reversion strategies have high win rates but occasional large losses. Leverage amplifies the losses disproportionately. The edge comes from consistency, not magnitude.

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| rsiPeriod | number | 2 | 4 | 1 | 2 | RSI calculation period (2 = classic Connors) |
| cumulativeBars | number | 2 | 4 | 1 | 2 | Number of RSI bars to sum for cumulative RSI |
| rsiOversoldThreshold | number | 5 | 20 | 5 | 10 | Cumulative RSI threshold for oversold entry |
| rsiOverboughtThreshold | number | 180 | 195 | 5 | 190 | Cumulative RSI threshold for overbought entry |
| rsiExitThreshold | number | 55 | 75 | 5 | 65 | RSI level for long exit (normalization) |
| bbPeriod | number | 15 | 25 | 5 | 20 | Bollinger Band period |
| bbStdDev | number | 1.5 | 2.5 | 0.5 | 2.0 | Bollinger Band standard deviation |
| adxPeriod | number | 10 | 20 | 5 | 14 | ADX calculation period |
| adxThreshold | number | 20 | 35 | 5 | 25 | ADX threshold for regime filter |
| smaPeriod | number | 100 | 200 | 50 | 200 | SMA trend filter period |
| atrPeriod | number | 10 | 20 | 5 | 14 | ATR period for stop loss |
| atrStopMultiplier | number | 1.5 | 3.5 | 0.5 | 2.5 | ATR multiplier for stop loss |
| maxHoldBars | number | 8 | 20 | 4 | 12 | Maximum bars to hold a position |
| enableShorts | boolean | - | - | - | false | Enable short positions |

**Parameter Dependencies**:
- `rsiOverboughtThreshold` should be `200 - rsiOversoldThreshold` approximately (symmetric), though they can be optimized independently.
- `rsiExitThreshold` must be > `rsiOversoldThreshold / cumulativeBars` to ensure exit occurs after entry conditions have resolved.

**Optimization Notes**:
- Most sensitive parameters: `rsiOversoldThreshold` (controls signal selectivity), `adxThreshold` (controls regime filter strictness), and `atrStopMultiplier` (risk management).
- Connors' research suggests RSI period of 2 is optimal -- periods 3 and 4 produce fewer but potentially higher-quality signals.
- ADX threshold of 20-25 is widely cited as the optimal range for filtering trending markets.
- BB period of 20 and stdDev of 2.0 are standard -- optimization around these values is incremental.
- Start with `enableShorts=false` since mean reversion longs (buying dips) tend to outperform shorts (selling rallies) in crypto due to the long-term upward bias.

**Total combinations**: 3 * 3 * 4 * 4 * 5 * 3 * 3 * 3 * 4 * 3 * 3 * 5 * 4 * 2 = ~4.7M. With max-combinations=500, the optimizer will sample effectively.

---

## System Gaps

### Required Extensions

**None**. The strategy can be fully implemented with existing system capabilities:
- `RSI`, `BollingerBands`, `ADX`, `SMA`, `ATR` are all available in `technicalindicators@3.1.0`.
- Cumulative RSI is a simple summation computed as a helper function.
- All entry/exit logic fits within the `onBar()` pattern.

### Workarounds

**For Cumulative RSI**: Since `technicalindicators` does not provide a cumulative RSI indicator, we implement it as a simple helper: maintain a rolling buffer of the last N RSI(2) values and sum them.

### Nice-to-Have Improvements

1. **Volatility-adjusted position sizing**: Scale position size inversely with ATR -- take smaller positions when volatility is elevated.
2. **Multi-timeframe trend filter**: Use a 4h or daily SMA instead of 1h SMA(200) for a more robust trend filter.
3. **Partial exits**: Exit 50% at RSI normalization, remaining 50% at BB middle band.
4. **Consecutive signal accumulation**: Add to position on subsequent oversold bars (Connors' "scaling in" approach).

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **Adaptive RSI Mean Reversion with Regime Filter** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy buys when price is deeply oversold (RSI(2) at extreme lows) at the lower Bollinger Band in range-bound markets (low ADX), and exits when price reverts to the mean (BB middle band) or RSI normalizes. An SMA(200) trend filter ensures we only buy dips in uptrends and sell rallies in downtrends.

This strategy:
- Trades on **1h** timeframe
- Uses **RSI(2), BollingerBands, ADX, SMA(200), ATR**
- Entry: When cumulative RSI(2) is extremely oversold AND price is at/below lower BB AND ADX shows range-bound market AND price is above SMA(200)
- Exit: Price reaches BB middle band (mean), RSI normalizes above 65, ATR-based stop loss, or time-based exit
- Risk: 2.5x ATR stop loss, 95% capital deployment, 12-bar max hold

---

#### System Extensions Required

**NONE**. All required indicators are available. Proceed directly to strategy implementation.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/adaptive-rsi-mean-reversion.ts`

#### Step 1: Imports and Setup

```typescript
import { RSI, BollingerBands, ADX, SMA, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';
```

#### Step 2: Helper Functions

Implement these helper functions BEFORE the strategy object. Use STREAMING/incremental indicator computation (`nextValue()` API) for O(n) performance:

```typescript
/**
 * Streaming RSI calculator using nextValue() for O(n) performance
 */
function createStreamingRSI(period: number) {
  const rsi = new RSI({ period, values: [] });
  return {
    nextValue(close: number): number | undefined {
      return rsi.nextValue(close);
    }
  };
}

/**
 * Streaming Bollinger Bands calculator
 */
function createStreamingBB(period: number, stdDev: number) {
  const bb = new BollingerBands({ period, stdDev, values: [] });
  return {
    nextValue(close: number): { upper: number; middle: number; lower: number; pb: number } | undefined {
      return bb.nextValue(close);
    }
  };
}

/**
 * Streaming ADX calculator
 */
function createStreamingADX(period: number) {
  const adx = new ADX({ period, high: [], low: [], close: [] });
  return {
    nextValue(high: number, low: number, close: number): { adx: number; pdi: number; mdi: number } | undefined {
      return adx.nextValue({ high, low, close });
    }
  };
}

/**
 * Streaming SMA calculator
 */
function createStreamingSMA(period: number) {
  const sma = new SMA({ period, values: [] });
  return {
    nextValue(close: number): number | undefined {
      return sma.nextValue(close);
    }
  };
}

/**
 * Streaming ATR calculator
 */
function createStreamingATR(period: number) {
  const atr = new ATR({ period, high: [], low: [], close: [] });
  return {
    nextValue(high: number, low: number, close: number): number | undefined {
      return atr.nextValue({ high, low, close });
    }
  };
}

/**
 * Circular buffer for tracking last N RSI values for cumulative RSI
 */
class CircularBuffer {
  private buffer: (number | undefined)[];
  private index: number;
  private size: number;
  private count: number;

  constructor(size: number) {
    this.buffer = new Array(size).fill(undefined);
    this.index = 0;
    this.size = size;
    this.count = 0;
  }

  push(value: number | undefined): void {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  sum(): number | undefined {
    if (this.count < this.size) return undefined;
    let total = 0;
    for (let i = 0; i < this.size; i++) {
      const val = this.buffer[i];
      if (val === undefined) return undefined;
      total += val;
    }
    return total;
  }

  latest(): number | undefined {
    const idx = (this.index - 1 + this.size) % this.size;
    return this.buffer[idx];
  }
}
```

#### Step 3: Define Strategy Metadata and Parameters

```typescript
const adaptiveRsiMeanReversion: Strategy = {
  name: 'adaptive-rsi-mean-reversion',
  description: 'Mean reversion strategy using ultra-sensitive RSI(2) with Bollinger Band confirmation, ADX regime filter, and SMA(200) trend filter. Buys extreme oversold dips in range-bound markets and exits on mean reversion.',
  version: '1.0.0',

  params: [
    {
      name: 'rsiPeriod',
      label: 'RSI Period',
      type: 'number',
      default: 2,
      min: 2,
      max: 4,
      step: 1,
      description: 'RSI calculation period (2 = classic Connors RSI2)',
    },
    {
      name: 'cumulativeBars',
      label: 'Cumulative Bars',
      type: 'number',
      default: 2,
      min: 2,
      max: 4,
      step: 1,
      description: 'Number of RSI bars to sum for cumulative RSI signal',
    },
    {
      name: 'rsiOversoldThreshold',
      label: 'RSI Oversold Threshold',
      type: 'number',
      default: 10,
      min: 5,
      max: 20,
      step: 5,
      description: 'Cumulative RSI threshold for oversold entry (lower = more selective)',
    },
    {
      name: 'rsiOverboughtThreshold',
      label: 'RSI Overbought Threshold',
      type: 'number',
      default: 190,
      min: 180,
      max: 195,
      step: 5,
      description: 'Cumulative RSI threshold for overbought short entry',
    },
    {
      name: 'rsiExitThreshold',
      label: 'RSI Exit Threshold',
      type: 'number',
      default: 65,
      min: 55,
      max: 75,
      step: 5,
      description: 'RSI(2) level for long exit (normalization)',
    },
    {
      name: 'bbPeriod',
      label: 'BB Period',
      type: 'number',
      default: 20,
      min: 15,
      max: 25,
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
      name: 'adxPeriod',
      label: 'ADX Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ADX calculation period for regime detection',
    },
    {
      name: 'adxThreshold',
      label: 'ADX Threshold',
      type: 'number',
      default: 25,
      min: 20,
      max: 35,
      step: 5,
      description: 'ADX below this = range-bound (safe for mean reversion)',
    },
    {
      name: 'smaPeriod',
      label: 'SMA Period',
      type: 'number',
      default: 200,
      min: 100,
      max: 200,
      step: 50,
      description: 'SMA period for trend direction filter',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for stop loss calculation',
    },
    {
      name: 'atrStopMultiplier',
      label: 'ATR Stop Multiplier',
      type: 'number',
      default: 2.5,
      min: 1.5,
      max: 3.5,
      step: 0.5,
      description: 'ATR multiplier for stop loss distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 12,
      min: 8,
      max: 20,
      step: 4,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: false,
      description: 'Enable short positions on overbought signals',
    },
  ],
```

#### Step 4: Implement init() Hook

```typescript
  init(context: StrategyContext): void {
    const { params } = context;
    const rsiPeriod = params.rsiPeriod as number;
    const cumulativeBars = params.cumulativeBars as number;
    const rsiOversoldThreshold = params.rsiOversoldThreshold as number;
    const bbPeriod = params.bbPeriod as number;
    const adxPeriod = params.adxPeriod as number;
    const adxThreshold = params.adxThreshold as number;
    const smaPeriod = params.smaPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;

    // Initialize streaming indicators (stored on strategy object)
    (this as any)._rsi = createStreamingRSI(rsiPeriod);
    (this as any)._bb = createStreamingBB(bbPeriod, params.bbStdDev as number);
    (this as any)._adx = createStreamingADX(adxPeriod);
    (this as any)._sma = createStreamingSMA(smaPeriod);
    (this as any)._atr = createStreamingATR(params.atrPeriod as number);
    (this as any)._rsiBuf = new CircularBuffer(cumulativeBars);

    // State tracking
    (this as any)._prevRsi = undefined as number | undefined;
    (this as any)._entryBar = 0;
    (this as any)._entryATR = 0;

    context.log(
      `Initialized Adaptive RSI Mean Reversion: RSI(${rsiPeriod}), cumBars=${cumulativeBars}, oversold<${rsiOversoldThreshold}, ADX<${adxThreshold}, SMA(${smaPeriod}), Stop=${atrStopMultiplier}x ATR`
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

    // Extract parameters
    const rsiOversoldThreshold = params.rsiOversoldThreshold as number;
    const rsiOverboughtThreshold = params.rsiOverboughtThreshold as number;
    const rsiExitThreshold = params.rsiExitThreshold as number;
    const adxThreshold = params.adxThreshold as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;
    const smaPeriod = params.smaPeriod as number;

    // Need enough bars for the longest indicator (SMA 200)
    if (currentIndex < smaPeriod + 1) {
      // Still feed values to streaming indicators to warm them up
      const self = this as any;
      self._rsi.nextValue(currentCandle.close);
      const rsiVal = self._rsiBuf ? undefined : undefined; // just warm up
      self._bb.nextValue(currentCandle.close);
      self._adx.nextValue(currentCandle.high, currentCandle.low, currentCandle.close);
      self._sma.nextValue(currentCandle.close);
      self._atr.nextValue(currentCandle.high, currentCandle.low, currentCandle.close);

      // Feed RSI value to cumulative buffer
      const warmupRsi = self._rsi.nextValue ? undefined : undefined;
      // Actually, we already called nextValue above, so just push to buffer
      // But we need to re-think: the first nextValue call already consumed the value
      // Let's restructure...
      return;
    }

    // Get reference to streaming indicators
    const self = this as any;

    // Calculate all indicators for current bar (streaming - O(1) per bar)
    const currentRsi = self._rsi.nextValue(currentCandle.close) as number | undefined;
    const currentBB = self._bb.nextValue(currentCandle.close) as { upper: number; middle: number; lower: number } | undefined;
    const currentADX = self._adx.nextValue(currentCandle.high, currentCandle.low, currentCandle.close) as { adx: number } | undefined;
    const currentSMA = self._sma.nextValue(currentCandle.close) as number | undefined;
    const currentATR = self._atr.nextValue(currentCandle.high, currentCandle.low, currentCandle.close) as number | undefined;

    // Push RSI to cumulative buffer
    self._rsiBuf.push(currentRsi);
    const cumulativeRsi = self._rsiBuf.sum() as number | undefined;

    const currentPrice = currentCandle.close;

    // Validate all indicator values exist
    if (
      currentRsi === undefined ||
      currentBB === undefined ||
      currentADX === undefined ||
      currentSMA === undefined ||
      currentATR === undefined ||
      cumulativeRsi === undefined
    ) {
      self._prevRsi = currentRsi;
      return;
    }

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryPrice = longPosition.entryPrice;
      const entryBar = self._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = self._entryATR || currentATR;

      // 1. Stop Loss (highest priority)
      const stopPrice = entryPrice - (entryATR * atrStopMultiplier);
      if (currentPrice <= stopPrice) {
        context.log(`STOP LOSS: Price ${currentPrice.toFixed(2)} <= Stop ${stopPrice.toFixed(2)}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 2. Take Profit: Price reaches BB middle band (mean reversion target)
      if (currentPrice >= currentBB.middle) {
        context.log(`MEAN REVERSION TP: Price ${currentPrice.toFixed(2)} >= BB Middle ${currentBB.middle.toFixed(2)}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 3. RSI Normalization Exit
      if (currentRsi >= rsiExitThreshold) {
        context.log(`RSI NORMALIZATION: RSI(2)=${currentRsi.toFixed(1)} >= ${rsiExitThreshold}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }
    }

    if (shortPosition) {
      const entryPrice = shortPosition.entryPrice;
      const entryBar = self._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = self._entryATR || currentATR;

      // 1. Stop Loss
      const stopPrice = entryPrice + (entryATR * atrStopMultiplier);
      if (currentPrice >= stopPrice) {
        context.log(`STOP LOSS (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${stopPrice.toFixed(2)}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 2. Take Profit: Price reaches BB middle band
      if (currentPrice <= currentBB.middle) {
        context.log(`MEAN REVERSION TP (SHORT): Price ${currentPrice.toFixed(2)} <= BB Middle ${currentBB.middle.toFixed(2)}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 3. RSI Normalization Exit (for shorts: RSI drops below 35)
      const rsiExitShort = 100 - rsiExitThreshold; // Mirror the long threshold
      if (currentRsi <= rsiExitShort) {
        context.log(`RSI NORMALIZATION (SHORT): RSI(2)=${currentRsi.toFixed(1)} <= ${rsiExitShort}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition) {
      // Regime filter: only trade in range-bound markets
      const isRangeBound = currentADX.adx < adxThreshold;

      // LONG ENTRY
      if (isRangeBound && currentPrice > currentSMA && cumulativeRsi < rsiOversoldThreshold && currentPrice <= currentBB.lower) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: CumRSI(2)=${cumulativeRsi.toFixed(1)} < ${rsiOversoldThreshold}, Price ${currentPrice.toFixed(2)} <= BB Lower ${currentBB.lower.toFixed(2)}, ADX=${currentADX.adx.toFixed(1)} < ${adxThreshold}, Price > SMA(${smaPeriod})`
          );
          self._entryBar = currentIndex;
          self._entryATR = currentATR;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY
      if (enableShorts && isRangeBound && currentPrice < currentSMA && cumulativeRsi > rsiOverboughtThreshold && currentPrice >= currentBB.upper) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: CumRSI(2)=${cumulativeRsi.toFixed(1)} > ${rsiOverboughtThreshold}, Price ${currentPrice.toFixed(2)} >= BB Upper ${currentBB.upper.toFixed(2)}, ADX=${currentADX.adx.toFixed(1)} < ${adxThreshold}, Price < SMA(${smaPeriod})`
          );
          self._entryBar = currentIndex;
          self._entryATR = currentATR;
          context.openShort(amount);
        }
      }
    }

    // Update previous RSI for next bar
    self._prevRsi = currentRsi;
  },
```

**IMPORTANT NOTE ON STREAMING INDICATORS**: The above code uses the `nextValue()` streaming API. However, there is a critical issue: the streaming indicators need to be fed values from bar 0 (not just from bar `smaPeriod`). The early return for insufficient data must still feed values to the streaming calculators.

Here is the corrected approach -- use a single flow where streaming indicators are always fed, and we only check for trading after warmup:

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

    const self = this as any;

    // Extract parameters
    const rsiOversoldThreshold = params.rsiOversoldThreshold as number;
    const rsiOverboughtThreshold = params.rsiOverboughtThreshold as number;
    const rsiExitThreshold = params.rsiExitThreshold as number;
    const adxThreshold = params.adxThreshold as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;
    const smaPeriod = params.smaPeriod as number;

    // Feed ALL streaming indicators on EVERY bar (critical for warmup)
    const currentRsi = self._rsi.nextValue(currentCandle.close) as number | undefined;
    const currentBB = self._bb.nextValue(currentCandle.close) as { upper: number; middle: number; lower: number } | undefined;
    const currentADX = self._adx.nextValue(currentCandle.high, currentCandle.low, currentCandle.close) as { adx: number; pdi: number; mdi: number } | undefined;
    const currentSMA = self._sma.nextValue(currentCandle.close) as number | undefined;
    const currentATR = self._atr.nextValue(currentCandle.high, currentCandle.low, currentCandle.close) as number | undefined;

    // Push current RSI to cumulative buffer
    self._rsiBuf.push(currentRsi);
    const cumulativeRsi = self._rsiBuf.sum() as number | undefined;

    const currentPrice = currentCandle.close;

    // Validate all indicator values exist (will be undefined during warmup)
    if (
      currentRsi === undefined ||
      currentBB === undefined ||
      currentADX === undefined ||
      currentSMA === undefined ||
      currentATR === undefined ||
      cumulativeRsi === undefined
    ) {
      self._prevRsi = currentRsi;
      return;
    }

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryPrice = longPosition.entryPrice;
      const entryBar = self._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = self._entryATR || currentATR;

      // 1. Stop Loss (highest priority)
      const stopPrice = entryPrice - (entryATR * atrStopMultiplier);
      if (currentPrice <= stopPrice) {
        context.log(`STOP LOSS: Price ${currentPrice.toFixed(2)} <= Stop ${stopPrice.toFixed(2)}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 2. Take Profit: Price reaches BB middle band (mean reversion target)
      if (currentPrice >= currentBB.middle) {
        context.log(`MEAN REVERSION TP: Price ${currentPrice.toFixed(2)} >= BB Middle ${currentBB.middle.toFixed(2)}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 3. RSI Normalization Exit
      if (currentRsi >= rsiExitThreshold) {
        context.log(`RSI NORMALIZATION: RSI(2)=${currentRsi.toFixed(1)} >= ${rsiExitThreshold}`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        self._prevRsi = currentRsi;
        return;
      }
    }

    if (shortPosition) {
      const entryPrice = shortPosition.entryPrice;
      const entryBar = self._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = self._entryATR || currentATR;

      // 1. Stop Loss
      const stopPrice = entryPrice + (entryATR * atrStopMultiplier);
      if (currentPrice >= stopPrice) {
        context.log(`STOP LOSS (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${stopPrice.toFixed(2)}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 2. Take Profit: Price reaches BB middle band
      if (currentPrice <= currentBB.middle) {
        context.log(`MEAN REVERSION TP (SHORT): Price ${currentPrice.toFixed(2)} <= BB Middle ${currentBB.middle.toFixed(2)}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 3. RSI Normalization Exit (mirrored)
      const rsiExitShort = 100 - rsiExitThreshold;
      if (currentRsi <= rsiExitShort) {
        context.log(`RSI NORMALIZATION (SHORT): RSI(2)=${currentRsi.toFixed(1)} <= ${rsiExitShort}`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        self._prevRsi = currentRsi;
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition) {
      const isRangeBound = currentADX.adx < adxThreshold;

      // LONG ENTRY
      if (
        isRangeBound &&
        currentPrice > currentSMA &&
        cumulativeRsi < rsiOversoldThreshold &&
        currentPrice <= currentBB.lower
      ) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: CumRSI(2)=${cumulativeRsi.toFixed(1)} < ${rsiOversoldThreshold}, ` +
            `Price ${currentPrice.toFixed(2)} <= BB Lower ${currentBB.lower.toFixed(2)}, ` +
            `ADX=${currentADX.adx.toFixed(1)} < ${adxThreshold}, ` +
            `Price > SMA(${smaPeriod})`
          );
          self._entryBar = currentIndex;
          self._entryATR = currentATR;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY
      if (
        enableShorts &&
        isRangeBound &&
        currentPrice < currentSMA &&
        cumulativeRsi > rsiOverboughtThreshold &&
        currentPrice >= currentBB.upper
      ) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: CumRSI(2)=${cumulativeRsi.toFixed(1)} > ${rsiOverboughtThreshold}, ` +
            `Price ${currentPrice.toFixed(2)} >= BB Upper ${currentBB.upper.toFixed(2)}, ` +
            `ADX=${currentADX.adx.toFixed(1)} < ${adxThreshold}, ` +
            `Price < SMA(${smaPeriod})`
          );
          self._entryBar = currentIndex;
          self._entryATR = currentATR;
          context.openShort(amount);
        }
      }
    }

    self._prevRsi = currentRsi;
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

export default adaptiveRsiMeanReversion;
```

#### Important Implementation Notes

1. **Streaming indicators**: All indicators use the `nextValue()` API from `technicalindicators`. This is O(1) per bar vs O(n) for batch recalculation. Each indicator is created in `init()` and stored on `this`. On every `onBar()` call, `nextValue()` is called with the current candle's data. The return value is `undefined` until enough data has been accumulated (warmup period).

2. **Cumulative RSI**: Implemented as a `CircularBuffer` that tracks the last `cumulativeBars` RSI(2) values and sums them. This is more memory-efficient than maintaining the full RSI history.

3. **Warmup handling**: All streaming indicators are fed data on EVERY bar, even during warmup. The `undefined` check after calculating all indicators ensures we only trade after all indicators have sufficient data.

4. **State tracking**: `_entryBar`, `_entryATR`, and `_prevRsi` are stored on the strategy object using `(this as any)._field` pattern. These are set on entry and used for exit calculations.

5. **Exit priority**: Stop loss is checked first (capital preservation), then BB middle band (mean reversion target), then RSI normalization (momentum signal), then time-based exit (dead money prevention).

6. **ADX regime filter**: The `adx` field from the ADX indicator result is used. When `adx < adxThreshold`, the market is range-bound and mean reversion is appropriate. When `adx >= adxThreshold`, the market is trending and all entries are suppressed.

7. **Short exit RSI threshold**: The short exit RSI threshold is computed as `100 - rsiExitThreshold` to mirror the long exit symmetrically. For example, if longs exit at RSI > 65, shorts exit at RSI < 35.

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates successfully:
  ```bash
  npx tsx src/cli/quant-validate.ts strategies/adaptive-rsi-mean-reversion.ts
  ```
- [ ] Quick backtest runs and generates trades:
  ```bash
  npx tsx src/cli/quant-backtest.ts --strategy=adaptive-rsi-mean-reversion --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 --timeframe=1h
  ```
- [ ] Parameters are within specified ranges
- [ ] Risk management enforced (stops, position sizing)
- [ ] All entry/exit conditions implemented correctly
- [ ] Proper handling of edge cases (insufficient data, undefined values)
- [ ] Streaming indicators used (no batch recalculation in onBar)

---

#### Edge Cases to Handle

1. **Insufficient Data**: Streaming indicators return `undefined` during warmup. Check ALL values before using.
2. **ADX undefined period**: ADX requires more warmup bars than most indicators (approximately 2*period bars). Handled by the `undefined` check.
3. **SMA(200) warmup**: Requires 200 bars of data. This is the longest warmup period. All other indicators will be ready before SMA.
4. **Division by Zero**: Validate `currentPrice > 0` and `amount > 0` before opening positions.
5. **Concurrent Positions**: Ensure only one position (long OR short) at a time with the `!longPosition && !shortPosition` guard.
6. **Cumulative RSI buffer**: The `CircularBuffer.sum()` returns `undefined` until it has `cumulativeBars` entries with valid RSI values.
7. **RSI(2) extreme values**: RSI with period 2 is highly sensitive and can swing from 0 to 100 within 2 bars. This is by design.

---

#### Testing Instructions

```bash
# 1. Validate strategy file
npx tsx src/cli/quant-validate.ts strategies/adaptive-rsi-mean-reversion.ts

# 2. Quick backtest on BTC (should generate trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h

# 3. Test with more selective entry (lower cumulative RSI threshold)
npx tsx src/cli/quant-backtest.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h \
  --param.rsiOversoldThreshold=5

# 4. Test with relaxed ADX filter
npx tsx src/cli/quant-backtest.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h \
  --param.adxThreshold=30

# 5. Test on ETH
npx tsx src/cli/quant-backtest.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=ETH/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h

# 6. Walk-forward test
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=BTC/USDT \
  --from=2023-01-01 \
  --to=2024-12-31 \
  --timeframe=1h \
  --train-ratio=0.7 \
  --optimize-for=sharpeRatio \
  --max-combinations=500

# 7. Multi-asset validation
npx tsx src/cli/quant-multi-asset.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h

# 8. Test with shorts enabled
npx tsx src/cli/quant-backtest.ts \
  --strategy=adaptive-rsi-mean-reversion \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=1h \
  --param.enableShorts=true
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.5
- Target Win Rate: 65-80% (high win rate is characteristic of mean reversion)
- Target Total Return: 20-50% annually (lower than trend-following but more consistent)
- Max Acceptable Drawdown: < 12%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 1.0
- Target OOS Degradation: < 25%
- Target Win Rate: 60-75%
- Max Acceptable Drawdown: < 18%

**Trading Activity**:
- Expected Trades per Month: 6-15 (depends on market regime)
- Average Trade Duration: 3-8 hours (3-8 bars on 1h chart)
- Typical Position Size: 95% of capital

**Multi-Asset Performance**:
- Expected Pass Rate: 50-70% of tested assets
- Works Best On: Large-cap, liquid pairs with frequent range-bound periods (BTC, ETH)
- May Struggle On: Assets in persistent parabolic trends (e.g., memecoins during hype cycles) or very low-volume altcoins

---

## References

**Academic Papers**:

1. "Revisiting Trend-following and Mean-Reversion Strategies in Bitcoin", Sona Beluska, Radovan Vojtko, SSRN, 2024
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4955617
   - Key Finding: Mean-reversion in Bitcoin works after sharp drawdowns. The MIN strategy (buying at local minima) remains effective, particularly with 10-day lookback periods. Out-of-sample testing from Feb 2022 to Aug 2024 confirmed the strategy survived the bear market.

2. "Bollinger Bands under Varying Market Regimes: A Comparative Study of Breakout and Mean-Reversion Strategies in BTC/USDT", Efe Arda, SSRN, 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5775962
   - Key Finding: Mean-reversion using Bollinger Bands regained profitability in BTC during accumulation/range-bound phases. Performance is regime-dependent: mean reversion works in calm markets but fails during sustained trends.

3. "Stochastic Patterns of Bitcoin Volatility: Evidence across Measures", MDPI Mathematics, 2024
   - URL: https://www.mdpi.com/2227-7390/12/11/1719
   - Key Finding: RSI is effective for detecting overbought/oversold conditions tied to mean reversion in Bitcoin. The Hurst exponent analysis confirms that Bitcoin volatility exhibits mean-reverting behavior.

4. "Seasonality, Trend-following, and Mean reversion in Bitcoin", Matus Padysak, Radovan Vojtko, SSRN, 2022
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4081000
   - Key Finding: BTC tends to trend when at maximum prices and revert when at minimum prices. This supports buying extreme dips (mean reversion) while following momentum at highs (trend following).

**Industry Research**:

1. "Enhancing RSI Mean-Reversion with ATR and ADX: from $48,000 to $131,000 Profits", PyQuantLab, Medium, 2025
   - URL: https://pyquantlab.medium.com/enhancing-rsi-mean-reversion-with-atr-and-adx-from-48000-to-131000-profits-f6a14287553e
   - Summary: Adding ADX regime filter and ATR-based risk management to basic RSI mean-reversion nearly tripled profits on crypto. The ADX filter dramatically reduced false signals during trending markets.

2. "Squeezing More Profits with Cumulative RSI", Quantitativo, 2024
   - URL: https://www.quantitativo.com/p/squeezing-more-profits-with-cumulative
   - Summary: Cumulative RSI(2) improved Sharpe from 1.05 to 1.18 vs vanilla RSI(2). Reduced drawdown from 57% to 37%. 30.3% annual return since 1999 on S&P 500 stocks.

3. "Connors RSI Trading Strategy: Statistics, Facts, Backtests (75% Win Rate)", QuantifiedStrategies
   - URL: https://www.quantifiedstrategies.com/connors-rsi/
   - Summary: RSI(2) strategy achieves 75%+ win rate across extensive backtests. RSI dips below 5 produce higher returns than dips below 10. Average holding period of 3-4 bars.

4. "Day Trading Larry Connors RSI2 Mean-Reversion Strategies", MQL5, 2025
   - URL: https://www.mql5.com/en/articles/17636
   - Summary: Systematic testing of Connors' RSI2 strategies on 30-minute timeframe. Confirmed mean-reversion concept works for intraday trading with proper trend filters.

**Books/Guides**:

1. "Short Term Trading Strategies That Work", Larry Connors & Cesar Alvarez, 2008
   - Relevant Chapter: Chapters on RSI(2) and Cumulative RSI
   - Key Concept: RSI(2) < 5 produces 88% win rate on S&P 500 stocks. Cumulative RSI over 2-3 bars improves signal quality. The 200-day SMA filter ensures trading with the trend.

2. "How Markets Really Work", Larry Connors, 2004
   - Key Concept: Markets are mean-reverting in the short term (2-7 days) and trending in the long term. This is the foundational observation behind RSI(2) strategies.

**Similar Strategies**:

1. Connors RSI2 Classic from "Short Term Trading Strategies That Work"
   - Similarities: Uses RSI(2), SMA(200) trend filter, extreme oversold/overbought entries.
   - Differences: Our version adds ADX regime filter (critical for crypto), Bollinger Band confirmation, cumulative RSI, ATR-based stops (Connors advocates no stops), and time-based exits.

2. Bollinger-RSI Dual Confirmation Mean Reversion (FMZ Quant)
   - URL: https://www.fmz.com/lang/en/strategy/504546
   - Similarities: Combines BB lower band touch with RSI oversold for entry.
   - Differences: Our version adds cumulative RSI, ADX regime filter, and SMA(200) trend filter. Different exit logic (BB middle vs fixed %).

---

## Change Log

**Version 1.0** - 2026-02-03
- Initial specification
- Based on Connors RSI(2) framework with cumulative RSI enhancement
- Added ADX regime filter to avoid trending markets (primary innovation over vanilla RSI(2))
- Added Bollinger Band confirmation for statistical extreme verification
- Includes comprehensive parameter ranges for grid search optimization
- Full implementation prompt with streaming indicator approach and testing instructions

---

## Notes

1. **Transaction costs**: With typical 0.1% taker fees on Binance (round-trip 0.2%), trades need to produce at least 0.2% profit to break even. Mean reversion targets (BB middle band) on BTC 1h are typically 1-3%, providing adequate margin over costs.

2. **Signal frequency**: The combination of RSI(2) oversold + BB lower band + ADX range-bound is relatively selective. Expect 6-15 trades per month on BTC 1h. More volatile assets (SOL, DOGE) may produce more signals.

3. **Why longs-only default**: Crypto has a long-term upward bias. Mean reversion shorts (selling overbought rallies) tend to underperform longs (buying oversold dips) because the upward bias means "oversold" conditions revert more reliably than "overbought" conditions. The `enableShorts` parameter allows testing both directions.

4. **ADX regime filter importance**: This is the single most important enhancement over vanilla RSI(2) mean reversion. Without it, the strategy would enter "oversold" positions during sustained downtrends and get destroyed. The ADX filter suppresses signals during the exact conditions where mean reversion fails.

5. **RSI(2) vs RSI(14)**: The 2-period RSI is deliberately chosen for ultra-high sensitivity. A 14-period RSI is too slow for mean reversion -- by the time it reaches oversold (30), the move may already be too deep. RSI(2) reaches extreme values (< 5) after just 2 bars of decline, catching the dislocation early.

6. **Cumulative RSI benefit**: Summing RSI(2) over 2-3 bars reduces false signals from single-bar spikes. A single bar with RSI(2) = 4 could be noise, but two consecutive bars with RSI(2) = 3 and 5 (cumulative = 8) is a more reliable oversold signal.

7. **Future enhancements**: Consider adding a Stochastic RSI variant for additional confirmation, MFI (Money Flow Index) for volume-based oversold confirmation, or a multi-timeframe filter using 4h ADX instead of 1h ADX.

---

**END OF SPECIFICATION**
