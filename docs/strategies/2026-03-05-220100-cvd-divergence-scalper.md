# Strategy: CVD Divergence Scalper

> **Created**: 2026-03-05 22:01
> **Author**: quant-lead agent (opus)
> **Status**: Draft
> **Rank**: 2 of 3 (Medium Feasibility -- requires taker volume data)

## Executive Summary

Exploits divergences between Cumulative Volume Delta (CVD) and price on 15m timeframe. CVD measures the net aggressive buying vs selling pressure (taker buy volume minus taker sell volume). When price makes new highs but CVD does not (bearish divergence), it signals that the price move is driven by passive order flow or liquidations rather than genuine buying conviction, making it a high-probability reversal signal. Combined with OI context for confirmation.

---

## Hypothesis

**Core Edge**: Taker buy/sell volume is the purest measure of directional conviction in futures markets. Takers pay fees to express urgency; their aggregate behavior reveals true demand/supply pressure. When price rises to new highs but taker buying (CVD) is declining, the price advance is hollow -- driven by short liquidations or passive limit order fills rather than genuine buying. This hollow advance will reverse.

**Why This Edge Persists**:
1. **Information content**: Taker volume decomposition (buy vs sell) is not available in standard OHLCV data. Most retail traders don't track it.
2. **Structural**: Market makers provide passive liquidity; takers consume it. The taker-maker dynamic creates information asymmetry that is detectable in volume decomposition.
3. **Behavioral**: Retail traders look at price, not order flow. They chase price moves that are actually hollow (driven by liquidation cascades or thin order books).
4. **Execution-driven**: During liquidation cascades, price moves fast but the taker flow is one-directional (forced liquidation market orders). This creates the divergence.

**Market Conditions**:
- **Works best**: After sharp directional moves driven by liquidations. During periods of high leverage (large OI).
- **Fails in**: Strong trending markets with genuine buying/selling pressure. Low-volatility environments where divergences are noise.

**Academic/Empirical Backing**:
- Bookmap research: "CVD shows the difference between aggressive buying and selling, providing traders with an advantage in detecting short-term shifts in supply and demand."
- Axia Futures: "Volume Delta Reversal Trade Strategy" documents professional prop firm usage of CVD divergence for reversal entries.
- Academic: "Order Book Imbalance" (hftbacktest) demonstrates that imbalance has "near-linear relationship with short-horizon price changes" and is "structural information, not a lag of past trades."
- CryptoQuant backtest: "Taker Buy/Sell Ratio on Bybit" showed optimized strategies improved Sharpe ratio and reduced drawdown vs buy-and-hold.

---

## Classification

**Style**: mean-reversion (order flow divergence)

**Holding Period**: intraday (15 minutes to 2 hours)

**Complexity**: Single-TF single-asset with auxiliary taker volume data

**Market Type**: futures

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 15m

**Purpose**: Signal generation and trade management

**Rationale**:
- CVD is most useful at intraday timeframes where order flow dynamics are visible.
- 15m provides sufficient signal-to-noise ratio while still being granular enough to detect divergences.
- 1m CVD divergences are too noisy (as proven by prior HF research); 15m smooths out execution noise while preserving the divergence pattern.
- 15m bars have median moves of 0.15-0.25% on alts, clearing the fee hurdle.

### Secondary Timeframes

None required. CVD divergence is self-contained. FR and OI used as optional confirmation filters, not separate timeframe analysis.

---

## Asset Configuration

### Primary Asset

**Asset**: SOL/USDT (perpetual futures)

