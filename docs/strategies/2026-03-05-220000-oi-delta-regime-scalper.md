# Strategy: OI-Delta Regime Scalper

> **Created**: 2026-03-05 22:00
> **Author**: quant-lead agent (opus)
> **Status**: Draft
> **Rank**: 1 of 3 (Highest Feasibility)

## Executive Summary

Exploits the relationship between Open Interest (OI) rate-of-change and price direction on 15m timeframe. When OI spikes significantly (new leveraged positions entering) but price does not follow proportionally, the resulting divergence signals an overcrowded trade that will unwind. Combined with Funding Rate regime context, this creates a derivatives-native alpha signal that operates on a faster timescale than FR V2 (15m vs 4h) while avoiding the 1m noise trap that killed previous HF strategies.

---

## Hypothesis

**Core Edge**: When Open Interest increases rapidly (new leveraged positions flooding in) without commensurate price movement, it signals over-leveraged positioning that is vulnerable to liquidation cascades. Conversely, when price moves sharply but OI is declining, the move is driven by position closing (not new conviction) and is likely to reverse.

**Why This Edge Persists**:
1. **Structural**: Crypto perpetual futures allow up to 125x leverage. Retail traders pile into directional bets during momentum, creating overcrowded positions visible in OI data.
2. **Behavioral**: Herding behavior causes OI spikes at the worst possible times (near local tops/bottoms).
3. **Mechanical**: When these overcrowded positions get liquidated, the liquidations are market orders that push price further, overshooting equilibrium. The snapback is the alpha.
4. **Information asymmetry**: OI data is publicly available but most retail traders don't systematically monitor it for divergences.

**Market Conditions**:
- **Works best**: Volatile markets with frequent leverage cycles, meme coins, mid-cap alts with active futures.
- **Fails in**: Low-volatility consolidation (OI stays flat), strong trending markets where new positions are genuinely well-placed.

**Academic/Empirical Backing**:
- "Order Flow and Cryptocurrency Returns" (Anastasopoulos & Gradojevic, EFMA 2025) shows order flow delivers annualized Sharpe of 1.68 in crypto, with temporary price effects.
- "Microstructure and Market Dynamics in Crypto Markets" (Easley et al., SSRN 4814346) confirms order flow imbalances drive short-term crypto price predictability.
- Amberdata research documents liquidation zones as support/resistance with "reflexive feedback loops between leverage, liquidity, and volatility."
- "Anatomy of the Oct 2025 Crypto Liquidation Cascade" (Ali, SSRN 5611392) shows OI signals preceded price crashes by 7-20 days at macro level; we aim to capture the micro-level equivalent.

---

## Classification

**Style**: hybrid (mean-reversion + structural microstructure)

**Holding Period**: intraday (15 minutes to 4 hours, target 1-8 bars on 15m)

**Complexity**: Single-TF, single-asset with auxiliary OI and FR data feeds

**Market Type**: futures (requires OI data and leverage)

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 15m

**Purpose**: Main signal generation and trade management

**Rationale**:
- 15m is the sweet spot between noise (1m/5m) and slow structural (4h).
- Previous research proved 1m is too noisy (0.04% median BTC move < 0.105% fee breakeven). 15m median move is ~0.15-0.25%, which clears the fee hurdle.
- Bybit OI API supports 5min resolution -- 15m allows aggregating 3 OI readings per bar for smoother signal.
- Expected holding period of 1-8 bars (15 min to 2 hours) is long enough for OI-driven moves to play out.
- Previous FR V2 success on 4h suggests structural signals work on multi-bar timescales. 15m is a reasonable step down from 4h while avoiding 1m/5m noise.

### Secondary Timeframes

**Higher Timeframe**: 4h (via pre-cached funding rate data)
- **Purpose**: Regime filter via funding rate (reuse FR V2 logic)
- **How Used**: When FR is extreme (> absolute threshold), set regime bias. Only trade OI divergences that align with the FR regime direction.

### Timeframe Interaction

