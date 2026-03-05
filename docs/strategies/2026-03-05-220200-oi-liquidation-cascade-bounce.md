# Strategy: OI Liquidation Cascade Bounce

> **Created**: 2026-03-05 22:02
> **Author**: quant-lead agent (opus)
> **Status**: Draft
> **Rank**: 3 of 3 (Most Novel but Highest Risk)

## Executive Summary

Detects liquidation cascades in real-time using a composite of OI crash (sharp OI decline = mass liquidations), price crash speed, and volume spike on 15m timeframe. After a cascade is detected, enters a counter-trend position betting on the post-cascade snapback to equilibrium. This is the riskiest of the three strategies but targets the largest moves (0.5-3% bounces after cascades). The edge is structural: liquidation market orders mechanically overshoot equilibrium.

---

## Hypothesis

**Core Edge**: When leveraged positions are mass-liquidated, the liquidation engine sends market orders that push price PAST equilibrium. The overshoot creates a high-probability mean-reversion opportunity. The key insight is that the DECLINE in OI (not just the price crash) confirms that the move is liquidation-driven rather than fundamental.

**Why This Edge Persists**:
1. **Mechanical**: Liquidation engines on exchanges use market orders (taker orders at best available price). This is guaranteed to push price in the cascade direction.
2. **Order book depletion**: During cascades, liquidity dries up as market makers pull orders. Thin books amplify the overshoot.
3. **Self-reinforcing**: Each liquidation triggers more liquidations at lower/higher levels (cascade effect). This creates a predictable overshoot pattern.
4. **Fast recovery**: After the cascade clears, market makers return, order books refill, and price reverts to pre-cascade equilibrium within minutes to hours.
5. **Timing edge**: Detecting the END of a cascade (via OI stabilization) provides a high-probability entry point.

**Market Conditions**:
- **Works best**: High-leverage environments, volatile altcoins, during market stress events. Events where BTC drops/rises 5%+ in hours.
- **Fails when**: Cascades are driven by genuine fundamental shifts (regulatory news, exchange hacks). The "overshoot" is actually the new equilibrium.

**Academic/Empirical Backing**:
- Ali (SSRN 5611392): Oct 2025 cascade erased "$19 billion in open interest within 36 hours" with "reflexive feedback loops between leverage, liquidity, and volatility." Demonstrates the mechanical nature of cascades.
- CoinChange research: "Bitcoin's $2 Billion Reckoning" documents $2B in forced liquidations and subsequent recovery patterns.
- Amberdata: "If many leveraged longs were liquidated at or near a certain price, that level can transform into a resistance barrier" -- confirms that liquidation zones have predictable post-cascade price behavior.
- Note on Tigro Blanc (Medium, 2026): A liquidation cascade alpha strategy claiming +299% return with Sharpe 3.58 was shown to NOT contain statistically significant alpha after removing BTC beta. This is a CAUTIONARY finding -- we must ensure our strategy doesn't just capture BTC beta. Our approach differs by using OI decline (not just price decline) to confirm liquidation-driven cascades specifically, and we use counter-trend entries (not momentum).

---

## Classification

**Style**: mean-reversion (post-cascade bounce)

**Holding Period**: scalp to intraday (15 min to 4 hours)

**Complexity**: Single-TF single-asset with auxiliary OI data

**Market Type**: futures

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 15m

**Purpose**: Cascade detection and trade management

**Rationale**:
- 15m bars capture cascade events (which typically unfold over 15-60 minutes) in 1-4 bars.
- Previous research showed 1m cascade detection is too noisy (false positives from normal volatility).
- 15m gives enough resolution to time entries after cascade stabilization while avoiding noise.
- Holding period of 1-8 bars (15min to 2h) matches the typical cascade recovery timeline.

---

## Asset Configuration

### Primary Asset

**Asset**: DOGE/USDT

**Why**: High leverage usage, frequent cascades, proven FR V2 alpha, extensive cached data.

### Signal Assets

**OI Data**: Same symbol OI from Bybit API (same infrastructure as Strategy 1)

### Recommended Test Assets

