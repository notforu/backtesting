# Strategy Pack: Funding Rate Regime-Conditioned Scalping

> **Created**: 2026-03-05 14:00
> **Author**: quant-lead agent (opus)
> **Status**: Draft - Ready for Implementation
> **Context**: Previous 1m scalping attempts (FR Settlement Scalper, Volatility Breakout Scalper) both FAILED. This pack learns from those failures.

---

## Lessons from Failed Strategies

Before presenting new strategies, here is what we learned:

1. **FR Settlement Scalper FAILED** because the settlement window effect on 1m is too noisy. FR as a direct timing signal on 1m does not work.
2. **Volatility Breakout Scalper FAILED** because pure technicals (BB squeeze + volume) on 1m produce too many false breakouts. Fees eat all profits.
3. **FR Spike V2 WORKS on 4h** because extreme FR events are rare, powerful, and represent real market imbalance. The edge is structural.
4. **Key insight from the user**: FR is the edge, not pure technicals. Use FR as a REGIME FILTER (deciding WHEN to trade) and use price action for ENTRIES on shorter timeframes.

## Core Design Principle

All strategies below follow this architecture:

```
4h FR REGIME DETECTION  -->  5m/15m ENTRY TIMING  -->  5m/15m EXIT MANAGEMENT
       (the edge)              (the execution)           (risk control)
```

This is fundamentally different from the failed approaches which tried to use FR as a signal on 1m, or used pure technicals without FR.

---

## Strategy 1: FR Regime Momentum Rider

### Hypothesis

When funding rate reaches an extreme percentile (top 10% or bottom 10%), the subsequent mean-reversion creates a multi-hour directional move. We already know this works on 4h (FR V2 Sharpe 2.08). The hypothesis is that by entering on 5m price action AFTER the FR extreme is detected, we can achieve better entries (tighter stops, larger R:R) than the 4h strategy which enters at candle close.

**Core Edge**: FR V2 enters at 4h bar close, which is imprecise. The actual mean-reversion move begins at a specific moment within that 4h window. By dropping to 5m for entry timing, we can:
- Enter closer to the actual turn point (smaller drawdown before profit)
- Use tighter stops (reducing risk per trade)
- Potentially catch more of the move (entering earlier)

**Why This Edge Persists**: Same structural reason as FR V2 -- extreme funding rates reflect genuine leverage imbalance. The improvement is purely in execution timing, not a new edge source.

**Market Conditions**: Works when FR is at extremes AND price starts moving in the mean-reversion direction. Fails when extreme FR is sustained (trending markets that keep FR elevated).

**Academic/Empirical Backing**:
- Ruan & Streltsov (2024, SSRN 4218907): U-shaped activity pattern within 8h funding cycles confirms informed trading concentrates around extreme FR periods
- Our own FR V2 research: Sharpe 2.08 on 4h proves the FR extreme -> mean reversion hypothesis
- Inan (2025, SSRN 5576424): FR is predictable via DAR models, meaning next-period FR can be estimated, giving advance warning

### Classification

**Style**: Mean Reversion (FR-conditioned)
**Holding Period**: Intraday (1-8 hours, typically 2-4 hours)
**Complexity**: Multi-TF single-asset (4h FR regime + 5m execution)
**Market Type**: Futures (requires funding rate data)

### Timeframe Configuration

**Primary Timeframe**: 5m
- Purpose: Entry timing and exit management
- Rationale: 5m balances noise reduction (vs 1m) with precision (vs 4h). A 4h bar = 48 five-minute bars, giving many opportunities to time entries.

**Higher Timeframe**: 4h (via funding rate data)
- Purpose: Regime detection -- is FR currently extreme?
- How Used: Check if current FR is in top/bottom N percentile of recent history. This is the gate that enables trading.

**Timeframe Interaction**: Only generate 5m entry signals when 4h FR regime is "extreme". Once in extreme regime, use 5m price action (EMA cross + RSI momentum shift) to time the entry. Manage position on 5m with ATR-based stops.

### Asset Configuration

**Primary Asset**: Any Bybit perpetual futures symbol with sufficient FR history.

**Recommended Test Assets**:

| Asset | Type | Rationale |
|-------|------|-----------|
| LDO/USDT:USDT | Mid cap | Best FR V2 performer, Sharpe 1.69, MaxDD 5.6% |
| DOGE/USDT:USDT | Meme | FR V2 proven, ultra-low DD 2.5%, extreme FR events |
| ICP/USDT:USDT | Mid cap | FR V2 proven, Sharpe 0.83, stable characteristics |
| RPL/USDT:USDT | Small cap | Best 1h FR performer (Sharpe 1.28), volatile FR |
| BTC/USDT:USDT | Large cap | Benchmark, most liquid, tests if edge scales |

**Generalizability Expectation**: Should work on the same assets where FR V2 works, since the edge source is identical. May work BETTER on assets with more volatile FR (RPL, LDO) where the 5m entry timing adds more value.

### Indicators & Data Requirements

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| Funding Rate Percentile | 4h (8h intervals) | Regime detection | lookback: 90-180 FR observations, threshold: 5-15th percentile | Gate for all entries |
| EMA Fast | 5m | Entry signal | period: 8-13 | Crosses slow EMA = momentum shift |
| EMA Slow | 5m | Entry signal | period: 21-34 | Baseline for crossover |
| RSI | 5m | Momentum confirmation | period: 14 | Confirms direction matches FR regime |
| ATR | 5m | Stop/TP calculation | period: 14 | Dynamic risk management |
| SMA | 5m (200 bars ~ 16h) | Trend filter | period: 200 | Only enter if trend aligns with FR direction |

**Additional Data Requirements**:
- Funding rates: Already cached in DB via `scripts/cache-funding-rates.ts`
- 5m candles: Need to cache from Bybit (or aggregate from 1m if available)

### Entry Logic

#### Long Entry Conditions (when FR is extremely NEGATIVE)

**ALL of the following must be true:**

1. **FR Regime: Extreme Negative**
   - Current FR is below the Nth percentile of the last 90 FR observations
   - Default: below 10th percentile (very negative FR = shorts paying longs)
   - This means the market is overleveraged short -- ripe for a squeeze/reversion

2. **Trend Alignment (SMA 200 on 5m)**
   - Price is above the 200-period SMA on 5m (roughly 16 hours of data)
   - Ensures we are not going long in a strong downtrend
   - This mirrors FR V2's protective trend filter

3. **EMA Crossover on 5m**
   - Fast EMA (8) crosses above Slow EMA (21)
   - This is the timing signal -- momentum is shifting bullish on the execution timeframe