"When 4h FR indicates extreme positioning (bullish overcrowding), look for OI spikes on 15m that confirm the overcrowding is intensifying. Trade the reversal when OI starts declining (positions unwinding). This combines the proven FR structural edge with faster OI-based entry timing."

---

## Asset Configuration

### Primary Asset

**Asset**: DOGE/USDT (perpetual futures)

**Why This Asset**: Most extreme FR events of any major Bybit asset. Proven FR V2 alpha (Sharpe 2.08). High retail leverage usage creates frequent OI divergences. Previous research has extensive data cached for this symbol.

### Signal Assets

**Asset 1**: Same symbol OI data (via Bybit `/v5/market/open-interest`)
- **Role**: Primary signal source -- OI rate-of-change divergence from price
- **How Used**: Calculate OI delta (change over N bars), compare with price delta

**Asset 2**: Same symbol Long/Short Ratio (via Bybit `/v5/market/account-ratio`)
- **Role**: Confirmation signal -- extreme L/S ratio confirms overcrowding direction
- **How Used**: When L/S ratio > 1.5 (crowded longs) AND OI spiking + price flat = short setup

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| DOGE/USDT | Meme/large cap | Extreme FR, high retail leverage, proven FR V2 alpha |
| SOL/USDT | Large cap | High OI activity, liquid, frequent leverage events |
| ARB/USDT | Mid cap | Volatile, distinct from BTC/ETH dynamics |
| LDO/USDT | Mid cap | Known FR characteristics from prior research |
| INJ/USDT | Mid cap | Large moves, active futures market |

**Generalizability Expectation**: Should work on assets with active futures markets and retail leverage participation. Less effective on BTC/ETH (too efficient, OI divergences quickly arbitraged). Best on mid-cap alts where retail leverage dominance is highest.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| OI Rate of Change | 15m | Primary signal | lookback: 4-12 bars | Calculate as % change in OI over lookback period |
| Price ROC | 15m | Divergence comparison | lookback: 4-12 bars | Same lookback as OI ROC for comparison |
| OI-Price Divergence Score | 15m | Combined signal | threshold: 0.5-3.0 | Z-score of (OI_ROC - Price_ROC) |
| FR Regime | 4h | Directional filter | frAbsThreshold: 0.0003-0.001 | Reuse from FR V2 logic |
| Long/Short Ratio | 15m | Confirmation | lsThreshold: 1.3-2.0 | Crowding confirmation |
| ATR | 15m | Risk management | period: 14 | Stop loss and position sizing |
| EMA | 15m | Trend context | period: 50 | Only trade reversals against short-term trend |

### Additional Data Requirements

- **Open Interest History**: Bybit API `/v5/market/open-interest`, intervalTime=15min, cached in SQLite/PostgreSQL
- **Long/Short Ratio**: Bybit API `/v5/market/account-ratio`, period=15min, cached similarly
- **Funding Rates**: Already cached (reuse from FR V2 infrastructure)

### Data Preprocessing

1. **OI Caching Script**: New script to fetch and cache OI history at 15m resolution. Bybit returns max 200 records per call; need pagination loop. Store in new `open_interest` table with columns: (exchange, symbol, interval, timestamp, oi_amount).
2. **L/S Ratio Caching Script**: Similar to OI caching. Store in new `long_short_ratio` table.
3. **Alignment**: OI and L/S data timestamps must be aligned to 15m candle timestamps. Use floor(timestamp / 900000) * 900000 for alignment.
4. **Data Quality**: Check for gaps in OI data. Bybit note: "During periods of extreme market volatility, this interface may experience increased latency" -- handle missing data points with forward-fill.

---

## Entry Logic

### Long Entry Conditions (After Bearish Overcrowding Unwinds)

**ALL of the following must be true:**

1. **FR Regime is Bearish (Shorts Overcrowded)**:
   - Current 4h funding rate < -frAbsThreshold (e.g., < -0.0005)
   - This means shorts are paying longs = shorts are overcrowded
   - Timeframe: 4h