| Asset | Type | Rationale |
|-------|------|-----------|
| DOGE/USDT | Meme | Frequent cascades, high retail leverage |
| SOL/USDT | Large cap | Active cascade events, liquid |
| ARB/USDT | Mid cap | Mid-cap cascade dynamics |
| PEPE/USDT | Meme | Extreme leverage, very volatile |
| WIF/USDT | Meme | High leverage retail participation |

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| OI Rate of Change | 15m | Cascade detection (OI crash) | period: 1-4 bars | Rapid OI decline = mass liquidations |
| Price ROC | 15m | Cascade speed | period: 1-4 bars | Large price move confirms cascade |
| Volume Spike | 15m | Cascade confirmation | threshold: 2-5x avg | High volume = forced orders |
| Cascade Score | 15m | Composite signal | weights configurable | Combined OI crash + price crash + volume spike |
| ATR | 15m | Risk management | period: 14 | Dynamic stops |
| RSI | 15m | Extreme confirmation | period: 5 (ultra-short) | RSI(5) < 10 or > 90 at cascade extreme |
| EMA | 15m | Trend context | period: 100 | Only bounce in direction of longer trend |

### Additional Data Requirements

- **Open Interest History**: Same as Strategy 1 (Bybit API, 15m or 5m resolution)
- **Volume**: Standard OHLCV volume (already available)

### Data Preprocessing

- **Cascade Score Calculation**: Composite score combining:
  1. OI crash magnitude: `abs(OI_ROC_1bar)` normalized by historical OI volatility
  2. Price crash magnitude: `abs(Price_ROC_1bar)` normalized by ATR
  3. Volume spike: `volume / SMA(volume, 20)`
  - Score = weighted sum of these three, normalized to 0-100

---

## Entry Logic

### Long Entry (After Bearish Cascade -- Buying the Dip)

**ALL of the following must be true:**

1. **Cascade Detected** (composite score > threshold):
   - OI dropped > `oiCrashThreshold` % in last `cascadeBars` bars (e.g., OI down > 5% in 2 bars)
   - Price dropped > `priceCrashThreshold` * ATR in same period (e.g., > 3x ATR drop)
   - Volume > `volumeSpikeThreshold` * average (e.g., > 3x average)
   - Timeframe: 15m

2. **Cascade Stabilizing** (OI decline slowing):
   - Current bar OI delta is less negative than previous bar (deceleration)
   - OR current bar OI delta is positive (liquidations clearing, new positions entering)
   - This is the KEY signal: we don't buy during the cascade, we buy when it's ENDING

3. **Extreme Oversold**:
   - RSI(5) < `rsiExtreme` (e.g., < 15)
   - Ultra-short RSI confirms extreme selling pressure

4. **Trend Alignment** (optional safety filter):
   - Price is still above EMA(100) -- the cascade is a temporary dip within an uptrend
   - If price broke below EMA(100), the cascade may be a genuine trend break; skip trade

**Position Sizing**:
- Conservative: 20-30% of equity at 2-3x leverage
- Lower than other strategies due to higher tail risk

### Short Entry (After Bullish Cascade -- Selling the Rip)

Mirror logic: OI crash + price spike + volume spike + stabilization + RSI(5) > 85 + below EMA(100)

### Entry Examples

**Example 1: Long After DOGE Cascade**
- DOGE at 14:00: $0.1800, OI = $200M
- DOGE at 14:15: $0.1720, OI = $188M (-6.0% OI crash in 1 bar)
- Volume: 5x average (forced liquidation orders)
- DOGE at 14:30: $0.1710, OI = $186M (-1.1% decline, decelerating from -6%)
- RSI(5) = 8 (extreme oversold)
- EMA(100) = $0.1650 (still above -- this is a dip, not a trend break)
- **Action**: Enter long at $0.1710
- Stop: $0.1710 - (ATR * 2.5) = ~$0.1665 (-2.6%)
- TP: $0.1710 + (ATR * 3.0) = ~$0.1764 (+3.2%)
- Time exit: 8 bars (2 hours)
- Expected outcome: Price recovers ~50% of cascade drop to $0.1755

---

## Exit Logic

### Stop Loss

**Type**: ATR-based (wider than other strategies due to post-cascade volatility)
**Calculation**: `stopPrice = entryPrice -/+ (ATR * atrStopMultiplier)`
- Default atrStopMultiplier: 2.5 (wider than usual)

### Take Profit

**Type**: Percentage of cascade distance
**Calculation**: `takeProfitPrice = entryPrice +/- (cascadeDistance * cascadeRecoveryPct)`
- `cascadeDistance` = absolute price change during detected cascade
- `cascadeRecoveryPct` = target recovery (default 50% of cascade distance)
- Alternative: ATR-based TP as fallback if cascadeDistance is hard to compute