**Why This Asset**: High taker volume activity. Liquid enough for reliable CVD signals. More volatile than BTC/ETH (larger divergences). Active retail futures participation.

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| SOL/USDT | Large cap | High volume, clear order flow patterns |
| DOGE/USDT | Meme | Extreme volume spikes, frequent liquidation-driven moves |
| ETH/USDT | Large cap | Second most liquid, benchmark test |
| ARB/USDT | Mid cap | Volatile with active futures |
| WLD/USDT | Mid cap | New-generation token with high leverage interest |

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| CVD (Cumulative Volume Delta) | 15m | Primary divergence signal | lookback: 10-30 bars | Cumulative (taker_buy_vol - taker_sell_vol) |
| CVD Rate of Change | 15m | Divergence detection | period: 3-8 bars | Slope of CVD vs slope of price |
| Price Swing Detection | 15m | New high/low identification | lookback: 10-30 bars | Local maxima/minima detection |
| OI ROC | 15m | Confirmation | lookback: 4-12 bars | High OI + divergence = stronger signal |
| ATR | 15m | Risk management | period: 14 | Stops and targets |
| RSI | 15m | Overbought/oversold filter | period: 14 | Confirm extreme before reversal |

### Additional Data Requirements

**Taker Buy/Sell Volume**: This is the CRITICAL data requirement that determines feasibility.

**Bybit**: Does NOT provide taker buy/sell volume breakdown in kline data. The standard OHLCV only has total volume and turnover. However:
- Bybit's ticker endpoint provides 24h aggregated taker data
- No historical taker buy/sell per candle available via Bybit REST API
- **Workaround A**: Use Binance futures kline data which includes `takerBuyBaseAssetVolume` as the 10th field in each candle (available historically via CCXT)
- **Workaround B**: Approximate CVD from price action: if candle closes in upper 50% of range, classify as "taker buy dominated"; lower 50% as "taker sell dominated". Weight by volume. This is a known approximation used when tick data is unavailable.
- **Workaround C**: Use CryptoQuant or Coinalyze API for historical taker data (requires API key, possibly paid)

**Recommendation**: Use **Binance futures** as the exchange (not Bybit) for this strategy. Binance provides taker buy base asset volume in kline data, which CCXT can fetch. Switch to `--exchange=binance` for backtesting.

### Data Preprocessing

1. **CVD Calculation**: For each 15m bar, `delta = taker_buy_volume - (total_volume - taker_buy_volume)`. CVD = running cumulative sum of delta, reset at session boundary (24h or configurable).
2. **Divergence Detection**: Compare CVD slope (regression over N bars) vs price slope. Divergence = opposite slopes exceeding threshold.
3. **Swing Detection**: Local high = bar where high > all highs in +-N bars. Local low = bar where low < all lows in +-N bars.

---

## Entry Logic

### Short Entry Conditions (Bearish CVD Divergence)

**ALL of the following must be true:**

1. **Price New Local High**:
   - Current bar's high >= max(highs over last `swingLookback` bars)
   - Timeframe: 15m

2. **CVD NOT Making New High (Bearish Divergence)**:
   - Current CVD < max(CVD over last `swingLookback` bars)
   - CVD slope over last `cvdSlopeBars` is flat or negative
   - Timeframe: 15m

3. **RSI Overbought Confirmation**:
   - RSI(14) > `rsiOverbought` (e.g., 65)
   - Confirms stretched conditions
   - Timeframe: 15m

4. **OI Elevated** (optional confirmation):
   - OI ROC over last 8 bars > 0 (positions building)
   - High OI + bearish divergence = positions about to unwind

**Position Sizing**: Same as Strategy 1 (volatility-adjusted with leverage)

### Long Entry Conditions (Bullish CVD Divergence)

Mirror logic:
1. Price at new local low
2. CVD NOT making new low (bullish divergence -- selling exhaustion)
3. RSI < `rsiOversold` (e.g., 35)
4. OI elevated (optional)

### Entry Examples

**Example 1: Short on SOL Bearish CVD Divergence**
- SOL makes local high at $185.50 (highest in 20 bars)
- CVD peaked 8 bars ago and has been declining since
- CVD slope (last 5 bars): -1500 (declining -- sellers dominating despite price rise)
- RSI: 72 (overbought)
- OI: rose 5% in last 2 hours
- **Action**: Enter short at $185.50. Stop: $185.50 + ATR*2 = ~$187.30. TP: $185.50 - ATR*2.5 = ~$183.25

---

## Exit Logic

### Stop Loss

**Type**: ATR-based
**Calculation**: `stopPrice = entryPrice +/- (ATR(14) * atrStopMultiplier)`
- Default atrStopMultiplier: 2.0