2. **OI Was Spiking (Overcrowding Built Up)**:
   - OI ROC over last `oiLookback` bars (e.g., 8 bars = 2 hours) was > `oiSpikeThreshold` (e.g., > 3%)
   - Measured: max OI in lookback window vs OI at start of lookback
   - Timeframe: 15m

3. **OI Now Declining (Positions Unwinding)**:
   - Current OI ROC (last 2 bars) is negative
   - The spike is cresting and positions are being closed/liquidated
   - Timeframe: 15m

4. **Price Below EMA(50)** (counter-trend):
   - Price has been pushed down by the overcrowded shorts
   - Below EMA confirms we're buying into weakness (mean reversion)
   - Timeframe: 15m

5. **Long/Short Ratio Confirmation** (optional):
   - L/S ratio < 1/lsThreshold (e.g., < 0.67 means shorts dominate 60%+)
   - Confirms the overcrowding direction

**Position Sizing**:
- `positionSize = (equity * capitalFraction * leverage) / currentPrice`
- capitalFraction: 0.3-0.5 (conservative -- this is leveraged)
- leverage: 3-5x (moderate, not extreme)
- Volatility adjustment: `adjustedSize = baseSize * (avgATR / currentATR)` to reduce size in high-vol periods

### Short Entry Conditions (After Bullish Overcrowding Unwinds)

**ALL of the following must be true:**

1. **FR Regime is Bullish (Longs Overcrowded)**: FR > +frAbsThreshold
2. **OI Was Spiking**: OI ROC over lookback > oiSpikeThreshold
3. **OI Now Declining**: Current OI ROC (last 2 bars) negative
4. **Price Above EMA(50)**: Counter-trend (selling into strength)
5. **L/S Ratio Confirmation** (optional): L/S > lsThreshold

### Entry Examples

**Example 1: Short Entry on DOGE**
- Date: 2025-08-15, 14:15 UTC (15m candle close)
- DOGE price: $0.1850 (above EMA50 of $0.1820)
- 4h Funding Rate: +0.0008 (longs paying shorts = longs overcrowded)
- OI over last 2h: rose from $180M to $195M (+8.3% spike)
- Current 30m OI delta: -$2M (OI declining, positions unwinding)
- L/S Ratio: 1.65 (65% longs vs 35% shorts)
- **Action**: Enter short at $0.1850, position = 30% of equity at 3x leverage
- Stop: $0.1850 + (ATR * 2.0) = ~$0.1885 (1.9% above entry)
- TP: $0.1850 - (ATR * 2.5) = ~$0.1806 (-2.4% below entry)

---

## Exit Logic

### Stop Loss

**Type**: ATR-based

**Calculation**: `stopPrice = entryPrice +/- (ATR(14) * atrStopMultiplier)`
- For longs: `stopPrice = entryPrice - (ATR * atrStopMultiplier)`
- For shorts: `stopPrice = entryPrice + (ATR * atrStopMultiplier)`
- `atrStopMultiplier` default: 2.0, range: 1.5-3.0

**Adjustment**: No trailing stop (holding period is short enough that fixed ATR stop is sufficient)

### Take Profit

**Type**: ATR-based

**Calculation**: `takeProfitPrice = entryPrice -/+ (ATR(14) * atrTpMultiplier)`
- `atrTpMultiplier` default: 2.5, range: 1.5-4.0
- Risk:Reward ratio = atrTpMultiplier / atrStopMultiplier (default 1.25:1)

### Signal-Based Exit

**OI Reversal Exit**: If OI starts spiking again in the SAME direction after entry (overcrowding resuming), exit immediately. The thesis was that overcrowding was unwinding; if it resumes, the trade is wrong.
- Check: If OI ROC (2-bar) turns positive AND in the adverse direction, close position.

### Time-Based Exit

**Max Holding Period**: `maxHoldBars` bars on 15m (default: 12 = 3 hours)

**Rationale**: OI-driven mean reversion should complete within 1-3 hours. If it hasn't by 3 hours, the thesis has failed or the move was already captured by 4h-scale FR V2 dynamics.

