# Strategy Specification Template

This directory contains detailed specifications for trading strategies designed by the quant-lead agent.

## Purpose

Strategy specs serve as:
1. **Documentation** - Detailed record of strategy design and rationale
2. **Implementation Guide** - Complete instructions for the quant agent and be-dev
3. **Research Reference** - Links to academic papers and empirical backing
4. **Testing Blueprint** - Clear criteria for validation and success metrics

## How to Use This Template

When creating a new strategy specification:

1. **Copy this template structure** into a new file
2. **Filename format**: `YYYY-MM-DD-HHMMSS-strategy-name.md` (use local timezone)
3. **Fill in ALL sections** - completeness is critical for implementation
4. **Include research sources** - link to papers, articles, proven strategies
5. **Be specific** - the quant agent should not need to guess or ask questions

## Template Structure

---

# Strategy: [Strategy Name]

> **Created**: [YYYY-MM-DD HH:MM]
> **Author**: quant-lead agent
> **Status**: [Draft / In Development / Tested / Deprecated]

## Executive Summary

[2-3 sentence summary of the strategy, its edge, and expected use case]

---

## Hypothesis

[Detailed explanation of the market inefficiency or pattern being exploited]

**Core Edge**: [What gives this strategy an edge?]

**Why This Edge Persists**: [Structural or behavioral reasons why this inefficiency continues to exist]

**Market Conditions**: [Under what market conditions does this strategy work best? When does it fail?]

**Academic/Empirical Backing**: [Reference to papers, studies, or proven implementations]

---

## Classification

**Style**: [Choose one: trend / meanReversion / momentum / breakout / volatility / statistical / hybrid]

**Holding Period**: [Choose one: scalp (seconds-minutes) / intraday (minutes-hours) / swing (hours-days) / position (days-weeks)]

**Complexity**: [Choose one:]
- Single-TF single-asset (simplest)
- Multi-TF single-asset (multiple timeframes, one instrument)
- Single-TF multi-asset (one timeframe, multiple instruments)
- Multi-TF multi-asset (most complex)

**Market Type**: [spot / futures / both]

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: [e.g., 4h, 1d, 15m]

**Purpose**: [Main signal generation, entry timing, position management, etc.]

**Rationale**: [Why this timeframe? Match to holding period, data quality, etc.]

### Secondary Timeframes

*(If multi-timeframe strategy)*

**Higher Timeframe**: [e.g., 1d]
- **Purpose**: [Trend filter, regime classification, etc.]
- **How Used**: [Specific logic for how this TF filters/confirms trades]

**Lower Timeframe**: [e.g., 1h]
- **Purpose**: [Entry timing, stop placement, etc.]
- **How Used**: [Specific logic]

### Timeframe Interaction

[Explain how the timeframes work together. Example: "Only take 4h long entries when 1d trend is bullish AND 1h shows momentum confirmation."]

---

## Asset Configuration

### Primary Asset

**Asset**: [e.g., BTC/USDT, ETH/USDT]

**Why This Asset**: [Liquidity, volatility characteristics, etc.]

### Signal Assets

*(If multi-asset strategy)*

**Asset 1**: [e.g., BTC/USDT]
- **Role**: [Correlation signal, dominance filter, etc.]
- **How Used**: [Specific logic]

**Asset 2**: [e.g., BTC.D (Bitcoin Dominance)]
- **Role**: [Market regime indicator]
- **How Used**: [Specific logic]

### Recommended Test Assets

[List 3-5 assets for validation testing]

| Asset | Type | Rationale |
|-------|------|-----------|
| BTC/USDT | Large cap | Most liquid, broad market proxy |
| ETH/USDT | Large cap | Different characteristics than BTC |
| SOL/USDT | Mid cap | Higher volatility, tests robustness |
| [Asset 4] | [Type] | [Why include] |
| [Asset 5] | [Type] | [Why include] |

**Generalizability Expectation**: [Should work across all? Specific to certain assets? Why?]

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| SMA | 4h | Trend filter | period: 50 | Slow-moving average for trend |
| RSI | 4h | Momentum signal | period: 14 | Entry signal generation |
| ATR | 4h | Position sizing | period: 14 | Risk management |
| [Indicator] | [TF] | [Purpose] | [Params] | [Notes] |

### Additional Data Requirements

*(If strategy needs non-OHLCV data)*

- **Funding rates**: [How used, where sourced]
- **On-chain metrics**: [Which metrics, why needed]
- **Sentiment data**: [Source, integration method]
- **Order book data**: [L2 depth, how analyzed]