### Signal-Based Exit

**Cascade Continuation**: If ANOTHER cascade occurs after entry (OI crashes again), exit immediately. The cascade is deeper than anticipated.

### Time-Based Exit

**Max Holding Period**: `maxHoldBars` bars (default: 8 = 2 hours)

**Rationale**: Post-cascade bounces are fast. If it hasn't recovered in 2 hours, the cascade was likely a trend break.

---

## Risk Management

### Position Sizing

**Method**: Conservative due to tail risk
**Base Size**: 25% of equity (lower than other strategies)
**Leverage**: 2-3x (lower than other strategies)

### Per-Trade Risk

**Max Risk**: ~1.5% of equity per trade (0.25 * 3x * 2% stop = 1.5%)

### Portfolio Risk

**Max Drawdown**: 10% pause threshold
**Max Concurrent Positions**: 1
**Max Daily Cascade Trades**: 2 (cascades can continue, limit exposure)
**Cooldown**: 8 bars between cascade trades (2 hours)

### Leverage

**Max Leverage**: 3x

**Rationale**: Post-cascade environments are inherently risky. The cascade might continue. 2-3x provides moderate amplification while limiting catastrophic loss scenarios.

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| oiCrashThreshold | number | 2.0 | 10.0 | 1.0 | 5.0 | Min OI % decline to detect cascade |
| priceCrashAtrMult | number | 1.5 | 5.0 | 0.5 | 3.0 | Min price crash as ATR multiple |
| volumeSpikeThreshold | number | 2.0 | 6.0 | 1.0 | 3.0 | Min volume spike multiple |
| cascadeBars | number | 1 | 4 | 1 | 2 | Bars to detect cascade over |
| rsiPeriod | number | 3 | 7 | 2 | 5 | Ultra-short RSI period |
| rsiExtreme | number | 10 | 25 | 5 | 15 | RSI extreme level for entry |
| useTrendFilter | boolean | - | - | - | true | Require EMA alignment |
| emaPeriod | number | 50 | 200 | 50 | 100 | Trend EMA period |
| atrPeriod | number | 10 | 20 | 2 | 14 | ATR period |
| atrStopMultiplier | number | 2.0 | 4.0 | 0.5 | 2.5 | Stop ATR multiplier (wider) |
| cascadeRecoveryPct | number | 0.3 | 0.7 | 0.1 | 0.5 | Target % of cascade to recover |
| capitalFraction | number | 0.15 | 0.35 | 0.05 | 0.25 | Equity fraction (conservative) |
| leverage | number | 1 | 3 | 1 | 2 | Leverage (conservative) |
| maxHoldBars | number | 4 | 16 | 4 | 8 | Max hold (15m bars) |
| cooldownBars | number | 4 | 12 | 4 | 8 | Cooldown between cascade trades |
| maxDailyCascadeTrades | number | 1 | 3 | 1 | 2 | Max cascade trades per 24h |

---

## System Gaps

### Required Extensions

**1. OI Data Infrastructure** (same as Strategy 1)
- Shared requirement: OI caching script, database table, StrategyContext extension
- Must be implemented for Strategy 1 anyway; this strategy reuses it

**2. Cascade Detection Logic**
- **What**: Helper function that computes composite cascade score from OI, price, and volume changes
- **Why**: Core signal for this strategy
- **Complexity**: Simple (math-only, no external data)
- **Priority**: Medium (strategy-specific, can be in strategy file)

### Workarounds

**Without OI Data**: The strategy can partially function using only price crash + volume spike for cascade detection. However, without OI data, false positive rate increases significantly (genuine fundamental moves also cause price crashes with high volume). OI decline is the differentiator between "liquidation cascade" and "genuine selloff."

**Partial OI Data**: If OI data has gaps during the exact cascade period (Bybit note: "during extreme volatility, this interface may experience increased latency"), use volume spike as primary and accept higher noise.

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **OI Liquidation Cascade Bounce** strategy for the crypto backtesting system.

#### Strategy Overview

This strategy detects liquidation cascades using a composite of OI crash (sharp decline), price crash, and volume spike. After detecting a cascade and confirming it is stabilizing (OI decline decelerating), it enters a counter-trend position betting on the post-cascade snapback.