### Exit Priority

1. Stop loss (highest priority -- capital preservation)
2. OI reversal exit (thesis invalidation)
3. Take profit
4. Time-based exit

---

## Risk Management

### Position Sizing

**Method**: Volatility-adjusted with leverage cap

**Base Size**: `capitalFraction` of equity (default 0.3 = 30%)

**Volatility Adjustment**: `adjustedFraction = capitalFraction * (avgATR14 / currentATR14)` capped at capitalFraction * 1.5

**Leverage**: 3-5x (parameter `leverage`, default 3)

### Per-Trade Risk

**Max Risk Per Trade**: Stop distance * position size < 5% of equity

**Calculation**: If ATR-based stop = 2% of price at 3x leverage = 6% of margin. With 30% capital allocation, max loss per trade = 0.30 * 6% = 1.8% of equity.

### Portfolio Risk

**Max Drawdown Limit**: If cumulative drawdown > 10%, pause trading for 24 hours (implemented as bars without signal)

**Max Concurrent Positions**: 1 per symbol

**Cooldown**: Minimum `cooldownBars` bars between trades (default: 4 = 1 hour) to prevent overtrading

### Leverage

**Max Leverage**: 5x

**Rationale**: 3-5x provides meaningful amplification while keeping per-trade risk < 2% of equity. Previous research showed that fee impact at 10x+ is brutal for short-timeframe strategies. At 3x with 15m bars, fees are ~0.63% of margin per round-trip (manageable).

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| oiLookback | number | 4 | 16 | 2 | 8 | OI spike detection lookback (15m bars) |
| oiSpikeThreshold | number | 1.0 | 8.0 | 0.5 | 3.0 | Min OI % change to flag spike |
| oiDeclineWindow | number | 1 | 4 | 1 | 2 | Bars to confirm OI declining |
| frAbsThreshold | number | 0.0003 | 0.001 | 0.0001 | 0.0005 | Absolute FR threshold for regime |
| lsThreshold | number | 1.2 | 2.0 | 0.1 | 1.5 | L/S ratio extreme for confirmation |
| useLsFilter | boolean | - | - | - | true | Enable/disable L/S confirmation |
| emaPeriod | number | 20 | 100 | 10 | 50 | EMA period for trend context |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period for stops/sizing |
| atrStopMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | ATR multiplier for stop loss |
| atrTpMultiplier | number | 1.5 | 4.0 | 0.5 | 2.5 | ATR multiplier for take profit |
| capitalFraction | number | 0.2 | 0.5 | 0.1 | 0.3 | Fraction of equity per trade |
| leverage | number | 2 | 5 | 1 | 3 | Position leverage |
| maxHoldBars | number | 4 | 24 | 4 | 12 | Max holding period (15m bars) |
| cooldownBars | number | 2 | 8 | 2 | 4 | Min bars between trades |

**Parameter Dependencies**:
- `atrTpMultiplier` should generally be >= `atrStopMultiplier` for positive expectancy
- `oiLookback` > `oiDeclineWindow` (decline window is shorter recent check)

**Optimization Notes**: Most sensitive parameters are likely `oiSpikeThreshold` and `frAbsThreshold`. Start grid search with these two while keeping others at defaults.

---

## System Gaps

### Required Extensions

**1. OI Data Caching Infrastructure**
- **What**: Script to fetch and cache historical OI data from Bybit API at 15m/5m resolution. New database table. Data provider that aligns OI to candle timestamps and makes it available in StrategyContext.
- **Why**: Strategy cannot function without historical OI data.
- **Complexity**: Medium
- **Priority**: Critical
- **Implementation Notes**:
  - Endpoint: GET `/v5/market/open-interest?category=linear&symbol=DOGEUSDT&intervalTime=15min&startTime=X&endTime=Y&limit=200`
  - Need pagination loop (200 records per call, earliest to latest)
  - Store in table: `open_interest (id, exchange, symbol, interval, timestamp, oi_amount, created_at)`
  - Unique constraint on (exchange, symbol, interval, timestamp)
  - Caching script similar to `scripts/cache-funding-rates.ts`