### Data Preprocessing

[Any required data transformations, normalization, alignment across timeframes, etc.]

---

## Entry Logic

[Step-by-step entry conditions. Be extremely specific about which timeframe each condition uses.]

### Long Entry Conditions

**ALL of the following must be true:**

1. **[Condition 1]**: [Detailed description]
   - Timeframe: [which TF]
   - Example: `SMA(50) > SMA(200)` on 1d chart (daily uptrend)

2. **[Condition 2]**: [Detailed description]
   - Timeframe: [which TF]
   - Example: `RSI crosses above 50` on 4h chart (momentum confirmation)

3. **[Condition 3]**: [Detailed description]
   - Timeframe: [which TF]
   - Example: `Volume > 1.5x average` (volume confirmation)

**Position Sizing**: [How to calculate position size]
- Formula: [e.g., `positionSize = (equity * 0.95) / currentPrice`]
- Volatility adjustment: [e.g., scale by ATR if needed]

### Short Entry Conditions

*(If strategy supports shorting)*

**ALL of the following must be true:**

1. **[Condition 1]**: [Detailed description]
2. **[Condition 2]**: [Detailed description]
3. **[Condition 3]**: [Detailed description]

**Position Sizing**: [Same as long or different?]

### Entry Examples

[Provide 1-2 concrete examples with actual numbers]

**Example 1**: [Bullish Entry]
- Date: 2024-03-15, Time: 16:00 (4h candle close)
- BTC price: $65,000
- SMA(50) = $62,000, SMA(200) = $58,000 (uptrend confirmed)
- RSI = 55 (crossed above 50 two candles ago)
- Volume = 850 BTC (vs 500 BTC average)
- **Action**: Enter long, position size = 0.146 BTC ($9,500 / $65,000)

---

## Exit Logic

[Precise exit conditions. Include stop loss, take profit, time-based, and signal reversal exits.]

### Stop Loss

**Type**: [Fixed percentage / ATR-based / trailing / technical level]

**Calculation**: [Exact formula]
- Example: `stopPrice = entryPrice - (ATR * 2.0)`
- Example: `stopLossPercent = -3%`

**Adjustment**: [Does stop loss move? When and how?]
- Example: "Trailing stop activates after 5% profit, trails at 2x ATR below current price"

### Take Profit

**Type**: [Fixed percentage / ATR-based / technical target / signal-based]

**Calculation**: [Exact formula]
- Example: `takeProfitPrice = entryPrice + (ATR * 3.0)`
- Example: `takeProfitPercent = +10%`

**Partial Exits**: [Does strategy take partial profits? When?]

### Signal-Based Exit

**Exit Trigger**: [What signal causes exit?]
- Example: "Exit when RSI crosses below 50"
- Example: "Exit when fast SMA crosses below slow SMA"

**Priority**: [If multiple exit conditions met, which takes precedence?]

### Time-Based Exit

**Max Holding Period**: [Optional - maximum bars to hold]
- Example: "Exit after 30 candles (5 days on 4h chart) if no other exit triggered"

**Rationale**: [Why this time limit?]

### Exit Examples

**Example 1**: [Stop Loss Exit]
- Entry: $65,000, Stop: $63,100 (2x ATR = $950)
- Price drops to $63,050
- **Action**: Exit at $63,100, Loss: -2.9%

**Example 2**: [Take Profit Exit]
- Entry: $65,000, Target: $68,850 (3x ATR)
- Price reaches $68,900
- **Action**: Exit at $68,850, Profit: +5.9%

---

## Risk Management

### Position Sizing

**Method**: [Fixed percentage / volatility-adjusted / Kelly criterion / other]

**Base Size**: [e.g., 95% of available capital per trade]

**Volatility Adjustment**: [Optional - scale by ATR, historical volatility, etc.]
- Formula: [if applicable]
- Example: `adjustedSize = baseSize * (avgATR / currentATR)`

### Per-Trade Risk

**Max Risk Per Trade**: [e.g., 2% of equity]

**Calculation**: [How to enforce this limit]
- Example: "Position size limited such that distance to stop loss = 2% of equity"

### Portfolio Risk

**Max Drawdown Limit**: [e.g., close all positions if portfolio down 15%]

**Max Concurrent Positions**: [e.g., 1 for single-asset, 3 for multi-asset]

**Correlation Limits**: [For multi-asset strategies]
- Example: "Don't hold long positions in BTC and ETH simultaneously if correlation > 0.8"

### Leverage

**Max Leverage**: [e.g., 1x (spot only), 2x, 5x for futures]