4. **RSI Confirmation**
   - RSI(14) on 5m is between 30-55 (not overbought yet, room to run)
   - If RSI already > 65, we missed the entry -- the move already happened

5. **No Existing Position**
   - Not already in a long or short

**Position Sizing**: `positionSize = (equity * positionSizePct / 100) / price`
- Default: 50% of equity (same as FR V2)
- Volatility adjustment: scale by avgATR/currentATR (calmer = larger, volatile = smaller)

#### Short Entry Conditions (when FR is extremely POSITIVE)

Mirror of long conditions:
1. FR above (100-N)th percentile (e.g., above 90th percentile)
2. Price below SMA(200) on 5m
3. Fast EMA crosses below Slow EMA
4. RSI between 45-70
5. No existing position

### Exit Logic

#### Stop Loss
**Type**: ATR-based (fixed at entry)
**Calculation**: `stopPrice = entryPrice - (entryATR * atrStopMultiplier)` for longs
- Default multiplier: 2.0 (tighter than FR V2's 2.5 because 5m gives better entry timing)
- Uses ATR at entry, not current ATR (prevents stop widening)

#### Take Profit
**Type**: ATR-based
**Calculation**: `tpPrice = entryPrice + (entryATR * atrTPMultiplier)` for longs
- Default multiplier: 3.0 (1.5:1 R:R with 2.0 stop)

#### FR Normalization Exit
**Type**: Signal-based
- For longs entered during extreme negative FR: exit when FR rises above 25th percentile
- For shorts entered during extreme positive FR: exit when FR drops below 75th percentile
- This is the same FR normalization logic as FR V2

#### Trailing Stop
**Type**: ATR-based, activates after profit threshold
- Activation: unrealized profit > 1.5 * ATR
- Trail distance: 1.5 * currentATR from highest/lowest price since entry
- Ratchets only in profitable direction

#### Time-Based Exit
- Max hold: 48 bars (4 hours on 5m) -- aligned with the 4h FR cycle
- If no exit triggered after 48 bars, close at market

#### Exit Priority
1. Stop loss (immediate)
2. Take profit (immediate)
3. Trailing stop (if active)
4. FR normalization (signal-based)
5. Time-based (failsafe)

### Risk Management

**Position Sizing**: 50% of equity, vol-adjusted
**Max Risk Per Trade**: ~5% of equity (2.0 ATR stop on 50% position)
**Max Concurrent Positions**: 1
**Max Drawdown Limit**: If equity drops 15% from peak, pause trading for 48 bars
**Leverage**: 1x (no additional leverage in backtest; the edge is in timing, not leverage)

### Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| frPercentile | number | 3 | 15 | 2 | 10 | FR percentile threshold for entry |
| frLookback | number | 60 | 180 | 30 | 90 | FR observations for percentile |
| emaFast | number | 5 | 13 | 2 | 8 | Fast EMA period |
| emaSlow | number | 18 | 34 | 4 | 21 | Slow EMA period |
| rsiPeriod | number | 10 | 18 | 2 | 14 | RSI period |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | Stop loss in ATR units |
| atrTPMultiplier | number | 2.0 | 4.0 | 0.5 | 3.0 | Take profit in ATR units |
| trendSMAPeriod | number | 100 | 300 | 50 | 200 | Trend filter SMA period |
| positionSizePct | number | 30 | 70 | 10 | 50 | Position size as % of equity |
| holdingBars | number | 24 | 96 | 24 | 48 | Max hold in 5m bars |

**Optimization Notes**:
- frPercentile is the most sensitive parameter -- too loose (15%) = too many signals, too tight (3%) = too few
- EMA periods should maintain emaFast < emaSlow (constraint)
- Keep max-combinations under 200 for 5m data (5m backtests are ~5x slower than 4h)
- Run on 3-month windows first, then extend to full period

### System Gaps

**1. 5m Candle Data**
- **What**: Need to cache 5m candle data from Bybit for test assets
- **Complexity**: Simple
- **Priority**: Critical
- **Implementation**: Use existing `scripts/cache-candles.ts` with `--timeframe=5m`

**2. Optimizer 5m Performance**
- **What**: 5m data over 2 years = ~210,000 bars. Grid search needs to be efficient.
- **Complexity**: Medium (already handled with --optimize-timeframe flag)
- **Priority**: High

### Implementation Prompt

---

#### FOR THE BE-DEV AGENT

You are implementing the **FR Regime Momentum Rider** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy uses 4h funding rate extremes as a regime filter and 5m EMA crossovers for entry timing. It is essentially FR V2 with better execution timing.

This strategy:
- Runs on **5m** timeframe
- Uses **funding rate percentile** as entry gate (regime filter)
- Uses **EMA crossover + RSI** on 5m for entry timing
- Uses **ATR-based stops/TP** and **FR normalization exit**
- Uses **SMA(200)** on 5m as trend filter (same protective role as FR V2)

#### Strategy Implementation

**File Location**: `/workspace/strategies/fr-regime-momentum.ts`

#### Step 1: Imports and Setup

```typescript
import { SMA, EMA, RSI, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';
```

#### Step 2: Helper Functions

Implement these helpers (similar to FR V2):
- `calculateEMA(closes, period)` - returns padded EMA array
- `calculateSMA(closes, period)` - returns padded SMA array
- `calculateRSI(closes, period)` - returns padded RSI array
- `calculateATR(highs, lows, closes, period)` - returns padded ATR array
- `calcPercentile(arr, p)` - returns percentile value from sorted array
- `clamp(val, min, max)` - clamp helper
- `mean(arr)` - average helper

#### Step 3: Strategy State Interface

```typescript
interface StrategyState {
  _entryATR: number;       // ATR at entry for fixed stop/TP
  _trailActive: boolean;   // Trailing stop activated
  _trailStop: number;      // Current trailing stop price
  _entryBarIndex: number;  // Bar index at entry for time exit
}
```

#### Step 4: Define Parameters

Use the parameter table from the specification above. All parameters should have the exact names, types, defaults, mins, maxes, and steps specified.

#### Step 5: Implement init() Hook

```typescript
init(context: StrategyContext): void {
  const self = this as unknown as StrategyState;
  self._entryATR = 0;
  self._trailActive = false;
  self._trailStop = 0;
  self._entryBarIndex = 0;
  context.log('Initialized fr-regime-momentum');
}
```

#### Step 6: Implement onBar() Hook

This is the core logic. Follow this sequence:

**A. Extract all parameters**

**B. Early return checks:**
- No funding rates available: return
- currentIndex < max(trendSMAPeriod, emaSlow, atrPeriod + 1): return

**C. Get current funding rate and calculate percentile:**
- Filter fundingRates to those with timestamp <= currentCandle.timestamp
- Get the most recent FR
- Calculate percentile using the last `frLookback` FR observations
- Determine regime: `isExtremeNegFR` = current FR rank < frPercentile, `isExtremePosFR` = current FR rank > (100 - frPercentile)

**D. Calculate all 5m indicators:**
- closes, highs, lows from candleView
- EMA fast and slow
- RSI
- ATR
- SMA for trend filter
- Get current and previous values for crossover detection

**E. MANAGE EXISTING POSITIONS (exits first):**

For long positions:
1. Stop loss: candle.low <= entryPrice - entryATR * atrStopMultiplier -> closeLong
2. Take profit: candle.high >= entryPrice + entryATR * atrTPMultiplier -> closeLong
3. Trailing stop: if unrealized profit > 1.5 * ATR, activate trail. Trail at 1.5 * currentATR below high. Ratchet up only.
4. FR normalization: if current FR has risen above 25th percentile (for longs) -> closeLong
5. Time exit: if (currentIndex - entryBarIndex) >= holdingBars -> closeLong

For short positions:
- Mirror all conditions

**F. ENTRY PIPELINE (no position):**

For long entry (FR extremely negative):
1. isExtremeNegFR must be true
2. price > SMA(trendSMAPeriod) (trend filter)
3. EMA(fast) crossed above EMA(slow) (prev fast <= prev slow AND current fast > current slow)
4. RSI between 30 and 55
5. Calculate vol-adjusted position size: basePct * (avgATR / currentATR), clamped to [30%, 70%]
6. Open long

For short entry (FR extremely positive):
1. isExtremePosFR must be true
2. price < SMA(trendSMAPeriod)
3. EMA(fast) crossed below EMA(slow)
4. RSI between 45 and 70
5. Open short

**G. On entry, store:**
- self._entryATR = currentATR
- self._entryBarIndex = currentIndex
- resetTrail(self)

#### Step 7: Implement onEnd() Hook

Close any remaining positions. Reset state.

#### Step 8: Export

```typescript
export default strategy;
```

#### Validation Checklist

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates: `npx tsx src/cli/quant-validate.ts strategies/fr-regime-momentum.ts`
- [ ] Quick backtest generates trades: `npx tsx src/cli/quant-backtest.ts --strategy=fr-regime-momentum --symbol=LDO/USDT:USDT --timeframe=5m --from=2024-07-01 --to=2024-10-01 --mode=futures`
- [ ] Parameters within specified ranges
- [ ] Risk management enforced (stops, position sizing)
- [ ] FR normalization exit works correctly

#### Edge Cases

1. No funding rates for early bars: return early
2. FR lookback shorter than frLookback: use available history, require minimum 10
3. EMA/RSI undefined for early bars: return early
4. Division by zero in vol adjustment: check currentATR > 0
5. Time exit: compare bar indices, not timestamps (simpler on 5m)

#### Testing Instructions

```bash
# Cache 5m data first (if not already cached)
npx tsx scripts/cache-candles.ts --exchange=bybit --symbol=LDO/USDT:USDT --timeframe=5m --from=2024-01-01

# Validate
npx tsx src/cli/quant-validate.ts strategies/fr-regime-momentum.ts

# Quick backtest (3 months)
npx tsx src/cli/quant-backtest.ts --strategy=fr-regime-momentum --symbol=LDO/USDT:USDT --timeframe=5m --from=2024-07-01 --to=2024-10-01 --mode=futures 2>logs.txt

# Grid search (small range first)
npx tsx src/cli/quant-optimize.ts --strategy=fr-regime-momentum --symbol=LDO/USDT:USDT --timeframe=5m --from=2024-07-01 --to=2024-10-01 --mode=futures --max-combinations=50
```

---

### END OF STRATEGY 1 IMPLEMENTATION PROMPT

---

### Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.0
- Target Win Rate: 50-60%
- Target Total Return: 15-30% per 3-month period
- Max Acceptable Drawdown: < 12%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.7
- Target OOS Degradation: < 30%
- Max Acceptable Drawdown: < 15%

**Trading Activity**:
- Expected Trades per Month: 10-25 (FR extremes happen ~3-8 times per month per asset)
- Average Trade Duration: 2-8 hours (8-48 five-minute bars)
- Typical Position Size: 50% of equity

**Comparison to FR V2**:
- FR V2 on 4h: ~3-6 trades/month, Sharpe 1.69 on LDO
- This strategy: ~10-25 trades/month, target Sharpe 1.0+ on same assets
- More trades = more data points for statistical confidence
- Better entries = potentially lower drawdown per trade

---

## Strategy 2: FR Volatility Expansion Catcher

### Hypothesis

Extreme funding rates are a leading indicator of volatility expansion. When FR reaches extreme levels, a large move is imminent -- either continuation (if FR keeps climbing) or reversal (mean-reversion). Rather than predicting direction upfront, this strategy waits for the volatility expansion to BEGIN, then rides it. The key insight: on 5m, we can detect the first bar of a volatility expansion (via ATR breakout or range expansion) and ride the initial thrust.

**Core Edge**: Extreme FR = coiled spring. The direction is uncertain, but the expansion is highly probable. By waiting for the expansion to start (instead of predicting direction), we reduce false signals and only trade confirmed moves.

**Why This Edge Persists**: Same structural reasons as FR V2. Additionally, volatility clustering (GARCH effects) means that the first bar of expansion predicts 3-5 more bars of elevated volatility.

**Academic/Empirical Backing**:
- GARCH persistence (beta > 0.7-0.9) in crypto confirmed by multiple studies
- Ruan & Streltsov: Trading activity follows U-shaped pattern within funding cycles, with highest activity near settlements -- this IS the volatility expansion
- Amberdata: "Sudden funding spikes often precede sharp price movements"
- Our failed volatility breakout scalper proved that BB squeeze alone (without FR context) produces too many false positives. Adding FR as a regime filter should dramatically reduce false signals.

### Classification

**Style**: Volatility / Breakout (FR-conditioned)
**Holding Period**: Intraday scalp (15 min - 2 hours)
**Complexity**: Multi-TF single-asset (4h FR + 5m execution)
**Market Type**: Futures

### Timeframe Configuration

**Primary Timeframe**: 5m
- Purpose: Detect volatility expansion and ride the initial thrust
- Rationale: 5m catches expansion faster than 15m but avoids 1m noise

**Higher Timeframe**: 4h (via funding rate)
- Purpose: Identify when the market is "coiled" (extreme FR)
- How Used: Gate -- only look for volatility expansion when FR is extreme

### Asset Configuration

Same as Strategy 1. Test on LDO, DOGE, ICP, RPL, BTC.

### Indicators & Data Requirements

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| Funding Rate Percentile | 4h | Regime detection | lookback: 90, threshold: 15th percentile | Wider than Strategy 1 (more signals) |
| ATR | 5m | Volatility measurement | period: 14 | Compare current vs rolling average |
| ATR SMA | 5m | Baseline volatility | period: 50 (of ATR values) | Rolling average for comparison |
| Bollinger Bands | 5m | Squeeze detection | period: 20, stdDev: 2.0 | Secondary confirmation |
| Volume SMA | 5m | Volume confirmation | period: 20 | Volume spike = real expansion |

### Entry Logic

#### Entry Conditions (Direction-Agnostic Detection, Then Direction-Specific Entry)

**Step 1: FR Regime Check (Gate)**
- Current FR is in top 15% OR bottom 15% of the last 90 observations
- This is looser than Strategy 1 (15% vs 10%) because we want more opportunities

**Step 2: Volatility Expansion Detection**
- Current ATR > atrExpansionMultiplier * SMA(ATR, 50) (e.g., 1.5x average ATR)
- Current bar range (high - low) > rangeExpansionMultiplier * ATR (e.g., 1.5x ATR)
- Volume > volumeMultiplier * SMA(volume, 20) (e.g., 2.0x)
- ALL three conditions must be true (expansion confirmed on volatility, range, and volume)

**Step 3: Direction Determination**
- If candle is bullish (close > open, close in top 30% of range) -> long candidate
- If candle is bearish (close < open, close in bottom 30% of range) -> short candidate

**Step 4: FR Alignment Check**
- For LONG: FR should be extremely NEGATIVE (bottom 15%) -- contrarian, same logic as FR V2
  - OR: FR is extremely POSITIVE and candle is bearish -> short (fading the crowd)
- Basically: trade in the contrarian FR direction, but only when volatility expansion confirms the reversal is starting

**Position Sizing**: Same vol-adjusted approach as Strategy 1.

#### Short Entry
Mirror conditions.

### Exit Logic

#### Stop Loss
- ATR-based: entryPrice +/- entryATR * 1.5 (tighter than Strategy 1 because breakouts are directional)

#### Take Profit
- ATR-based: entryPrice +/- entryATR * 2.5 (moderate target)
- Partial exit: none (keep it simple)

#### Trailing Stop
- Activates after 1.0 * ATR of profit
- Trail at 1.0 * currentATR from best price
- Tighter trail because volatility expansion moves are fast

#### Time-Based Exit
- Max hold: 24 bars (2 hours on 5m) -- volatility expansion is fast; if it hasn't moved by then, the thesis failed

#### Exit Priority
1. Stop loss
2. Take profit
3. Trailing stop
4. Time-based

### Risk Management

**Position Sizing**: 40% of equity (slightly smaller than Strategy 1 due to higher frequency)
**Max Concurrent Positions**: 1
**Cooldown**: After a stop loss, wait 6 bars (30 min) before next entry

### Parameter Ranges

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| frPercentile | number | 10 | 20 | 5 | 15 | FR percentile threshold |
| frLookback | number | 60 | 180 | 30 | 90 | FR lookback observations |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrExpansionMult | number | 1.2 | 2.0 | 0.2 | 1.5 | ATR expansion multiplier |
| rangeExpansionMult | number | 1.2 | 2.0 | 0.2 | 1.5 | Range expansion multiplier |
| volumeMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | Volume surge multiplier |
| atrStopMult | number | 1.0 | 2.0 | 0.5 | 1.5 | Stop loss ATR multiplier |
| atrTPMult | number | 2.0 | 3.5 | 0.5 | 2.5 | Take profit ATR multiplier |
| holdingBars | number | 12 | 36 | 6 | 24 | Max hold in 5m bars |
| positionSizePct | number | 20 | 50 | 10 | 40 | Position size % |

### System Gaps

Same as Strategy 1 (5m data caching). No additional gaps.

### Implementation Prompt

---

#### FOR THE BE-DEV AGENT

You are implementing the **FR Volatility Expansion Catcher** strategy.

#### Strategy Overview

This strategy uses extreme FR as a regime filter, then detects volatility expansion on 5m (via ATR spike + range expansion + volume surge) and trades in the contrarian FR direction.

**File Location**: `/workspace/strategies/fr-vol-expansion.ts`

#### Key Differences from Strategy 1

- No EMA crossover -- uses volatility expansion as entry trigger instead
- No trend filter (SMA 200) -- volatility expansion IS the trigger regardless of trend
- Tighter stops and shorter holding period (breakout style vs mean-reversion style)
- Direction is determined by candle color on the expansion bar, aligned with contrarian FR direction

#### Implementation Steps

1. **Imports**: Same as Strategy 1 (SMA, ATR from technicalindicators)
2. **Helpers**: calculateATR, calcPercentile, mean, clamp (copy from Strategy 1)
3. **State**: `_entryATR`, `_trailActive`, `_trailStop`, `_entryBarIndex`, `_cooldownUntil`
4. **Parameters**: As defined in table above
5. **init()**: Reset all state, set cooldownUntil = 0
6. **onBar()** logic:

```
A. Extract params
B. Early returns (no FR, insufficient data)
C. Get FR percentile (same as Strategy 1)
D. Calculate indicators:
   - ATR values, rolling average ATR (last 50 bars)
   - Volume SMA (20 bars)
   - Current bar range = high - low
E. EXITS (same pattern as Strategy 1 but with tighter parameters)
F. ENTRIES:
   - Check cooldown: if currentIndex < cooldownUntil, skip
   - Check FR regime: isExtremeNeg OR isExtremePos
   - Check expansion: currentATR > atrExpansionMult * avgATR
                   AND currentRange > rangeExpansionMult * currentATR
                   AND currentVolume > volumeMultiplier * avgVolume
   - Check direction + FR alignment:
     If isExtremePos (shorts paying, crowd is long) AND candle bearish -> openShort
     If isExtremeNeg (longs paying, crowd is short) AND candle bullish -> openLong
   - On entry: store ATR, barIndex, reset trail
   - On stop loss: set cooldownUntil = currentIndex + 6
```

7. **onEnd()**: Close remaining positions

#### Validation Checklist

Same as Strategy 1. Use same test symbols and date ranges.

```bash
npx tsx src/cli/quant-validate.ts strategies/fr-vol-expansion.ts
npx tsx src/cli/quant-backtest.ts --strategy=fr-vol-expansion --symbol=LDO/USDT:USDT --timeframe=5m --from=2024-07-01 --to=2024-10-01 --mode=futures
```

---

### Expected Performance

- Fewer trades than Strategy 1 (volatility expansion + FR extreme is rare)
- Expected 5-15 trades per month per asset
- Higher win rate (confirmed expansion = real move)
- Target Sharpe: > 0.8
- Target MaxDD: < 10%

---

## Strategy 3: FR Gradient Momentum

### Hypothesis

The RATE OF CHANGE of funding rate is more informative than the level. When FR is accelerating (getting more extreme rapidly), it signals increasing leverage pressure that will soon snap. When FR is decelerating (extreme but flattening), the reversal is imminent. By tracking FR gradient (delta between consecutive FR readings), we can time entries better.

**Core Edge**: FR V2 uses FR LEVEL (percentile). This strategy uses FR VELOCITY (rate of change). A rapidly accelerating FR toward an extreme means traders are piling in aggressively -- the snapback will be violent. A decelerating FR means the extreme is peaking -- the reversal is about to start.

**Why This Edge Persists**: FR gradient captures the DYNAMICS of leverage imbalance, not just the static level. This is information that simple percentile thresholds miss.

**Academic/Empirical Backing**:
- Inan (2025): DAR models predict FR using autoregressive terms -- confirming FR has predictable dynamics
- Dobrynskaya (2021, SSRN 3913263): Cryptocurrency momentum reversal happens faster than equities ("faster metabolism") -- gradient captures this
- FR V2 already has an optional `useFRVelocity` parameter that was disabled by default. This strategy makes velocity the PRIMARY signal.

### Classification

**Style**: Mean Reversion (FR-gradient-conditioned)
**Holding Period**: Intraday (2-8 hours)
**Complexity**: Multi-TF single-asset
**Market Type**: Futures

### Timeframe Configuration

**Primary Timeframe**: 15m
- Purpose: Entry timing and position management
- Rationale: 15m is chosen instead of 5m because FR gradient is a slower-moving signal. FR updates every 8h, so the gradient changes slowly. 15m gives enough bars for clean technical signals while matching the slower FR dynamics.

**Higher Timeframe**: 8h (via funding rate data)
- Purpose: Track FR gradient and detect peak/trough of FR cycle

### Asset Configuration

Same as Strategies 1 and 2.

### Indicators & Data Requirements

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| FR Gradient | 8h intervals | Primary signal | lookback: 3 FR readings | delta = FR[n] - FR[n-1] |
| FR Percentile | 8h intervals | Regime confirmation | lookback: 90, threshold: 20 | Wider gate |
| EMA | 15m | Entry timing | fast: 9, slow: 21 | Crossover on 15m |
| RSI | 15m | Momentum confirmation | period: 14 | Standard |
| ATR | 15m | Risk management | period: 14 | Stops and TP |
| SMA | 15m | Trend filter | period: 100 (~25 hours) | Protective |

### Entry Logic

#### Long Entry (FR was extremely negative, now decelerating/reversing)

1. **FR Percentile Gate**: FR is below 20th percentile (extreme negative territory)
2. **FR Gradient Signal**: FR gradient has turned positive (FR[n] > FR[n-1])
   - This means FR was deeply negative but is now becoming LESS negative
   - The shorts are starting to unwind -- the mean reversion is beginning
3. **EMA Crossover on 15m**: Fast EMA crossed above Slow EMA (confirming price is responding)
4. **RSI between 35-60**: Room to run
5. **Price above SMA(100) on 15m**: Trend filter

#### Short Entry (FR was extremely positive, now decelerating/reversing)

1. FR above 80th percentile
2. FR gradient turned negative (FR[n] < FR[n-1])
3. Fast EMA crossed below Slow EMA
4. RSI between 40-65
5. Price below SMA(100) on 15m

### Exit Logic

Same structure as Strategy 1:
- ATR stop: 2.5 * entryATR
- ATR TP: 4.0 * entryATR (wider -- 15m moves are larger)
- FR normalization: exit when FR returns to 30th-70th percentile range
- Trailing stop: activates at 2.0 * ATR profit, trails at 2.0 * currentATR
- Time exit: 32 bars (8 hours on 15m, one full funding cycle)

### Risk Management

**Position Sizing**: 50% of equity
**Max Hold**: 8 hours (one funding cycle)

### Parameter Ranges

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| frPercentile | number | 10 | 25 | 5 | 20 | FR percentile threshold |
| frLookback | number | 60 | 180 | 30 | 90 | FR lookback |
| frGradientBars | number | 1 | 3 | 1 | 1 | FR readings for gradient |
| emaFast | number | 5 | 13 | 2 | 9 | Fast EMA period |
| emaSlow | number | 18 | 34 | 4 | 21 | Slow EMA period |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMult | number | 2.0 | 3.5 | 0.5 | 2.5 | Stop loss multiplier |
| atrTPMult | number | 3.0 | 5.0 | 0.5 | 4.0 | Take profit multiplier |
| trendSMAPeriod | number | 50 | 150 | 25 | 100 | Trend SMA period |
| holdingBars | number | 16 | 48 | 8 | 32 | Max hold (15m bars) |
| positionSizePct | number | 30 | 70 | 10 | 50 | Position size % |

### System Gaps

**1. 15m Candle Data**
- Need to cache 15m data from Bybit (or aggregate from 5m/1m)
- Simple: use `cache-candles.ts --timeframe=15m`

### Implementation Prompt

---

#### FOR THE BE-DEV AGENT

You are implementing the **FR Gradient Momentum** strategy.

**File Location**: `/workspace/strategies/fr-gradient-momentum.ts`

#### Key Difference from Strategies 1 and 2

The PRIMARY signal is FR gradient (rate of change), not FR level. Entry requires:
1. FR is in extreme territory (percentile gate)
2. FR gradient has TURNED (FR is becoming less extreme = reversal starting)
3. 15m EMA crossover confirms price is responding
4. Trend filter and RSI confirmation

#### FR Gradient Calculation

```typescript
// Get last N+1 funding rate observations
const recentFRs = fundingRates.filter(fr => fr.timestamp <= currentCandle.timestamp);
const latestFR = recentFRs[recentFRs.length - 1].fundingRate;
const prevFR = recentFRs[recentFRs.length - 1 - frGradientBars]?.fundingRate;

if (prevFR === undefined) return;

const frGradient = latestFR - prevFR;
// Positive gradient: FR moving up (becoming more positive / less negative)
// Negative gradient: FR moving down (becoming more negative / less positive)
```

#### Signal Logic

```
For LONG:
  - frPercentileRank < frPercentile (extreme negative)
  - frGradient > 0 (FR turning less negative = shorts unwinding)
  - EMA fast crossed above EMA slow
  - RSI in [35, 60]
  - price > SMA(trendSMAPeriod)

For SHORT:
  - frPercentileRank > (100 - frPercentile) (extreme positive)
  - frGradient < 0 (FR turning less positive = longs unwinding)
  - EMA fast crossed below EMA slow
  - RSI in [40, 65]
  - price < SMA(trendSMAPeriod)
```

Follow the same implementation pattern as Strategy 1 (exit logic, state management, etc.) but with 15m-appropriate ATR multipliers and holding periods.

#### Testing

```bash
npx tsx scripts/cache-candles.ts --exchange=bybit --symbol=LDO/USDT:USDT --timeframe=15m --from=2024-01-01
npx tsx src/cli/quant-validate.ts strategies/fr-gradient-momentum.ts
npx tsx src/cli/quant-backtest.ts --strategy=fr-gradient-momentum --symbol=LDO/USDT:USDT --timeframe=15m --from=2024-07-01 --to=2024-10-01 --mode=futures
```

---

### Expected Performance

- Fewer trades than Strategy 1 (gradient turning is rarer than level being extreme)
- Expected 5-12 trades per month per asset
- Higher conviction per trade (gradient + level + price confirmation = triple filter)
- Target Sharpe: > 1.0
- Target MaxDD: < 10%

---

## Strategy 4: FR Cycle Position Builder

### Hypothesis

Instead of trying to time the exact entry/exit on a short timeframe, this strategy takes a PORTFOLIO approach to the FR cycle. When FR enters extreme territory, it opens a SMALL initial position. As the FR signal strengthens (FR gets more extreme or starts reversing), it adds to the position. As FR normalizes, it scales out. This mimics how professional traders build and manage positions during a thesis -- they don't go all-in at one price.

**Core Edge**: All our previous strategies (including FR V2) enter 100% of the position at one moment. This creates a single entry price that may be suboptimal. By scaling in over 3-5 entries as the setup develops, we get a better average entry and reduce the impact of timing errors.

**Why This Edge Persists**: Position building is standard practice among professional traders but rarely implemented in backtesting systems because it is more complex. The edge is in execution discipline, not new information.

**Academic/Empirical Backing**:
- Dollar-cost-averaging into momentum positions is documented in portfolio management literature
- Our own data shows FR V2 sometimes enters at the PEAK of the FR extreme (worst entry) -- scaling in would avoid this
- Adaptive position sizing based on signal strength is used by systematic funds (AQR, Bridgewater)

### Classification

**Style**: Mean Reversion (FR-conditioned, scaled entry)
**Holding Period**: Swing (4-24 hours)
**Complexity**: Multi-TF single-asset
**Market Type**: Futures

### Timeframe Configuration

**Primary Timeframe**: 15m
- Purpose: Entry timing for each "tranche" of the position
- Rationale: 15m is granular enough for position building over several hours

**Higher Timeframe**: 8h (funding rate)
- Purpose: Signal source and position management trigger

### Entry Logic

This strategy has a STATE MACHINE with 3 stages:

**Stage 0: IDLE**
- No position. Monitoring FR percentile.
- Transition to Stage 1 when FR enters extreme territory (top/bottom 15%)

**Stage 1: INITIAL ENTRY (Tranche 1 = 25% of target position)**
- FR is extreme AND RSI(14) on 15m shows the market is not yet oversold/overbought in the counter direction
- Open 25% of target position size in the contrarian direction
- Set wide stop: 3.0 * ATR from entry
- Transition to Stage 2

**Stage 2: ADD TO POSITION (Tranche 2 = 25% of target, total 50%)**
- Wait for EITHER:
  a. FR gradient turns (FR starts normalizing), confirming the reversal, OR
  b. Price moves 1.0 * ATR in our favor (momentum confirmation)
- Add 25% more to the position
- Move stop to breakeven on tranche 1 (partial risk reduction)
- Transition to Stage 3

**Stage 3: FULL POSITION (Optional Tranche 3 = 25% of target, total 75%)**
- Wait for EMA crossover on 15m confirming direction
- Add final 25% tranche
- Activate trailing stop on the whole position
- Manage exits normally (ATR stop, FR normalization, time)

**At any stage**: If stop hit, close entire position. If FR normalizes before reaching Stage 3, close at whatever size.

### Exit Logic

- ATR trailing stop: Activates automatically at Stage 3. Trails at 2.0 * ATR.
- FR normalization: Close when FR returns to 30-70th percentile range
- Emergency stop: 3.0 * ATR from average entry price (applies at all stages)
- Time: Max 48 bars (12 hours on 15m)

### Parameter Ranges

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| frPercentile | number | 10 | 20 | 5 | 15 | FR threshold for Stage 1 |
| frLookback | number | 60 | 180 | 30 | 90 | FR lookback |
| tranche1Pct | number | 15 | 35 | 5 | 25 | First tranche size % of target |
| tranche2Pct | number | 15 | 35 | 5 | 25 | Second tranche size |
| tranche3Pct | number | 15 | 35 | 5 | 25 | Third tranche size |
| targetPositionPct | number | 40 | 70 | 10 | 60 | Total target position % |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMult | number | 2.5 | 4.0 | 0.5 | 3.0 | Emergency stop multiplier |
| addProfitATR | number | 0.5 | 1.5 | 0.5 | 1.0 | ATR profit for add trigger |
| trailATR | number | 1.5 | 2.5 | 0.5 | 2.0 | Trail distance multiplier |
| holdingBars | number | 24 | 64 | 8 | 48 | Max hold (15m bars) |
| emaFast | number | 5 | 13 | 2 | 9 | Fast EMA for Stage 3 |
| emaSlow | number | 18 | 34 | 4 | 21 | Slow EMA for Stage 3 |

### System Gaps

**1. Partial Position Opening**
- **What**: Current strategy interface uses `openLong(amount)` which opens a position. Calling it again while in a position might not ADD to the position -- it depends on engine behavior.
- **Complexity**: Medium -- need to verify and possibly modify engine to support position scaling
- **Priority**: HIGH -- this strategy fundamentally requires position building
- **Workaround**: If engine does not support adding to positions, track "virtual tranches" in strategy state and open the full position at Stage 1 but manage risk as if it were scaled. This loses the scaling benefit but retains the staged exit logic.

### Implementation Prompt

---

#### FOR THE BE-DEV AGENT

You are implementing the **FR Cycle Position Builder** strategy.

**File Location**: `/workspace/strategies/fr-cycle-builder.ts`

#### Critical Design Note

This strategy builds positions in 3 tranches. FIRST, verify how the engine handles multiple `openLong()` calls when a position is already open:
- If the engine adds to the position: implement as described (3 separate openLong calls)
- If the engine rejects or replaces: use the WORKAROUND below

**WORKAROUND** (if engine does not support position scaling):
- Open the FULL target position (60% of equity) at Stage 1
- Use the state machine ONLY for exit management
- Stage 1 entry: open full position, set wide stop (3.0 ATR)
- Stage 2 trigger: tighten stop to 2.0 ATR
- Stage 3 trigger: activate trailing stop at 2.0 ATR
- This still captures the key idea (progressive risk reduction as signal strengthens)

#### State Machine Implementation

```typescript
interface StrategyState {
  _stage: 0 | 1 | 2 | 3;     // Current stage
  _entryPrice: number;         // Average entry price
  _entryATR: number;          // ATR at initial entry
  _entryBarIndex: number;     // Bar of initial entry
  _trailActive: boolean;
  _trailStop: number;
  _positionSize: number;      // Current total position size
}
```

The onBar logic should:
1. Check exits for existing positions (all stages)
2. Check for stage transitions (Stage 0->1, 1->2, 2->3)
3. Execute entries/additions based on stage transitions

#### Testing

```bash
npx tsx src/cli/quant-validate.ts strategies/fr-cycle-builder.ts
npx tsx src/cli/quant-backtest.ts --strategy=fr-cycle-builder --symbol=LDO/USDT:USDT --timeframe=15m --from=2024-07-01 --to=2024-10-01 --mode=futures
```

---

### Expected Performance

- Same trade frequency as Strategy 3 (5-12 per month)
- Better average entry price due to scaling
- Lower drawdown per trade (progressive stop tightening)
- Target Sharpe: > 1.0
- Target MaxDD: < 8%

---

## Strategy 5: FR + Post-Settlement Drift

### Hypothesis

The Ruan & Streltsov U-shaped pattern within 8h funding cycles shows that activity and spreads are elevated near settlement times. After settlement, when FR was extreme, there is often a "relief move" as the pressure that built up pre-settlement dissipates. This is different from the failed FR Settlement Scalper because:

1. We trade AFTER settlement (not before) -- waiting for confirmation
2. We only trade when FR was extreme (not every settlement)
3. We use 15m timeframe (not 1m) -- reducing noise
4. We look for price action confirmation (not just time-based entry)

**Core Edge**: Post-settlement, traders who were paying extreme funding are relieved of that pressure. Some close their positions (no more funding cost motivation to hold), while others who were COLLECTING funding lose their edge. This creates a directional drift in the 1-4 hours after settlement.

**Direction**: After extreme POSITIVE FR settlement (longs paid shorts), the post-settlement drift is BEARISH because:
- Funding-collecting shorts take profit (buying = brief bullish)
- But the underlying imbalance (too many longs) persists
- Longs who just paid funding are demoralized and start closing -> selling pressure

After extreme NEGATIVE FR: drift is BULLISH (mirror logic).

### Classification

**Style**: Momentum (post-settlement drift)
**Holding Period**: Intraday (1-4 hours)
**Complexity**: Multi-TF single-asset
**Market Type**: Futures

### Timeframe Configuration

**Primary Timeframe**: 15m
- Purpose: Entry and exit management
- Rationale: Settlement effects play out over hours. 15m = 16 bars in 4 hours, enough granularity.

**Settlement Clock**: UTC time awareness
- Need to know when the last settlement occurred (00:00, 08:00, 16:00 UTC)
- Only enter within the first 2 hours after settlement (8 bars on 15m)

### Entry Logic

1. **Post-Settlement Window**: Current candle is within 0-120 minutes after a funding settlement
   - Calculate: time since last settlement = (currentTimestamp - lastSettlementTimestamp)
   - Last settlement = most recent of {00:00, 08:00, 16:00 UTC} before current time

2. **FR Was Extreme at Settlement**: The FR that was just settled was in top/bottom 15 percentile

3. **Price Action Confirmation on 15m**:
   - For bearish drift (after extreme positive FR): first 15m candle after settlement is bearish (close < open)
   - For bullish drift (after extreme negative FR): first 15m candle is bullish

4. **RSI Confirmation**: RSI(14) is moving in the drift direction
   - Bearish: RSI < 50 and falling
   - Bullish: RSI > 50 and rising

5. **Enter at close of the confirmation candle** (15-30 min after settlement)

### Exit Logic

- ATR stop: 2.0 * ATR (standard)
- Time exit: 16 bars (4 hours) -- the drift effect expires before the next settlement cycle
- FR normalization: not applicable (we are trading post-settlement drift, not FR level)
- Trailing stop: activates at 1.5 * ATR profit, trails at 1.5 * ATR
- Target: 3.0 * ATR

### Parameter Ranges

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| frPercentile | number | 10 | 20 | 5 | 15 | FR extreme threshold |
| frLookback | number | 60 | 180 | 30 | 90 | FR lookback |
| postSettlementWindowBars | number | 4 | 12 | 2 | 8 | Bars after settlement to enter |
| rsiPeriod | number | 10 | 18 | 2 | 14 | RSI period |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMult | number | 1.5 | 2.5 | 0.5 | 2.0 | Stop multiplier |
| atrTPMult | number | 2.0 | 4.0 | 0.5 | 3.0 | TP multiplier |
| holdingBars | number | 8 | 24 | 4 | 16 | Max hold (15m bars) |
| positionSizePct | number | 30 | 70 | 10 | 50 | Position size % |

### System Gaps

**1. Settlement Timestamp Detection**
- **What**: Strategy needs to detect the most recent settlement time from the candle timestamp
- **Complexity**: Simple -- `Math.floor(utcHours / 8) * 8` gives last settlement hour
- **Implementation**: Helper function within the strategy

### Implementation Prompt

---

#### FOR THE BE-DEV AGENT

You are implementing the **FR Post-Settlement Drift** strategy.

**File Location**: `/workspace/strategies/fr-post-settlement-drift.ts`

#### Key Helper: Settlement Time Detection

```typescript
function getLastSettlementTimestamp(currentTimestampMs: number): number {
  const date = new Date(currentTimestampMs);
  const hours = date.getUTCHours();
  const settlementHour = Math.floor(hours / 8) * 8; // 0, 8, or 16
  const settlement = new Date(date);
  settlement.setUTCHours(settlementHour, 0, 0, 0);
  return settlement.getTime();
}

function barsSinceSettlement(currentTimestampMs: number, barDurationMs: number): number {
  const lastSettlement = getLastSettlementTimestamp(currentTimestampMs);
  return Math.floor((currentTimestampMs - lastSettlement) / barDurationMs);
}
```

#### Signal Logic

```
A. Calculate barsSinceSettlement (15m bars = 900000ms)
B. If barsSinceSettlement > postSettlementWindowBars: return (too late)
C. Get the FR that was active at the settlement:
   - Find the FR with timestamp closest to (but <= ) the settlement time
D. Calculate its percentile rank in recent history
E. If FR was extreme positive: look for bearish confirmation
   If FR was extreme negative: look for bullish confirmation
F. Confirmation = first 15m candle after settlement is in the expected direction
G. RSI confirmation
H. Enter
```

#### Testing

```bash
npx tsx src/cli/quant-validate.ts strategies/fr-post-settlement-drift.ts
npx tsx src/cli/quant-backtest.ts --strategy=fr-post-settlement-drift --symbol=LDO/USDT:USDT --timeframe=15m --from=2024-07-01 --to=2024-10-01 --mode=futures
```

---

### Expected Performance

- 3 settlement windows per day, but only extreme ones qualify: ~5-10 trades per month per asset
- Win rate: 55-65% (drift is well-documented)
- Target Sharpe: > 0.8
- Target MaxDD: < 10%

---

## Strategy Priority Ranking

| Rank | Strategy | Confidence | Edge Source | Novelty | Timeframe | Implementation |
|------|----------|-----------|-----------|---------|-----------|----------------|
| 1 | FR Regime Momentum Rider | HIGH (8/10) | FR V2 + better entries | Moderate | 5m | Medium |
| 2 | FR Gradient Momentum | HIGH (7.5/10) | FR velocity | High | 15m | Medium |
| 3 | FR Volatility Expansion | MEDIUM-HIGH (7/10) | FR + vol breakout | High | 5m | Simple |
| 4 | FR Post-Settlement Drift | MEDIUM (6.5/10) | Settlement microstructure | High | 15m | Simple |
| 5 | FR Cycle Position Builder | MEDIUM (6/10) | Position scaling | Moderate | 15m | Complex (engine gap) |

### Recommended Implementation Order

**Phase 1 (Immediate -- test core hypothesis)**:
1. **FR Regime Momentum Rider** (Strategy 1) -- most direct application of the "FR as regime filter" idea
2. **FR Gradient Momentum** (Strategy 3) -- tests whether FR velocity adds value over FR level

**Phase 2 (After Phase 1 results)**:
3. **FR Volatility Expansion** (Strategy 2) -- orthogonal approach (breakout vs mean reversion)
4. **FR Post-Settlement Drift** (Strategy 5) -- tests settlement timing hypothesis properly

**Phase 3 (If engine supports)**:
5. **FR Cycle Position Builder** (Strategy 4) -- requires position scaling or workaround

### Data Requirements Summary

All strategies require:
- Bybit perpetual futures candle data (5m and 15m)
- Funding rate data (already cached)
- Mode: futures

Assets to cache for testing:
- LDO/USDT:USDT, DOGE/USDT:USDT, ICP/USDT:USDT, RPL/USDT:USDT, BTC/USDT:USDT
- Timeframes: 5m, 15m
- Period: 2024-01-01 to 2026-03-01

---

## References

### Academic Papers
1. Ruan & Streltsov (2024), "Perpetual Futures Contracts and Cryptocurrency Market Quality" - [SSRN 4218907](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4218907)
   - Key finding: U-shaped activity within 8h funding cycles, informed trading at settlement
2. Inan (2025), "Predictability of Funding Rates" - [SSRN 5576424](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5576424)
   - Key finding: FR is predictable via DAR models, confirming gradient approach has merit
3. Ackerer, Hugonnier & Jermann (2024), "Perpetual Futures Pricing" - [Wharton](https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf)
   - Key finding: No-arbitrage pricing of perpetual contracts, funding rate anchors price to spot
4. Dobrynskaya (2021), "Cryptocurrency Momentum and Reversal" - [SSRN 3913263](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3913263)
   - Key finding: Momentum reversal in crypto is ~1 month, faster than equities
5. "The Two-Tiered Structure of Cryptocurrency Funding Rate Markets" (2026) - [MDPI](https://www.mdpi.com/2227-7390/14/2/346)
   - Key finding: 17% of observations show 20+ bp arbitrage spreads; CEX dominates price discovery
6. He & Manela (2022), "Fundamentals of Perpetual Futures" - [arXiv 2212.06888](https://arxiv.org/html/2212.06888v5)
   - Key finding: Basis dynamics and mean-reversion in perpetual futures

### Industry Research
1. [Amberdata Blog - Funding Rates](https://blog.amberdata.io/funding-rates-how-they-impact-perpetual-swap-positions)
2. [QuantJourney - Funding Rates Strategy Guide](https://quantjourney.substack.com/p/funding-rates-in-crypto-the-hidden)
3. [Cornell Business - Perpetual Futures Market Quality](https://business.cornell.edu/article/2025/02/perpetual-futures-contracts-and-cryptocurrency/)
4. [Bybit Dynamic Settlement Frequency](https://www.prnewswire.com/news-releases/bybit-launches-dynamic-settlement-frequency-system-for-perpetual-contracts-302598179.html)

### Our Own Research
1. FR V2 Complete Research: `/workspace/docs/2026-03-03-fr-v2-complete-research.md`
2. FR V2 Strategy Code: `/workspace/strategies/funding-rate-spike-v2.ts`
3. Failed HF Scalping Concepts: `/workspace/docs/strategies/2026-03-04-180000-hf-scalping-strategy-concepts.md`
4. Failed FR Settlement Scalper: `/workspace/strategies/fr-settlement-scalper.ts`
5. Failed Volatility Breakout Scalper: `/workspace/strategies/volatility-breakout-scalper.ts`

---

## Change Log

**Version 1.0** - 2026-03-05
- 5 strategy specifications based on "FR as regime filter" principle
- Learned from 2 failed 1m strategies
- Shifted to 5m and 15m execution timeframes
- All strategies use FR as gate/filter, not direct signal
- Detailed implementation prompts for each strategy