This strategy:
- Trades on **15m** timeframe
- Uses **OI rate-of-change, price ROC, volume spike, RSI(5), EMA, ATR**
- Entry: Long when bearish cascade stabilizes (OI decline decelerating + RSI extreme + trend aligned); Short mirror
- Exit: Cascade-distance-based TP, ATR SL, time exit, or cascade continuation
- Risk: 2-3x leverage, 25% capital (conservative), wider stops

**IMPORTANT**: This strategy depends on the OI data infrastructure from Strategy 1 (OI caching, StrategyContext extension). Implement those first.

---

#### Strategy Implementation

**File Location**: `/workspace/strategies/oi-liquidation-cascade-bounce.ts`

#### Key Helper: Cascade Detection

```typescript
interface CascadeSignal {
  detected: boolean;
  direction: 'bearish' | 'bullish' | null; // bearish = price crash, bullish = price spike
  oiChangePct: number;
  priceChangeAtr: number;
  volumeMultiple: number;
  compositeScore: number;
}

function detectCascade(
  oiHistory: { timestamp: number; openInterestAmount: number }[],
  candles: { timestamp: number; close: number; volume: number }[],
  currentIndex: number,
  atr: number,
  avgVolume: number,
  params: {
    oiCrashThreshold: number;
    priceCrashAtrMult: number;
    volumeSpikeThreshold: number;
    cascadeBars: number;
  }
): CascadeSignal {
  // Calculate OI change over cascadeBars
  const currentOi = findNearestOi(oiHistory, candles[currentIndex].timestamp);
  const pastOi = findNearestOi(oiHistory, candles[currentIndex - params.cascadeBars]?.timestamp);

  if (!currentOi || !pastOi || pastOi === 0) {
    return { detected: false, direction: null, oiChangePct: 0, priceChangeAtr: 0, volumeMultiple: 0, compositeScore: 0 };
  }

  const oiChangePct = ((currentOi - pastOi) / pastOi) * 100;
  const priceChange = candles[currentIndex].close - candles[currentIndex - params.cascadeBars].close;
  const priceChangeAtr = Math.abs(priceChange) / atr;
  const volumeMultiple = candles[currentIndex].volume / avgVolume;

  const oiCrashing = Math.abs(oiChangePct) >= params.oiCrashThreshold;
  const priceCrashing = priceChangeAtr >= params.priceCrashAtrMult;
  const volumeSpiking = volumeMultiple >= params.volumeSpikeThreshold;

  const detected = oiCrashing && priceCrashing && volumeSpiking;
  const direction = priceChange < 0 ? 'bearish' : 'bullish';

  // Composite score: weighted average
  const compositeScore = (
    Math.abs(oiChangePct) / params.oiCrashThreshold * 0.4 +
    priceChangeAtr / params.priceCrashAtrMult * 0.35 +
    volumeMultiple / params.volumeSpikeThreshold * 0.25
  ) * 100;

  return { detected, direction: detected ? direction : null, oiChangePct, priceChangeAtr, volumeMultiple, compositeScore };
}
```

#### Key Logic: Cascade Stabilization Check

```typescript
function isCascadeStabilizing(
  oiHistory: { timestamp: number; openInterestAmount: number }[],
  currentTs: number,
  prevTs: number,
  prevPrevTs: number
): boolean {
  const currentOi = findNearestOi(oiHistory, currentTs);
  const prevOi = findNearestOi(oiHistory, prevTs);
  const prevPrevOi = findNearestOi(oiHistory, prevPrevTs);

  if (!currentOi || !prevOi || !prevPrevOi) return false;

  const currentDelta = currentOi - prevOi;
  const prevDelta = prevOi - prevPrevOi;

  // Stabilizing = current OI change less negative (decelerating) or turning positive
  return currentDelta > prevDelta;
}
```

#### onBar() Logic Summary

```
1. Early return if insufficient data
2. Check cooldown and daily trade limit

EXIT LOGIC:
3. If in position:
   a. SL check (ATR-based, wider)
   b. TP check (cascade recovery %)
   c. Cascade continuation: if another cascade detected -> emergency exit
   d. Time exit

ENTRY LOGIC:
4. If no position and cooldown clear:
   a. Detect cascade (composite score)
   b. If cascade detected and direction == 'bearish':
      - Check stabilization (OI decline decelerating)
      - Check RSI(5) < rsiExtreme
      - Check trend filter (price > EMA if enabled)
      - If ALL -> openLong
   c. If cascade detected and direction == 'bullish':
      - Mirror logic -> openShort
5. Track entry bar, cascade distance for TP calculation
```

#### State Tracking