**Rationale**: [Why this leverage level?]

---

## Parameter Ranges (for optimization)

[Define parameter ranges for grid search optimization]

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| fastPeriod | number | 5 | 30 | 5 | 10 | Fast moving average period |
| slowPeriod | number | 20 | 100 | 10 | 50 | Slow moving average period |
| rsiPeriod | number | 10 | 20 | 2 | 14 | RSI calculation period |
| rsiThreshold | number | 40 | 60 | 5 | 50 | RSI entry threshold |
| atrMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | ATR multiplier for stops |
| [param] | [type] | [min] | [max] | [step] | [default] | [description] |

**Parameter Dependencies**: [Any parameters that depend on each other?]
- Example: "fastPeriod must be < slowPeriod"

**Optimization Notes**: [Guidance on which parameters are most sensitive, expected ranges, etc.]

---

## System Gaps

[What needs to be added/improved in the backtesting system to implement this strategy]

### Required Extensions

*(If strategy needs features not currently available)*

**1. [Extension Name]**
- **What**: [Description of what needs to be built]
- **Why**: [Why is this needed for the strategy]
- **Complexity**: [Simple / Medium / Complex]
- **Priority**: [Critical / High / Medium / Low]
- **Implementation Notes**: [Guidance for developer]

**2. [Extension Name]**
- [Same structure]

### Workarounds

*(If extensions are complex, suggest temporary workarounds)*

**For [Missing Feature]**: [Workaround approach]
- Example: "While multi-timeframe engine is built, pre-calculate daily indicators in init() and use as static filters"

### Nice-to-Have Improvements