### Take Profit

**Type**: ATR-based
**Calculation**: `takeProfitPrice = entryPrice -/+ (ATR(14) * atrTpMultiplier)`
- Default atrTpMultiplier: 2.5

### Signal-Based Exit

**CVD Confirmation Exit**: If after entry, CVD reverses direction AND price breaks through entry level, close position. The divergence thesis was wrong.

### Time-Based Exit

**Max Holding Period**: 12 bars (3 hours on 15m)

---

## Risk Management

### Position Sizing

**Method**: Volatility-adjusted
**Base Size**: 30% of equity
**Leverage**: 3-5x

### Per-Trade Risk

**Max Risk**: ~2% of equity per trade (30% allocation * 3x leverage * 2% stop = 1.8%)

### Portfolio Risk

**Max Drawdown**: 12% pause threshold
**Max Concurrent Positions**: 1
**Cooldown**: 4 bars between trades

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| swingLookback | number | 8 | 30 | 2 | 20 | Bars to detect price swing highs/lows |
| cvdSlopeBars | number | 3 | 10 | 1 | 5 | Bars for CVD slope calculation |
| cvdDivThreshold | number | 0.5 | 3.0 | 0.5 | 1.0 | Min CVD divergence strength (normalized) |
| rsiPeriod | number | 10 | 20 | 2 | 14 | RSI calculation period |
| rsiOverbought | number | 60 | 75 | 5 | 65 | RSI level for overbought confirmation |
| rsiOversold | number | 25 | 40 | 5 | 35 | RSI level for oversold confirmation |
| useOiFilter | boolean | - | - | - | false | Use OI as confirmation (requires OI data) |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMultiplier | number | 1.5 | 3.0 | 0.5 | 2.0 | Stop loss ATR multiplier |
| atrTpMultiplier | number | 1.5 | 4.0 | 0.5 | 2.5 | Take profit ATR multiplier |
| capitalFraction | number | 0.2 | 0.5 | 0.1 | 0.3 | Equity fraction per trade |
| leverage | number | 2 | 5 | 1 | 3 | Leverage |
| maxHoldBars | number | 4 | 24 | 4 | 12 | Max hold (15m bars) |
| cooldownBars | number | 2 | 8 | 2 | 4 | Cooldown between trades |
| cvdResetPeriod | number | 48 | 192 | 48 | 96 | CVD reset period (bars, 96 = 24h on 15m) |

---

## System Gaps

### Required Extensions

**1. Taker Buy Volume Data Source**
- **What**: Either (a) fetch Binance futures kline data which includes taker buy volume, or (b) implement CVD approximation from OHLCV price action.
- **Why**: CVD calculation requires knowing the split between buying and selling volume.
- **Complexity**: Medium (option a) or Simple (option b)
- **Priority**: Critical
- **Implementation Notes**:
  - Option A (Binance): The `fetchOHLCV` via CCXT for Binance futures returns arrays where index 5 is volume. But the RAW Binance API returns 12 fields including index 9 = "Taker buy base asset volume". Need to call Binance API directly (not CCXT) to get this field.
  - Option B (Approximation): For each candle, `estimated_buy_pct = (close - low) / (high - low)`. `taker_buy_vol = volume * estimated_buy_pct`. `taker_sell_vol = volume * (1 - estimated_buy_pct)`. This is a standard approximation.
  - **Recommendation**: Start with Option B (no API changes needed), validate that CVD divergence signals work, then upgrade to Option A for better accuracy.

**2. CVD Indicator Implementation**
- **What**: Add CVD calculation as a helper function (session-based cumulative sum of buy-sell delta).
- **Why**: Not in current indicator library.
- **Complexity**: Simple
- **Priority**: Critical

**3. Swing Detection Helper**
- **What**: Function to detect local price swing highs/lows over a lookback window.
- **Why**: Divergence detection needs to compare swing extremes.
- **Complexity**: Simple

### Workarounds