**2. Long/Short Ratio Data Caching**
- **What**: Script to fetch and cache L/S ratio data from Bybit API.
- **Why**: Confirmation signal for trade entries.
- **Complexity**: Simple
- **Priority**: High
- **Implementation Notes**:
  - Endpoint: GET `/v5/market/account-ratio?category=linear&symbol=DOGEUSDT&period=15min&startTime=X&endTime=Y&limit=500`
  - Store in table: `long_short_ratio (id, exchange, symbol, period, timestamp, buy_ratio, sell_ratio, created_at)`

**3. Auxiliary Data in StrategyContext**
- **What**: Extend StrategyContext to include `openInterestHistory?: OpenInterestRecord[]` and `longShortRatioHistory?: LongShortRatioRecord[]` alongside existing `fundingRates`.
- **Why**: Strategies need access to OI and L/S data per bar, aligned to candle timestamps.
- **Complexity**: Medium
- **Priority**: Critical
- **Implementation Notes**:
  - In engine, when loading candle data for backtest, also load OI and L/S data for the same period.
  - For each bar, provide `currentOI` (interpolated/nearest OI reading) and `currentLSRatio`.
  - Types already defined in `src/core/types.ts` (OpenInterestRecord, LongShortRatioRecord).

**4. 15m Candle Caching for Target Symbols**
- **What**: Cache 15m candle data for DOGE, SOL, ARB, LDO, INJ from Bybit for 2+ years.
- **Why**: Need historical data for backtesting.
- **Complexity**: Simple (infrastructure exists for other timeframes)
- **Priority**: Critical

### Workarounds

**For Auxiliary Data in StrategyContext**: While engine-level support is being built, strategy can use `init()` hook to pre-fetch and store OI/L/S data as arrays on the strategy object. Match to candle timestamps in `onBar()` via binary search on timestamp.

**For Missing OI Data Points**: Forward-fill. If OI reading missing for a 15m bar, use last known OI value.

### Nice-to-Have Improvements

- **OI websocket live feed**: For eventual paper trading / live trading
- **Liquidation data integration**: If Bybit ever provides REST historical liquidations
- **Cross-exchange OI aggregation**: Compare Bybit OI to Binance OI for divergence signals

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **OI-Delta Regime Scalper** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy exploits divergences between Open Interest (OI) rate-of-change and price movement, filtered by Funding Rate regime. When OI spikes (new leveraged positions entering) but price doesn't follow, the market is overcrowded and vulnerable to reversal. Combined with FR regime context (indicating WHICH side is overcrowded), we trade the mean-reversion when OI starts declining (positions unwinding).

This strategy:
- Trades on **15m** timeframe
- Uses **OI rate-of-change, FR regime, Long/Short ratio, EMA, ATR**
- Entry: Short when longs overcrowded (FR+) AND OI declining after spike; Long when shorts overcrowded (FR-) AND OI declining after spike
- Exit: ATR-based TP/SL, OI reversal, or time exit
- Risk: 3-5x leverage, 30% capital fraction, ATR-based stops

---

#### System Extensions Required

**FIRST**: Implement these extensions to the system:

**Extension 1: OI Data Caching Script**

Create file: `/workspace/scripts/cache-open-interest.ts`

- Accept CLI args: `--symbol=DOGEUSDT --interval=15min --from=2024-01-01 --to=2026-03-01`
- Use Bybit REST API (direct fetch, not CCXT) to call GET `https://api.bybit.com/v5/market/open-interest`
- Parameters: `category=linear`, `symbol`, `intervalTime`, `startTime`, `endTime`, `limit=200`
- Implement pagination: Bybit returns newest first with cursor. Loop until all data fetched.
- Store in new PostgreSQL/SQLite table `open_interest`:
  ```sql
  CREATE TABLE IF NOT EXISTS open_interest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL DEFAULT 'bybit',
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    oi_amount REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(exchange, symbol, interval, timestamp)
  );
  ```