[Features that would improve strategy but aren't strictly required]

---

## Implementation Prompt

[Detailed prompt for the be-dev coding agent. This is the most critical section - be extremely thorough.]

---

### FOR THE BE-DEV AGENT

You are implementing the **[Strategy Name]** strategy for the crypto backtesting system.

#### Strategy Overview

[2-3 sentence recap of the hypothesis and approach]

This strategy:
- Trades on **[timeframe]** timeframe
- Uses **[list key indicators]**
- Entry: [one sentence]
- Exit: [one sentence]
- Risk: [one sentence]

---

#### System Extensions Required

*(If any - implement these BEFORE the strategy)*

**FIRST**: Implement these extensions to the system:

1. **[Extension Name]**
   - Location: `/workspace/src/[module]/[file].ts`
   - What to add: [Detailed description]
   - API/interface: [Expected function signatures, types, etc.]
   - Testing: [How to verify it works]

2. **[Extension Name]**
   - [Same structure]

**THEN**: Proceed with strategy implementation below.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/[strategy-name].ts`

#### Step 1: Imports and Setup

```typescript
import { SMA, RSI, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// Add any helper functions needed
```

#### Step 2: Define Strategy Metadata

```typescript
const [strategyName]: Strategy = {
  name: '[strategy-name]',
  description: '[brief description]',
  version: '1.0.0',

  // Continue with params below...
```

#### Step 3: Define Parameters

Use this exact parameter configuration:

```typescript
params: [
  {
    name: 'fastPeriod',
    label: 'Fast Period',
    type: 'number',
    default: 10,
    min: 5,
    max: 30,
    step: 5,
    description: 'Fast moving average period',
  },
  // Add all parameters from the table above
],
```

#### Step 4: Implement init() Hook

[Detailed instructions for init implementation]

Purpose: Initialize strategy, validate parameters, pre-compute any static data.

```typescript
init(context: StrategyContext): void {
  // 1. Extract parameters
  const { params } = context;
  const fastPeriod = params.fastPeriod as number;
  const slowPeriod = params.slowPeriod as number;

  // 2. Validate parameter constraints
  if (fastPeriod >= slowPeriod) {
    throw new Error(`Fast period must be < slow period`);
  }

  // 3. [If needed] Pre-fetch additional data
  // Example for multi-timeframe:
  // const ccxt = require('ccxt');
  // const exchange = new ccxt.binance();
  // const dailyCandles = exchange.fetch_ohlcv('BTC/USDT', '1d', undefined, 100);
  // this.dailyTrend = calculateTrend(dailyCandles);

  // 4. Log initialization
  context.log(`Initialized [Strategy] with params: ${JSON.stringify(params)}`);
},
```

#### Step 5: Implement onBar() Hook

[Detailed pseudocode for main trading logic]

Purpose: Execute on every candle. Check entry/exit conditions and place orders.

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
  const fastPeriod = params.fastPeriod as number;
  const slowPeriod = params.slowPeriod as number;
  const rsiPeriod = params.rsiPeriod as number;
  const rsiThreshold = params.rsiThreshold as number;
  const atrMultiplier = params.atrMultiplier as number;

  // 1. Early return if insufficient data
  if (currentIndex < slowPeriod) {
    return;
  }

  // 2. Calculate indicators
  const closes = candleView.closes();
  const highs = candleView.highs();
  const lows = candleView.lows();

  const fastSMA = calculateSMA(closes, fastPeriod);
  const slowSMA = calculateSMA(closes, slowPeriod);
  const rsi = calculateRSI(closes, rsiPeriod);
  const atr = calculateATR(highs, lows, closes, 14);

  // Get current values
  const currentFast = fastSMA[fastSMA.length - 1];
  const currentSlow = slowSMA[slowSMA.length - 1];
  const currentRSI = rsi[rsi.length - 1];
  const currentATR = atr[atr.length - 1];
  const currentPrice = currentCandle.close;

  // Get previous values for crossover detection
  const prevFast = fastSMA[fastSMA.length - 2];
  const prevSlow = slowSMA[slowSMA.length - 2];
  const prevRSI = rsi[rsi.length - 2];

  // Validate all values exist
  if (
    currentFast === undefined ||
    currentSlow === undefined ||
    currentRSI === undefined ||
    currentATR === undefined ||
    prevFast === undefined ||
    prevSlow === undefined ||
    prevRSI === undefined
  ) {
    return;
  }

  // 3. LONG ENTRY LOGIC
  // [Detailed entry conditions from spec]
  if (!longPosition && !shortPosition) {  // Not in a position
    // Check all entry conditions
    const trendCondition = currentFast > currentSlow;  // Uptrend
    const momentumCondition = prevRSI <= rsiThreshold && currentRSI > rsiThreshold;  // RSI crossed above threshold
    const [additionalCondition] = [logic];

    if (trendCondition && momentumCondition && [additionalCondition]) {
      // Calculate position size
      const positionValue = balance * 0.95;
      const amount = positionValue / currentPrice;

      if (amount > 0) {
        context.log(`OPEN LONG: [entry reason with values]`);
        context.openLong(amount);

        // [If needed] Store entry data for exit logic
        // this.entryPrice = currentPrice;
        // this.stopPrice = currentPrice - (currentATR * atrMultiplier);
      }
    }
  }

  // 4. LONG EXIT LOGIC
  if (longPosition) {
    const entryPrice = longPosition.entryPrice;

    // Stop loss check
    const stopPrice = entryPrice - (currentATR * atrMultiplier);
    if (currentPrice <= stopPrice) {
      context.log(`STOP LOSS: Price ${currentPrice} <= Stop ${stopPrice}`);
      context.closeLong();
      return;
    }

    // Take profit check
    const takeProfitPrice = entryPrice + (currentATR * atrMultiplier * 1.5);  // 1.5x risk
    if (currentPrice >= takeProfitPrice) {
      context.log(`TAKE PROFIT: Price ${currentPrice} >= Target ${takeProfitPrice}`);
      context.closeLong();
      return;
    }

    // Signal-based exit
    if (currentRSI < rsiThreshold) {
      context.log(`EXIT: RSI dropped below threshold`);
      context.closeLong();
      return;
    }

    // [Additional exit conditions from spec]
  }

  // 5. SHORT LOGIC (if applicable)
  // [Similar structure for short entries/exits]
},
```

#### Step 6: Implement Helper Functions

[Any helper functions needed]

```typescript
// Helper to calculate SMA with padding
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  const result = SMA.calculate({ values: closes, period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

// Helper to calculate RSI with padding
function calculateRSI(closes: number[], period: number): (number | undefined)[] {
  const result = RSI.calculate({ values: closes, period });
  const padding = new Array(period).fill(undefined);  // RSI needs period+1 values
  return [...padding, ...result];
}

// [Additional helpers as needed]
```

#### Step 7: Implement onEnd() Hook

```typescript
onEnd(context: StrategyContext): void {
  // Close any remaining positions
  if (context.longPosition) {
    context.log('Closing remaining long position');
    context.closeLong();
  }

  if (context.shortPosition) {
    context.log('Closing remaining short position');
    context.closeShort();
  }
},
```

#### Step 8: Export Strategy

```typescript
export default [strategyName];
```

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates successfully:
  ```bash
  npx tsx src/cli/quant-validate.ts strategies/[strategy-name].ts
  ```
- [ ] Quick backtest runs and generates trades:
  ```bash
  npx tsx src/cli/quant-backtest.ts --strategy=[strategy-name] --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01
  ```
- [ ] Parameters are within specified ranges
- [ ] Risk management enforced (stops, position sizing)
- [ ] All entry/exit conditions implemented correctly
- [ ] Proper handling of edge cases (insufficient data, undefined values)

---

#### Edge Cases to Handle

1. **Insufficient Data**: Early return if not enough candles for longest period indicator
2. **Undefined Indicator Values**: Check all indicator values before using in conditions
3. **Division by Zero**: Validate denominators in position sizing calculations
4. **Concurrent Positions**: Ensure only one position (long OR short) at a time
5. **Balance Checks**: Ensure `amount > 0` before opening positions

---

#### Testing Instructions

```bash
# 1. Validate strategy file
npx tsx src/cli/quant-validate.ts strategies/[strategy-name].ts

# 2. Quick backtest (should generate trades)
npx tsx src/cli/quant-backtest.ts \
  --strategy=[strategy-name] \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --timeframe=[timeframe]

# 3. Test with parameter overrides
npx tsx src/cli/quant-backtest.ts \
  --strategy=[strategy-name] \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  --param.fastPeriod=15 \
  --param.slowPeriod=50
```

---

#### Implementation Notes

- **Use CandleView**: Prefer `context.candleView.closes()` over direct array access for memory efficiency
- **Parameter Validation**: Validate all parameter constraints in `init()`
- **Crossover Detection**: Compare current and previous values to detect crosses
- **Position Sizing**: Standard is 95% of available balance
- **Logging**: Log all entry/exit decisions with values for debugging
- **State Management**: If strategy needs to track state between bars, store on strategy object (use `this`)

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

[Target metrics based on research and similar strategies]

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: [e.g., > 1.5]
- Target Win Rate: [e.g., 55-65%]
- Target Total Return: [e.g., 30-60% annually]
- Max Acceptable Drawdown: [e.g., < 15%]

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: [e.g., > 1.0]
- Target OOS Degradation: [e.g., < 25%]
- Target Win Rate: [e.g., 50-60%]
- Max Acceptable Drawdown: [e.g., < 20%]

**Trading Activity**:
- Expected Trades per Month: [e.g., 10-20]
- Average Trade Duration: [e.g., 2-4 days]
- Typical Position Size: [e.g., 95% of capital]

**Multi-Asset Performance**:
- Expected Pass Rate: [e.g., 50-70% of tested assets]
- Works Best On: [e.g., large-cap, liquid pairs]
- May Struggle On: [e.g., low-volume altcoins]

---

## References

[Academic papers, articles, sources with URLs]

**Academic Papers**:
1. [Paper Title], [Authors], [Journal], [Year]
   - URL: [link]
   - Key Finding: [Relevant insight]

2. [Paper Title], [Authors], [Journal], [Year]
   - URL: [link]
   - Key Finding: [Relevant insight]

**Industry Research**:
1. [Report Title], [Source], [Date]
   - URL: [link]
   - Summary: [Brief summary]

**Books/Guides**:
1. [Book Title], [Author], [Year]
   - Relevant Chapter: [Chapter name/number]
   - Key Concept: [What's relevant]

**Similar Strategies**:
1. [Strategy Name] from [Source]
   - URL: [link]
   - Similarities: [How this strategy relates]
   - Differences: [How this strategy improves]

---

## Change Log

[Track modifications to strategy spec]

**Version 1.0** - [YYYY-MM-DD]
- Initial specification
- [Key points]

**Version 1.1** - [YYYY-MM-DD] *(if modified)*
- [Changes made]
- [Rationale]

---

## Notes

[Any additional notes, caveats, observations, or future improvement ideas]

---

**END OF TEMPLATE**

---

## Tips for Writing Good Strategy Specs

1. **Be Specific**: Avoid vague language like "when momentum is strong" - define exact thresholds and conditions

2. **Reference Research**: Always link to real papers, strategies, or empirical evidence

3. **Think About Edge**: Clearly articulate WHY this strategy should work, not just WHAT it does

4. **Consider Failure Modes**: What market conditions cause this strategy to fail? How to detect/avoid them?

5. **Make It Implementable**: The implementation prompt should be so detailed that be-dev doesn't need to guess

6. **Define Success**: Set clear performance expectations so results can be objectively evaluated

7. **Test Plan**: Specify which assets, timeframes, and date ranges to use for validation

8. **Iterate**: Specs can be updated based on backtest results and implementation learnings