The strategy needs to track:
- `lastTradeBar`: for cooldown
- `dailyTradeCount`: trades today (reset at 00:00 UTC)
- `cascadeDistance`: price change during the detected cascade (for TP calculation)
- `cascadeDetectedBar`: bar when cascade was first detected
- `entryBar`: bar when position was opened

#### Validation Checklist

- [ ] TypeScript compiles
- [ ] Strategy validates
- [ ] OI data cached for test symbols
- [ ] Backtest generates trades (expect fewer trades than Strategy 1 -- cascades are rare)
- [ ] Wider stops and conservative sizing correctly implemented

#### Testing Instructions

```bash
# Validate
npx tsx src/cli/quant-validate.ts strategies/oi-liquidation-cascade-bounce.ts

# Quick backtest (expect 5-15 trades over 6 months -- cascades are infrequent)
npx tsx src/cli/quant-backtest.ts --strategy=oi-liquidation-cascade-bounce --symbol=DOGE/USDT --from=2024-06-01 --to=2025-06-01 --timeframe=15m --mode=futures --leverage=2

# Use longer period for more trades
npx tsx src/cli/quant-backtest.ts --strategy=oi-liquidation-cascade-bounce --symbol=DOGE/USDT --from=2024-01-01 --to=2026-03-01 --timeframe=15m --mode=futures --leverage=2
```

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Optimization Period (In-Sample)**:
- Target Sharpe Ratio: > 1.0
- Target Win Rate: 55-70% (when cascades are correctly identified, bounce probability is high)
- Target Total Return: 15-40% annually at 2x leverage
- Max Acceptable Drawdown: < 12%

**Test Period (Out-of-Sample)**:
- Target Sharpe Ratio: > 0.7
- Target OOS Degradation: < 35%
- Max Acceptable Drawdown: < 18%

**Trading Activity**:
- Expected Trades per Month: 3-8 (cascades are infrequent events)
- Average Trade Duration: 30 min to 2 hours
- Typical Position Size: 25% of equity at 2x leverage

**CRITICAL WARNING**: Low trade frequency means statistical validation is difficult. Need 2+ years of data to get 30+ trades for meaningful OOS testing. This is the strategy's biggest weakness -- it may show great per-trade metrics but insufficient sample size for confidence.

**Multi-Asset Performance**:
- Expected Pass Rate: 30-50% (asset-specific cascade patterns)
- Works Best On: High-leverage meme coins (DOGE, PEPE, WIF)
- May Struggle On: BTC (cascades are less frequent and quickly arbitraged), stablecoins

---

## References

**Academic Papers**:
1. "Anatomy of the Oct 10-11, 2025 Crypto Liquidation Cascade", Ali, SSRN 5611392
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5611392
   - Key Finding: $19B OI erased in 36h, reflexive feedback loops between leverage and liquidity

2. "Chasing Liquidation Cascade Alpha in Crypto" (CAUTIONARY), Tigro Blanc, Medium 2026
   - URL: https://medium.com/@tigroblanc/chasing-liquidation-cascade-alpha-in-crypto-how-to-get-299-return-with-sharpe-3-58-322ef625a8d1
   - Key Finding: Strategy did NOT contain statistically significant alpha after removing BTC beta. Alpha shrinks to +0.98% with p=0.182.

**Industry Research**:
1. "Liquidations in Crypto: How to Anticipate Volatile Market Moves", Amberdata
   - URL: https://blog.amberdata.io/liquidations-in-crypto-how-to-anticipate-volatile-market-moves
   - Key Finding: Liquidation zones become future support/resistance

2. "Bitcoin's $2 Billion Reckoning", CoinChange
   - URL: https://www.coinchange.io/blog/bitcoins-2-billion-reckoning-how-novembers-liquidations-cascade-exposed-cryptos-structural-fragilities
   - Key Finding: $2B forced liquidations with subsequent partial recovery pattern

3. Bybit API - Get Open Interest
   - URL: https://bybit-exchange.github.io/docs/v5/market/open-interest

---

## Change Log

**Version 1.0** - 2026-03-05
- Initial specification
- Highest-risk, highest-potential-reward strategy of the three
- Depends on OI infrastructure from Strategy 1
- Cautionary: Tigro Blanc study found cascade alpha may be BTC beta in disguise
- Mitigation: Use OI decline as cascade-specific filter (not just price decline)
- Low trade frequency is the biggest concern for statistical validation