- Use ON CONFLICT DO NOTHING for idempotent inserts
- Log progress to stderr
- Reference `scripts/cache-funding-rates.ts` for patterns

**Extension 2: Long/Short Ratio Caching Script**

Create file: `/workspace/scripts/cache-long-short-ratio.ts`

- Similar to OI script but calls GET `https://api.bybit.com/v5/market/account-ratio`
- Parameters: `category=linear`, `symbol`, `period=15min`, `startTime`, `endTime`, `limit=500`
- Store in new table `long_short_ratio`:
  ```sql
  CREATE TABLE IF NOT EXISTS long_short_ratio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL DEFAULT 'bybit',
    symbol TEXT NOT NULL,
    period TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    buy_ratio REAL NOT NULL,
    sell_ratio REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(exchange, symbol, period, timestamp)
  );
  ```

**Extension 3: Auxiliary Data Loading in Engine**

Extend the backtest engine to load OI and L/S data alongside candle and funding rate data. Add to StrategyContext:

```typescript
// In src/strategy/base.ts, add to StrategyContext interface:
openInterestHistory?: OpenInterestRecord[];
currentOpenInterest?: OpenInterestRecord | null;
longShortRatioHistory?: LongShortRatioRecord[];
currentLongShortRatio?: LongShortRatioRecord | null;
```

In the engine's backtest loop, for each bar:
- Find the nearest OI reading with timestamp <= current candle timestamp
- Find the nearest L/S ratio reading with timestamp <= current candle timestamp
- Set `currentOpenInterest` and `currentLongShortRatio` accordingly

Add database query functions in `src/data/db.ts`:
```typescript
export async function getOpenInterestHistory(
  exchange: string, symbol: string, interval: string,
  startTime: number, endTime: number
): Promise<OpenInterestRecord[]>;

export async function getLongShortRatioHistory(
  exchange: string, symbol: string, period: string,
  startTime: number, endTime: number
): Promise<LongShortRatioRecord[]>;
```