**For Taker Volume**: Start with Option B (price-action approximation). The approximation is noisy but sufficient for initial validation. If strategy shows promise with approximation, upgrade to direct Binance API data.

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **CVD Divergence Scalper** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy detects divergences between Cumulative Volume Delta (CVD) and price. When price makes new highs but CVD is declining (bearish divergence), the advance is hollow and will reverse. When price makes new lows but CVD is rising (bullish divergence), the decline is exhausted and will bounce.

**Key Implementation Note**: Start with CVD approximation from OHLCV data. For each candle, estimate taker buy percentage as `(close - low) / (high - low)`. Then `taker_buy_vol = volume * buy_pct` and `taker_sell_vol = volume * (1 - buy_pct)`. This avoids needing special API calls for initial validation.

This strategy:
- Trades on **15m** timeframe
- Uses **CVD (approximated), RSI, ATR**
- Entry: Short on bearish CVD-price divergence + RSI overbought; Long on bullish divergence + RSI oversold
- Exit: ATR-based TP/SL, time exit, or CVD reversal
- Risk: 3-5x leverage, 30% capital, ATR stops

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/cvd-divergence-scalper.ts`

#### Key Helper: CVD Approximation

```typescript
// Approximate taker buy/sell volume from OHLCV
function approximateTakerBuyPct(open: number, high: number, low: number, close: number): number {
  const range = high - low;
  if (range === 0) return 0.5; // doji -- equal buy/sell
  return (close - low) / range; // 0 = all selling, 1 = all buying
}

// Calculate session CVD (cumulative volume delta)
function calculateCVD(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[],
  resetPeriod: number // number of bars per session
): number[] {
  const cvd: number[] = [];
  let cumDelta = 0;
  for (let i = 0; i < closes.length; i++) {
    if (resetPeriod > 0 && i % resetPeriod === 0) cumDelta = 0; // session reset
    const buyPct = approximateTakerBuyPct(opens[i], highs[i], lows[i], closes[i]);
    const delta = volumes[i] * (2 * buyPct - 1); // positive = net buying
    cumDelta += delta;
    cvd.push(cumDelta);
  }
  return cvd;
}
```

#### Key Helper: Swing Detection

```typescript
function isSwingHigh(highs: number[], index: number, lookback: number): boolean {
  const currentHigh = highs[index];
  for (let i = Math.max(0, index - lookback); i < index; i++) {
    if (highs[i] >= currentHigh) return false;
  }
  return true;
}

function isSwingLow(lows: number[], index: number, lookback: number): boolean {
  const currentLow = lows[index];
  for (let i = Math.max(0, index - lookback); i < index; i++) {
    if (lows[i] <= currentLow) return false;
  }
  return true;
}
```

#### Key Helper: Divergence Detection

```typescript
// Bearish divergence: price new high but CVD declining
function hasBearishDivergence(
  highs: number[], cvd: number[], index: number,
  swingLookback: number, cvdSlopeBars: number
): boolean {
  // 1. Is current bar a swing high?
  if (!isSwingHigh(highs, index, swingLookback)) return false;

  // 2. Find previous swing high in CVD within lookback
  const prevCvdMax = Math.max(...cvd.slice(Math.max(0, index - swingLookback), index));
  const currentCvd = cvd[index];

  // 3. CVD should be lower than its previous peak (divergence)
  if (currentCvd >= prevCvdMax) return false;

  // 4. CVD slope should be flat or negative over recent bars
  const cvdSlice = cvd.slice(Math.max(0, index - cvdSlopeBars + 1), index + 1);
  if (cvdSlice.length < 2) return false;
  const slope = (cvdSlice[cvdSlice.length - 1] - cvdSlice[0]) / cvdSlice.length;

  return slope <= 0; // CVD declining = bearish divergence confirmed
}

// Bullish divergence: mirror logic
function hasBullishDivergence(
  lows: number[], cvd: number[], index: number,
  swingLookback: number, cvdSlopeBars: number
): boolean {
  if (!isSwingLow(lows, index, swingLookback)) return false;
  const prevCvdMin = Math.min(...cvd.slice(Math.max(0, index - swingLookback), index));
  const currentCvd = cvd[index];
  if (currentCvd <= prevCvdMin) return false;
  const cvdSlice = cvd.slice(Math.max(0, index - cvdSlopeBars + 1), index + 1);
  if (cvdSlice.length < 2) return false;
  const slope = (cvdSlice[cvdSlice.length - 1] - cvdSlice[0]) / cvdSlice.length;
  return slope >= 0;
}
```

#### onBar() Logic

```
1. Extract params
2. Early return if insufficient data
3. Check cooldown
4. Calculate all indicators (CVD, RSI, ATR)