**THEN**: Proceed with strategy implementation below.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/oi-delta-regime-scalper.ts`

#### Step 1: Imports and Setup

```typescript
import { EMA, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';
```

#### Step 2: Define Helper Functions

```typescript
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = EMA.calculate({ values: closes, period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

function calculateATR(highs: number[], lows: number[], closes: number[], period: number): (number | undefined)[] {
  if (closes.length <= period) return new Array(closes.length).fill(undefined);
  const result = ATR.calculate({ high: highs, low: lows, close: closes, period });
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

// Calculate rate of change of OI over a lookback window
function getOiRoc(oiHistory: { timestamp: number; openInterestAmount: number }[], currentTs: number, lookbackMs: number): number | undefined {
  // Find OI at current time and at (current - lookback)
  const currentOi = findNearestOi(oiHistory, currentTs);
  const pastOi = findNearestOi(oiHistory, currentTs - lookbackMs);
  if (currentOi === undefined || pastOi === undefined || pastOi === 0) return undefined;
  return ((currentOi - pastOi) / pastOi) * 100; // percentage change
}

function findNearestOi(oiHistory: { timestamp: number; openInterestAmount: number }[], targetTs: number): number | undefined {
  // Binary search for nearest OI reading at or before targetTs
  let lo = 0, hi = oiHistory.length - 1;
  let best: number | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (oiHistory[mid].timestamp <= targetTs) {
      best = oiHistory[mid].openInterestAmount;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
```

#### Step 3: Define Strategy

```typescript
const oiDeltaRegimeScalper: Strategy = {
  name: 'oi-delta-regime-scalper',
  description: 'Scalps OI divergence from price, filtered by FR regime, on 15m timeframe with leverage.',
  version: '1.0.0',
  params: [
    // ... all params from the parameter table above
  ],
```

#### Step 4: init() Hook

```typescript
init(context: StrategyContext): void {
  const { params } = context;
  // Validate params
  if ((params.atrTpMultiplier as number) < (params.atrStopMultiplier as number)) {
    context.log('WARNING: TP multiplier < SL multiplier -- negative R:R ratio');
  }
  // Store strategy state
  (this as any)._lastTradeBar = -999;
  (this as any)._maxOiInWindow = 0;
  context.log(`Initialized OI-Delta Regime Scalper with leverage=${params.leverage}`);
},
```

#### Step 5: onBar() Hook

Pseudocode for main logic:

```
1. Extract all params
2. Early return if insufficient data (currentIndex < emaPeriod)
3. Check cooldown (currentIndex - lastTradeBar >= cooldownBars)
4. Calculate indicators: EMA, ATR
5. Get OI data:
   a. OI ROC over lookback window (oiLookback * 15min in ms)
   b. OI ROC over decline window (oiDeclineWindow * 15min in ms)
   c. Max OI in lookback window
6. Get FR regime from currentFundingRate
7. Get L/S ratio if filter enabled

EXIT LOGIC (check first):
8. If in long position:
   a. Check stop loss: price <= entryPrice - (ATR * atrStopMultiplier) -> closeLong
   b. Check take profit: price >= entryPrice + (ATR * atrTpMultiplier) -> closeLong
   c. Check OI reversal: if OI ROC (2-bar) turns positive and price moving against -> closeLong
   d. Check time exit: barsHeld >= maxHoldBars -> closeLong
9. If in short position: mirror logic

ENTRY LOGIC:
10. If no position AND cooldown cleared:
    a. FR regime = "short" if currentFR > frAbsThreshold, "long" if currentFR < -frAbsThreshold, else "neutral"
    b. If regime == "neutral": skip (no signal)
    c. OI spike detected: oiRocLookback > oiSpikeThreshold
    d. OI declining: oiRocDecline < 0
    e. If regime == "short" (longs overcrowded):
       - Price above EMA(50): confirmed counter-trend setup
       - L/S ratio > lsThreshold (if filter enabled): confirmed crowded longs
       - ALL conditions met: openShort(amount)
    f. If regime == "long" (shorts overcrowded):
       - Price below EMA(50)
       - L/S ratio < 1/lsThreshold (if filter enabled)
       - ALL conditions met: openLong(amount)
11. Record lastTradeBar, store entryPrice and entryBar for exit tracking
```

#### Step 6: Position Size Calculation

```typescript
const currentATR = atrValues[atrValues.length - 1];
const avgATR = atrValues.slice(-50).reduce((a, b) => a + (b || 0), 0) / 50;
const volAdjust = Math.min(1.5, avgATR / (currentATR || avgATR));
const adjustedFraction = capitalFraction * volAdjust;
const positionValue = equity * adjustedFraction * leverage;
const amount = positionValue / currentPrice;
```

#### Step 7: onEnd() Hook

```typescript
onEnd(context: StrategyContext): void {
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

---

#### Validation Checklist

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Strategy validates: `npx tsx src/cli/quant-validate.ts strategies/oi-delta-regime-scalper.ts`
- [ ] OI and L/S data cached for test symbols
- [ ] Quick backtest generates trades: `npx tsx src/cli/quant-backtest.ts --strategy=oi-delta-regime-scalper --symbol=DOGE/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=3`
- [ ] Parameters are within specified ranges
- [ ] Risk management enforced (stops, position sizing, cooldown)
- [ ] Proper handling of missing OI/L/S data (forward-fill, graceful skip)

#### Edge Cases to Handle

1. **Missing OI data**: If no OI reading available for a bar, skip signal generation (do NOT trade without OI data)
2. **Missing L/S data with filter enabled**: Skip L/S filter if data unavailable (use only OI + FR)
3. **FR transition mid-trade**: If FR regime flips during a trade, do NOT exit -- original thesis may still be valid
4. **Simultaneous exit signals**: Priority: stop loss > OI reversal > take profit > time exit
5. **Leverage in engine**: Ensure `--leverage=3` and `--mode=futures` flags are passed to backtest CLI

#### Testing Instructions

```bash
# 1. Cache OI data for DOGE
npx tsx scripts/cache-open-interest.ts --symbol=DOGEUSDT --interval=15min --from=2024-01-01 --to=2026-03-01

# 2. Cache L/S ratio data for DOGE
npx tsx scripts/cache-long-short-ratio.ts --symbol=DOGEUSDT --period=15min --from=2024-01-01 --to=2026-03-01

# 3. Cache 15m candles for DOGE
npx tsx scripts/cache-candles.ts --symbol=DOGE/USDT --timeframe=15m --from=2024-01-01 --to=2026-03-01 --exchange=bybit

# 4. Validate strategy
npx tsx src/cli/quant-validate.ts strategies/oi-delta-regime-scalper.ts

# 5. Quick backtest
npx tsx src/cli/quant-backtest.ts --strategy=oi-delta-regime-scalper --symbol=DOGE/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=3

# 6. Grid search
npx tsx src/cli/quant-optimize.ts --strategy=oi-delta-regime-scalper --symbol=DOGE/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=3
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.5
- Target Win Rate: 45-55% (mean-reversion with wider TP than SL)
- Target Total Return: 30-80% annually at 3x leverage
- Max Acceptable Drawdown: < 15%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 1.0
- Target OOS Degradation: < 30%
- Target Win Rate: 40-50%
- Max Acceptable Drawdown: < 20%

**Trading Activity**:
- Expected Trades per Month: 8-20 (depends on OI volatility)
- Average Trade Duration: 30 min to 2 hours (2-8 bars on 15m)
- Typical Position Size: 30% of equity at 3x leverage

**Multi-Asset Performance**:
- Expected Pass Rate: 40-60% of tested assets
- Works Best On: Mid-cap alts with active futures (DOGE, SOL, ARB)
- May Struggle On: BTC, ETH (too efficient), low-liquidity alts (bad OI data)

---

## References

**Academic Papers**:
1. "Order Flow and Cryptocurrency Returns", Anastasopoulos & Gradojevic, EFMA 2025
   - URL: https://www.efmaefm.org/0EFMAMEETINGS/EFMA%20ANNUAL%20MEETINGS/2025-Greece/papers/OrderFlowpaper.pdf
   - Key Finding: Order flow delivers Sharpe 1.68 in crypto with temporary price effects

2. "Microstructure and Market Dynamics in Crypto Markets", Easley et al., SSRN 4814346
   - URL: https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf
   - Key Finding: Order flow imbalances create exploitable short-term predictability

3. "Anatomy of Oct 2025 Crypto Liquidation Cascade", Ali, SSRN 5611392
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5611392
   - Key Finding: OI + FR signals preceded crashes by 7-20 days; $19B wiped in 36h

4. "Quantitative Alpha in Crypto Markets", Mann, SSRN 5225612
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5225612
   - Key Finding: Systematic review confirms persistent inefficiencies in crypto derivatives

**Industry Research**:
1. "Liquidations in Crypto: How to Anticipate Volatile Market Moves", Amberdata
   - URL: https://blog.amberdata.io/liquidations-in-crypto-how-to-anticipate-volatile-market-moves

2. Bybit API - Get Open Interest
   - URL: https://bybit-exchange.github.io/docs/v5/market/open-interest

3. Bybit API - Get Long Short Ratio
   - URL: https://bybit-exchange.github.io/docs/v5/market/long-short-ratio

**Prior Internal Research**:
- HF Scalping Research Results (2026-03-06): Concluded 1m/5m pure technical strategies fail. 15m with structural signals recommended.
- FR V2 Optimization Research: Sharpe 2.08 on DOGE proves FR-based structural edge works.

---

## Change Log

**Version 1.0** - 2026-03-05
- Initial specification
- Based on comprehensive web research on OI divergence, liquidation cascades, and derivatives data
- Designed to avoid pitfalls from prior 1m/5m HF research
- Requires system extensions: OI caching, L/S caching, StrategyContext extension