EXIT LOGIC:
5. If in position, check exits (SL, TP, time, CVD reversal)

ENTRY LOGIC:
6. If no position and cooldown clear:
   a. Check bearish divergence -> if true and RSI > rsiOverbought -> openShort
   b. Check bullish divergence -> if true and RSI < rsiOversold -> openLong
7. Record state
```

#### Validation Checklist

- [ ] TypeScript compiles
- [ ] Strategy validates via quant-validate
- [ ] Backtest generates trades on 15m DOGE or SOL
- [ ] CVD approximation produces reasonable values
- [ ] Divergence detection fires at sensible price points

#### Testing Instructions

```bash
# Validate
npx tsx src/cli/quant-validate.ts strategies/cvd-divergence-scalper.ts

# Quick backtest (use bybit or binance)
npx tsx src/cli/quant-backtest.ts --strategy=cvd-divergence-scalper --symbol=SOL/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=3

# Grid search
npx tsx src/cli/quant-optimize.ts --strategy=cvd-divergence-scalper --symbol=SOL/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=3
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.2
- Target Win Rate: 50-60% (mean-reversion divergences have decent hit rate)
- Target Total Return: 20-60% annually at 3x leverage
- Max Acceptable Drawdown: < 15%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.8
- Target OOS Degradation: < 35%
- Max Acceptable Drawdown: < 20%

**Trading Activity**:
- Expected Trades per Month: 10-25
- Average Trade Duration: 30 min to 2 hours
- Typical Position Size: 30% of equity at 3x leverage

**Note**: The CVD approximation from OHLCV will be noisier than true taker data. If the strategy shows promise with approximation, upgrading to real taker data should meaningfully improve performance.

---

## References

**Industry Research**:
1. "How Cumulative Volume Delta Can Transform Your Trading Strategy", Bookmap
   - URL: https://bookmap.com/blog/how-cumulative-volume-delta-transform-your-trading-strategy
   - Key Finding: CVD detects short-term shifts in supply/demand invisible in price alone

2. "Volume Delta Reversal Trade Strategy", Axia Futures
   - URL: https://axiafutures.com/blog/volume-delta-reversal-trade-strategy/
   - Key Finding: Professional prop firms use CVD divergence for reversal entries

3. "Cumulative Volume Delta Explained", LuxAlgo
   - URL: https://www.luxalgo.com/blog/cumulative-volume-delta-explained/
   - Key Finding: CVD divergence at swing extremes is a high-probability reversal signal

4. "Understanding Taker Buy/Sell Volume for Bitcoin Trading", CryptoCoffeeShop
   - URL: https://cryptocoffeeshop.substack.com/p/understanding-and-analysis-of-the
   - Key Finding: Taker Buy/Sell Ratio backtests showed improved Sharpe vs buy-and-hold

5. "Taker Buy Sell Volume/Ratio", CryptoQuant
   - URL: https://userguide.cryptoquant.com/cryptoquant-metrics/market/taker-buy-sell-volume-ratio
   - Key Finding: Ratio > 1 = bullish pressure, < 1 = bearish pressure

**Academic Papers**:
1. "Microstructure and Market Dynamics in Crypto Markets", Easley et al., SSRN 4814346
   - URL: https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf
   - Key Finding: Order flow imbalance predicts short-term crypto price changes

2. "Order Flow and Cryptocurrency Returns", Anastasopoulos & Gradojevic, EFMA 2025
   - Key Finding: Order flow alpha Sharpe 1.68, temporary price effects

---

## Change Log

**Version 1.0** - 2026-03-05
- Initial specification
- Uses CVD approximation from OHLCV (no additional API needed)
- Lower feasibility than Strategy 1 due to approximate nature of CVD from candle data
