# FR Spike V2 Optimization Research: Top 5 Experiments for Sharpe > 1.5

> **Created**: 2026-03-03 14:00
> **Author**: quant-lead agent (opus)
> **Status**: Research Complete
> **Context**: Production paper trading running FR-spike-v2 single_strongest on LDO/DOGE/IMX/ICP/XLM/NEAR (4h) with Sharpe 1.88

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Experiment 1: Reconstruct Aggregation with v1 Top Performers](#experiment-1)
3. [Experiment 2: Expand Symbol Universe to 50+ Assets](#experiment-2)
4. [Experiment 3: FR Cross-Sectional Momentum Portfolio](#experiment-3)
5. [Experiment 4: Open Interest + FR Composite Signal](#experiment-4)
6. [Experiment 5: Decorrelated Multi-Basket Regime-Filtered Config](#experiment-5)
7. [Deprioritized Ideas](#deprioritized-ideas)
8. [Implementation Roadmap](#implementation-roadmap)
9. [References](#references)

---

## 1. Current State Analysis

### Why the Production Config Uses LDO/DOGE/IMX/ICP/XLM/NEAR

The production config was selected from a V2 scan (29 symbols x 2 TFs = 58 runs). The V2 strategy introduced several enhancements over V1:
- Adaptive rolling percentile thresholds (replacing fixed absolute thresholds)
- ATR-based volatility filter (blocks entries during high-vol regimes)
- Trend alignment filter (blocks shorts in uptrends, longs in downtrends)
- ATR trailing stops
- Dynamic position sizing (vol-adjusted or fractional Kelly)

**The trend filter is the key difference.** V1's top performers (ATOM, ADA, DOT, INJ, OP) are all assets that generated contrarian signals AGAINST strong trends -- e.g., shorting ADA during a bull run because FR was extreme. V1 allowed this. V2's trend filter blocks it, which filters out many of the v1 winners but improves consistency for assets where contrarian signals align with the trend.

LDO/DOGE/IMX/ICP/XLM/NEAR rose to the top in V2 specifically because their FR spikes tend to occur during trend-aligned conditions (e.g., funding goes extremely negative during genuine downtrends, or extremely positive during overextended rallies that subsequently correct).

**This means the V1 and V2 winners have different edge profiles:**
- V1 winners: Pure contrarian FR spikes, regardless of trend (higher risk, higher reward per trade, fewer but more extreme signals)
- V2 winners: Trend-aligned contrarian FR spikes (lower risk per trade, more consistent, slightly more signals)

### The Aggregation Exploration Results

The `explore-fr-v2-aggregations.ts` script tested 20 configurations. The V2 Top7 single_strongest (LDO/DOGE/IMX/ICP/XLM/NEAR at 4h) achieved Sharpe ~1.89 with 230.7% return and 16.4% maxDD over 2 years. This was the best configuration found.

**Key observations from the exploration:**
1. `single_strongest` beats `top_n` and `weighted_multi` for this strategy (concentration amplifies the strongest signal)
2. V1 tops with `useTrendFilter:false` had mixed results in aggregation
3. Wider entry percentiles (90/10 instead of 95/5) increased trades but diluted signal quality
4. The full 29-symbol universe with `top_n maxPos=5` underperformed the curated 7-symbol config

---

<a name="experiment-1"></a>
## Experiment 1: Head-to-Head Aggregation Tournament with V1 Top Performers

### Hypothesis

The V1 scan's top performers (ADA 1h: Sharpe 1.56, DOT 4h: 1.50, ADA 4h: 1.50, ETC 4h: 1.40) were never tested with V2 strategy code using `useTrendFilter: false`. A portfolio of V1-optimal assets running V2 code (with percentile thresholds, ATR stops, vol-adjusted sizing) but trend filter disabled could outperform the current production config. The V2 improvements besides the trend filter (adaptive thresholds, ATR stops, dynamic sizing) are universally beneficial; the trend filter is the only one that changes which assets win.

### Why This Is Promising

- ADA 1h achieved Sharpe 1.56 in v1 scan (74 symbols x 2 TFs), the highest individual score
- DOT 4h achieved Sharpe 1.50 and PASSED walk-forward in v1 (Test Sharpe 1.63)
- ATOM 4h PASSED walk-forward in v1 (Test Sharpe 2.26 -- improved OOS)
- These assets have PROVEN structural edge from v1 validation
- V2's other improvements (percentile thresholds, ATR stops, Kelly sizing) should make them even better
- The trend filter is the only thing suppressing them in v2 -- and for contrarian FR trading, trend-opposing entries ARE the edge

### Concrete Experiment Plan

Run 6 aggregation configs and compare to production baseline:

| Config # | Name | Assets | TF | Trend Filter | Allocation | maxPos |
|----------|------|--------|-----|--------------|------------|--------|
| Baseline | Production | LDO,DOGE,IMX,ICP,XLM,NEAR | 4h | ON (default) | single_strongest | 1 |
| A1 | V1 Tops NoTF | ADA,DOT,ATOM,ETC,MANA | 4h | OFF | single_strongest | 1 |
| A2 | V1 Tops NoTF 1h | ADA,DOT,ATOM,ETC,MANA | 1h | OFF | single_strongest | 1 |
| A3 | V1 Tops Mixed TF | ADA(1h),DOT(4h),ATOM(4h),ETC(4h),MANA(4h) | mixed | OFF | single_strongest | 1 |
| A4 | V1+V2 Hybrid | ADA,DOT,ATOM + LDO,DOGE,IMX | mixed | mixed* | single_strongest | 1 |
| A5 | Top10 All | ADA,DOT,ATOM,ETC,MANA,LDO,DOGE,IMX,ICP,XLM | 4h | mixed* | single_strongest | 1 |
| A6 | Top10 TopN | Same as A5 | 4h | mixed* | top_n | 3 |

*mixed = V1 assets get `useTrendFilter:false`, V2 assets get default (true)

### Success Criteria

- Sharpe > 1.5 over 2024-01-01 to 2026-03-01
- MaxDD < 15%
- At least 50 trades (statistical significance)
- Return > 100% over 2 years

### Overfitting Risk: LOW

This is NOT parameter optimization -- we are testing already-validated assets (walk-forward proven ATOM, DOT) with a simple boolean toggle (trend filter on/off). The symbol selection was determined by the v1 scan, not by fitting to this experiment.

### System Gaps: NONE

All required infrastructure exists. The `useTrendFilter` param is already in v2. The `explore-fr-v2-aggregations.ts` script template is ready to be extended.

### Implementation Prompt

```
Extend /workspace/scripts/explore-fr-v2-aggregations.ts to add 6 new configs:

1. V1 Tops NoTF 4h single_strongest: ['ADA','DOT','ATOM','ETC','MANA'] at 4h,
   all with params { useTrendFilter: false }, single_strongest, maxPos=1

2. V1 Tops NoTF 1h single_strongest: same assets at 1h, same params

3. V1 Tops Mixed TF single_strongest: ADA at 1h, DOT/ATOM/ETC/MANA at 4h,
   all with { useTrendFilter: false }, single_strongest, maxPos=1

4. V1+V2 Hybrid single_strongest:
   ADA(1h, useTrendFilter:false), DOT(4h, useTrendFilter:false),
   ATOM(4h, useTrendFilter:false) + LDO(4h, default), DOGE(4h, default),
   IMX(4h, default), single_strongest, maxPos=1

5. Top10 All single_strongest:
   ADA,DOT,ATOM,ETC,MANA with { useTrendFilter: false } at 4h
   + LDO,DOGE,IMX,ICP,XLM with default params at 4h
   single_strongest, maxPos=1

6. Top10 All top_n maxPos=3:
   Same as #5 but allocation=top_n, maxPositions=3

Run with --from=2024-01-01 --to=2026-03-01
Save all results to DB via saveBacktestRun()
Print summary table sorted by Sharpe
```

### Expected Outcome

The hybrid config (A4) or mixed TF config (A3) should beat the production baseline because:
- It gets the best of both worlds: V1's proven contrarian edge + V2's trend-aligned signals
- More diverse signal sources means more trading opportunities
- The single_strongest allocation picks whichever signal is most extreme regardless of which "mode" it comes from

---

<a name="experiment-2"></a>
## Experiment 2: Expand Symbol Universe to 50+ Bybit Perpetuals

### Hypothesis

We only scanned 29 symbols out of Bybit's 800+ perpetual contracts. The FR spike edge should exist on ANY liquid perpetual future where retail traders overlever. Mid-cap tokens with high retail participation (SUI, ARB, TIA, SEI, JUP, STRK, WLD, APT, FTM, AVAX, MATIC/POL, FIL, RUNE, THETA, SAND) likely have MORE volatile funding rates than the large-caps we already tested, which could produce MORE extreme signals and higher Sharpe ratios.

### Why This Is Promising

**Structural reasoning:**
- Mid-cap tokens attract more speculative retail traders who lever up aggressively
- Smaller open interest means individual whale positions create larger FR distortions
- These tokens often have narrative-driven price moves (L2 launches, airdrops, token unlocks) that create temporary crowd leverage extremes
- BitMEX's 9-year analysis found funding rates are MORE extreme during early contract history and stabilize over time -- recently listed perpetuals should have juicier signals

**Bybit has 800+ perpetuals.** Even if only 10% (80 contracts) have sufficient liquidity and FR history, that is nearly 3x our current universe. Finding just 3-5 more strong performers would significantly improve the aggregation portfolio.

### Concrete Experiment Plan

**Phase 1: Cache new data (prerequisite)**
```bash
# Cache candles + funding rates for 25 new symbols
npx tsx scripts/cache-funding-rates.ts --exchange=bybit \
  --symbols=SUI/USDT:USDT,ARB/USDT:USDT,TIA/USDT:USDT,SEI/USDT:USDT,JUP/USDT:USDT,STRK/USDT:USDT,APT/USDT:USDT,FTM/USDT:USDT,AVAX/USDT:USDT,POL/USDT:USDT,FIL/USDT:USDT,RUNE/USDT:USDT,THETA/USDT:USDT,SAND/USDT:USDT,TON/USDT:USDT,ALGO/USDT:USDT,GALA/USDT:USDT,CHZ/USDT:USDT,BLUR/USDT:USDT,PYTH/USDT:USDT,JTO/USDT:USDT,BONK/USDT:USDT,PEPE/USDT:USDT,FLOKI/USDT:USDT,ORDI/USDT:USDT \
  --from=2024-01-01

# Also cache candle data for same symbols
# (the bybit provider handles both candles and FR)
```

**Phase 2: Batch scan new symbols**
```bash
# Extend scan-fr-v2.ts to include new symbols, or run with --only flag
npx tsx scripts/scan-fr-v2.ts --only=SUI,ARB,TIA,SEI,JUP,STRK,APT,FTM,AVAX,POL,FIL,RUNE,THETA,SAND,TON,ALGO,GALA,CHZ,BLUR,PYTH,JTO,BONK,PEPE,FLOKI,ORDI
```

**Phase 3: Filter top performers**
- Sharpe > 0.5 at 4h with v2 defaults
- At least 15 trades (statistical significance)
- MaxDD < 20%

**Phase 4: Aggregation test with expanded universe**
- Add new winners to production config
- Test single_strongest with expanded pool
- Compare to baseline 6-asset config

### Target New Asset Categories

| Category | Assets | Why Promising |
|----------|--------|---------------|
| L1 New Gen | SUI, SEI, APT, TON | High retail activity, narrative-driven |
| L2/Rollup | ARB, STRK | Heavy speculative interest, VC unlock cycles |
| Data Availability | TIA | Unique sector, potentially uncorrelated FR |
| Solana Ecosystem | JUP, JTO, PYTH, BONK | Extremely retail-heavy, volatile FR expected |
| Memecoins | PEPE, FLOKI, BONK | Highest FR volatility, but also highest whipsaw risk |
| DeFi/Infra | FIL, RUNE, THETA, ALGO | Infrastructure tokens similar to successful ATOM/DOT profile |
| Gaming/Metaverse | SAND, GALA, CHZ | Retail-heavy, potential for extreme funding |
| Ordinals/BTC Ecosystem | ORDI | Unique narrative-driven FR spikes |

### Success Criteria

- Find at least 3 new symbols with Sharpe > 0.5 at 4h with v2 defaults
- At least 1 new symbol with Sharpe > 1.0
- Expanded aggregation (production config + new winners) achieves Sharpe > 1.5
- New winners have low correlation with existing production assets

### Overfitting Risk: LOW-MEDIUM

Low for individual symbol scans (using default params, not optimizing). Medium for aggregation config selection (choosing which new assets to add could introduce selection bias). Mitigate by: (a) using default params only, (b) requiring Sharpe > 0.5 threshold before inclusion, (c) walk-forward validation on top candidates.

### System Gaps

**Gap 1: Data caching for new symbols**
- **What**: Need to cache candles + funding rates for 25 new symbols
- **Complexity**: Simple (script already exists, just need to run it with new symbols)
- **Prerequisite**: Check Bybit CCXT listing date for each symbol; some may not have 2-year history

**Gap 2: Symbol availability validation**
- **What**: Need to verify each symbol exists as a USDT perpetual on Bybit
- **Complexity**: Simple (CCXT `fetchMarkets()` can list all available symbols)
- **Note**: Some symbols may have different naming (e.g., MATIC vs POL after rebrand)

### Implementation Prompt

```
1. Create script: /workspace/scripts/check-bybit-symbols.ts
   - Uses CCXT to list all Bybit USDT perpetual contracts
   - Filters to those with sufficient trading volume (> $1M/day avg)
   - Outputs list of symbols not yet in our cache
   - Checks listing date to ensure at least 6 months of history

2. Cache data for validated new symbols using existing script:
   scripts/cache-funding-rates.ts

3. Extend scan-fr-v2.ts BASE_SYMBOLS array with new symbols
   OR create separate scan script for new symbols only

4. Run scan and filter for Sharpe > 0.5

5. Test aggregation configs with expanded universe
```

---

<a name="experiment-3"></a>
## Experiment 3: FR Cross-Sectional Momentum (Relative Rank Strategy)

### Hypothesis

Instead of trading assets when their individual FR crosses absolute or percentile thresholds, rank ALL assets by their current FR relative to their own history, and go long the asset with the most extreme negative FR rank while shorting the one with the most extreme positive FR rank. This is a cross-sectional approach inspired by Presto Research's finding that "funding rate data may be more useful when applied cross-sectionally across multiple assets" and by Unravel Finance's research showing cross-sectional carry factors achieve Sharpe ratios above 2.0 in crypto.

### Why This Is Promising

**Strong academic backing:**
- Presto Research found that FR predicts individual asset prices weakly (R-squared 12.5%) but has "favorable performance metrics" when used cross-sectionally
- Unravel Finance's "Enhanced Carry" factor (open-interest-weighted FR composite) combined with momentum achieves Sharpe ~2.5 in long-short crypto portfolios
- The concept is identical to equity carry trade strategies that have been profitable for decades in FX and fixed income

**Why it differs from current strategy:**
- Current v2: "Is this asset's FR extreme relative to its OWN history?" (time-series signal)
- Cross-sectional: "Which asset has the most extreme FR relative to ALL other assets RIGHT NOW?" (relative value signal)
- These are complementary -- the cross-sectional approach works even when no single asset reaches its individual percentile threshold

**Structural reasoning:**
- Cross-sectional signals reduce timing risk -- at any given moment, some asset is always more extreme than others
- Inverse volatility weighting (as recommended by Unravel) naturally manages position sizing
- The approach naturally avoids overfitting because the signal is relative, not absolute

### Concrete Experiment Plan

**New strategy: `funding-rate-cross-sectional.ts`**

Core logic:
1. On each bar, compute the FR percentile rank for each asset (where does current FR sit in its own 90-day history?)
2. Rank all assets by their percentile (0 = most negative, 100 = most positive)
3. Long the asset with the lowest percentile (most extreme negative FR = crowd shorting)
4. Short the asset with the highest percentile (most extreme positive FR = crowd longing)
5. Use inverse-volatility weighting to size positions
6. Hold until the asset is no longer in the top/bottom rank

**Parameters:**
| Parameter | Min | Max | Step | Default | Description |
|-----------|-----|-----|------|---------|-------------|
| lookbackDays | 30 | 180 | 30 | 90 | Percentile lookback window |
| minPercentile | 1 | 15 | 1 | 5 | Min percentile to trigger long (bottom N%) |
| maxPercentile | 85 | 99 | 1 | 95 | Max percentile to trigger short (top N%) |
| atrPeriod | 7 | 30 | 7 | 14 | ATR period for vol weighting |
| stopMultiplier | 1.5 | 4.0 | 0.5 | 2.5 | ATR stop multiplier |
| maxHoldBars | 3 | 20 | 1 | 8 | Max bars to hold |

### Success Criteria

- Sharpe > 1.0 on 2-year backtest (lower bar since this is a novel approach)
- More trades than current strategy (target: 200+ per year across assets)
- MaxDD < 20%
- Positive in both 2024 (bull) and 2025 (mixed) market environments

### Overfitting Risk: MEDIUM

The cross-sectional approach has more degrees of freedom (selecting from N assets each bar). Mitigate by: (a) using large lookback windows (90+ days), (b) simple rank-based selection (not fitting to specific thresholds per asset), (c) walk-forward validation.

### System Gaps

**Gap 1: Multi-asset strategy interface**
- **What**: The current strategy interface processes one asset at a time. A cross-sectional strategy needs simultaneous access to FR data from ALL assets to compute relative ranks
- **Complexity**: Medium
- **Workaround**: Build as an aggregation config where the "strategy" is a wrapper that ranks all sub-strategies by their FR signal weight. The `single_strongest` allocation mode already does something similar -- it picks the highest-weight signal. We could modify the weight calculator to output a cross-sectional rank score.
- **Better approach**: Create a new weight calculator in `weight-calculators.ts` that computes cross-sectional percentile rank instead of individual asset intensity

**Gap 2: Inverse volatility position sizing at the aggregation level**
- **What**: The aggregate engine currently uses fixed capital allocation. Need to add inverse-vol weighting
- **Complexity**: Simple (modify `MultiSymbolPortfolio` or `aggregate-engine.ts`)

### Implementation Prompt

```
This experiment can be approximated WITHOUT major system changes using the existing
aggregation framework:

1. Create a new weight calculator: createCrossSectionalFRWeightCalculator()
   in /workspace/src/core/weight-calculators.ts

   Logic: Instead of returning abs(currentFR) / maxFR (individual intensity),
   compute the percentile rank of currentFR across ALL registered sub-strategies.
   The asset with the most extreme FR (in either direction) gets weight 1.0,
   the least extreme gets weight 0.0.

   This requires the weight calculator to have access to all sub-strategies' FR data,
   which means modifying the WeightContext to include crossSectionalData:
   { symbol: string, currentFR: number }[]

2. Register it for strategy name 'funding-rate-cross-sectional'

3. Use with single_strongest allocation: the engine naturally picks the
   highest-weighted (most extreme cross-sectional) signal

4. Run aggregation with 15+ assets to give the ranking enough diversity

The key insight: single_strongest + cross-sectional weight calculator
IS the cross-sectional momentum strategy, implemented via existing infrastructure.
```

---

<a name="experiment-4"></a>
## Experiment 4: Open Interest Filter for FR Signal Quality

### Hypothesis

Not all FR spikes are created equal. An FR spike that occurs when open interest is ALSO at an extreme (rising rapidly) is far more likely to result in a liquidation cascade and mean-reversion than an FR spike during low/declining OI. Gate.io's research found that "when open interest rises alongside extreme positive funding rates, excessive long positions accumulate, creating conditions for sharp reversals." Adding an OI filter to the v2 strategy should eliminate low-quality signals and improve the Sharpe ratio.

### Why This Is Promising

**Strong empirical basis:**
- Gate.io research: "Integrated frameworks combining funding rates, open interest, and liquidation metrics achieved substantially higher accuracy than relying on single indicators alone"
- The Oct 2025 and Nov 2025 liquidation cascades (erasing $19B and $2B in OI respectively) were preceded by extreme FR + rising OI
- OI data is a leading indicator of leverage buildup -- FR is a lagging indicator (it reflects leverage after the fact). Combining lead + lag should improve timing
- OI rising + FR extreme = crowd is BUILDING leverage, not reducing it. This is the highest-conviction setup

**Why current strategy misses this:**
- V2 only looks at FR percentile and price trend (ATR, SMA)
- It has no concept of whether leverage is building or unwinding
- An FR spike while OI is declining could mean the crowd is already de-leveraging -- the contrarian trade has less edge in this case

### Concrete Experiment Plan

**Phase 1: Cache OI data**
- Bybit provides open interest data via CCXT (`fetchOpenInterestHistory`)
- Cache 8h or 4h OI snapshots for all 29 symbols from 2024-01-01
- Store in new `open_interest` table in PostgreSQL

**Phase 2: Add OI filter to v2 strategy**
- New params: `useOIFilter: boolean`, `oiLookback: number`, `oiPercentile: number`
- Logic: Only enter FR spike trade when current OI is above the `oiPercentile`th percentile of the last `oiLookback` OI readings
- This filters OUT FR spikes that occur during low-leverage environments

**Phase 3: Scan and compare**
- Run all 29 symbols at 4h with OI filter ON vs OFF
- Compare Sharpe, win rate, MaxDD
- Expect: fewer trades, higher win rate, higher Sharpe

### Parameters to Add

| Parameter | Min | Max | Step | Default | Description |
|-----------|-----|-----|------|---------|-------------|
| useOIFilter | - | - | - | true | Enable open interest filter |
| oiLookback | 30 | 180 | 30 | 90 | Number of OI readings for percentile |
| oiPercentile | 50 | 90 | 10 | 70 | Min OI percentile to allow entry |
| oiRisingBars | 1 | 5 | 1 | 2 | Require OI to be rising for N bars |

### Success Criteria

- Sharpe improvement of > 0.2 over v2 baseline per asset
- Win rate improvement of > 5%
- Fewer trades (higher selectivity) with same or better returns
- MaxDD reduction

### Overfitting Risk: LOW-MEDIUM

The OI filter is a simple additional condition, not a new fitted parameter. The hypothesis is well-supported by market microstructure research. However, the specific percentile threshold (70th) needs validation. Mitigate by testing a wide range (50-90th percentile).

### System Gaps

**Gap 1: Open Interest data caching**
- **What**: Need to fetch and cache historical OI data from Bybit
- **Complexity**: Medium
- **Implementation**:
  - Add `OpenInterest` type to `types.ts`
  - Add `open_interest` table to DB with migration
  - Add `getOpenInterest()` and `saveOpenInterest()` to `db.ts`
  - Create `scripts/cache-open-interest.ts`
  - Extend Bybit provider with `fetchOpenInterestHistory()`

**Gap 2: Pass OI data to strategy context**
- **What**: The `StrategyContext` needs a new optional field `openInterest: OpenInterest[]`
- **Complexity**: Simple (same pattern as `fundingRates`)
- **Engine change**: Load OI data alongside FR data when `mode: 'futures'`

**Gap 3: Aggregate engine OI support**
- **What**: The aggregate engine needs to load and pass OI data to sub-strategies
- **Complexity**: Simple (same pattern as funding rates loading)

### Implementation Prompt

```
This experiment requires system extensions BEFORE strategy modification:

STEP 1: Add OI data infrastructure
- Add OpenInterest type to /workspace/src/core/types.ts:
  interface OpenInterest { timestamp: number; symbol: string; openInterest: number; }
- Add open_interest table via migration
- Add CRUD functions to db.ts
- Add fetchOpenInterestHistory to Bybit provider
- Create scripts/cache-open-interest.ts

STEP 2: Pass OI to strategy context
- Add optional openInterest field to StrategyContext
- Modify engine.ts to load OI data when mode='futures'
- Modify aggregate-engine.ts similarly

STEP 3: Add OI filter to funding-rate-spike-v2.ts
- New params: useOIFilter, oiLookback, oiPercentile, oiRisingBars
- In entry pipeline, after FR signal and before ATR/trend filters:
  if (useOIFilter) {
    const recentOI = openInterest.filter(oi => oi.timestamp <= currentCandle.timestamp)
    if (recentOI.length < oiLookback) return; // skip
    const lookback = recentOI.slice(-oiLookback).map(o => o.openInterest)
    const currentOI = lookback[lookback.length - 1]
    const threshold = calcPercentile(lookback, oiPercentile)
    if (currentOI < threshold) return; // OI not high enough, skip
    // Optionally: check OI is rising
    const recentN = lookback.slice(-oiRisingBars)
    const isRising = recentN.every((v, i) => i === 0 || v >= recentN[i-1])
    if (oiRisingBars > 0 && !isRising) return;
  }

STEP 4: Run batch scan with OI filter ON vs OFF
- Compare Sharpe, win rate, MaxDD for each symbol
```

---

<a name="experiment-5"></a>
## Experiment 5: Decorrelated Multi-Basket with Regime Detection

### Hypothesis

The current single_strongest allocation concentrates 100% of capital in one asset. While this maximizes Sharpe when the signal is correct, it also creates concentration risk. A better approach: divide assets into 2-3 decorrelated baskets, allocate capital equally across baskets, and run single_strongest within each basket. Additionally, add a simple regime filter (BTC trend as macro proxy) to reduce trades during unfavorable regimes.

**Key insight from research:** "Funding rate arbitrage exhibits no correlation with HODL strategies" (ScienceDirect 2025), and funding rate spikes on different asset categories (L1s vs DeFi vs meme coins) are largely uncorrelated. This means we can diversify across baskets without losing edge.

### Why This Is Promising

**Portfolio theory:**
- If two uncorrelated strategies each have Sharpe 1.0, combining them with equal allocation yields Sharpe ~1.4 (sqrt(2) scaling)
- Three uncorrelated baskets with Sharpe 1.0 each yields Sharpe ~1.7
- The current production config has Sharpe 1.88 with ONE basket -- splitting into decorrelated baskets could maintain similar Sharpe while dramatically reducing MaxDD

**Regime detection:**
- BitMEX's 9-year analysis shows funding rate dynamics differ dramatically across market phases (2016-2018 extreme volatility, 2024+ stabilization)
- QuantJourney research: "Persistent positive/negative funding indicates crowding; extremes often precede squeezes in range-bound regimes"
- During strong bear markets, contrarian long signals from negative FR often fail because the trend overwhelms mean-reversion
- A simple regime filter (e.g., BTC price above 200-day SMA = bull, below = bear) could:
  - In bull regime: Allow all trades (both long and short contrarian)
  - In bear regime: Only allow long contrarian trades (short FR = crowd panicking, contrarian long works)
  - Avoid shorting during bull markets when trend filter is off (v1-style assets)

### Concrete Experiment Plan

**Basket Construction:**

| Basket | Assets | Profile | Expected Correlation |
|--------|--------|---------|---------------------|
| A: L1 Infrastructure | ADA, DOT, ATOM, AVAX | Proven v1 performers, trend-opposing signals | Within: 0.4-0.6 |
| B: Mid-Cap Diversified | LDO, IMX, ICP, GRT | Proven v2 performers, trend-aligned signals | Within: 0.3-0.5 |
| C: Retail/Volatile | DOGE, XLM, NEAR, MANA | High retail activity, volatile FR | Within: 0.3-0.5 |

Cross-basket correlation expected: 0.1-0.3 (low)

**Capital allocation:**
- 33% per basket
- Within each basket: single_strongest (concentrate on best signal)
- Result: max 3 simultaneous positions, each using 33% of capital

**Regime filter:**
- Fetch BTC daily candles in init()
- Calculate 200-day SMA on BTC
- If BTC > SMA: bull regime (all signals allowed)
- If BTC < SMA: bear regime (only long signals allowed, no shorts)
- This is a blunt filter but avoids the worst drawdowns (shorting into bull, longing into bear)

### Aggregation Config

This can be implemented as THREE separate aggregation configs run in parallel, OR as a single aggregation with `top_n maxPos=3` where each basket contributes 1 signal max.

The cleaner approach: modify the aggregate engine to support "basket groups" within a single aggregation. Each basket has its own sub-strategies and runs single_strongest independently. The portfolio manages capital allocation across baskets.

### Success Criteria

- Portfolio Sharpe > 1.5
- MaxDD < 10% (significantly improved from current 13.3%)
- Return > 80% over 2 years (lower per-basket but more consistent)
- Each basket independently profitable (Sharpe > 0.5)
- Cross-basket correlation < 0.3

### Overfitting Risk: MEDIUM

The basket construction is based on qualitative asset categorization (L1 vs mid-cap vs retail), not on fitting correlation matrices to past data. The regime filter uses BTC 200-day SMA, the most standard trend indicator in crypto. However, the choice of 3 baskets and equal allocation is somewhat arbitrary.

### System Gaps

**Gap 1: Basket-level aggregation**
- **What**: The aggregate engine currently treats all sub-strategies as one pool. Need to support "baskets" where each basket independently selects its best signal, and capital is split across baskets
- **Complexity**: Medium
- **Workaround**: Run 3 separate aggregation configs with 33% initial capital each. Sum equity curves for portfolio-level metrics.
- **Better approach**: Add `basket: string` field to SubStrategyConfig. In allocation logic, group by basket, run single_strongest within each basket independently.

**Gap 2: BTC regime filter in strategy**
- **What**: Need BTC price data available to non-BTC strategies for regime detection
- **Complexity**: Simple (fetch BTC daily candles in init() as documented in QUANT_KNOWLEDGE.md)
- **Workaround**: Add as a strategy-level filter using existing init() hook pattern

### Implementation Prompt

```
APPROACH A (Quick - use existing infrastructure):
1. Create 3 separate aggregation configs in the dashboard:
   - Basket A: ADA(1h),DOT(4h),ATOM(4h),AVAX(4h) all with useTrendFilter:false
     single_strongest, initialCapital=3333
   - Basket B: LDO(4h),IMX(4h),ICP(4h),GRT(4h) default params
     single_strongest, initialCapital=3333
   - Basket C: DOGE(4h),XLM(4h),NEAR(4h),MANA(4h) default params
     single_strongest, initialCapital=3334

2. Run all 3 for 2024-01-01 to 2026-03-01

3. Create a script that loads all 3 results, sums equity curves,
   and calculates portfolio-level metrics

APPROACH B (Proper - extend aggregate engine):
1. Add basket field to SubStrategyConfig
2. In aggregate-engine.ts, when selecting signals:
   - Group signals by basket
   - Within each basket, apply the allocation mode (single_strongest)
   - Allocate capital equally across baskets with active signals
3. Add regime filter as new param in v2 strategy:
   useRegimeFilter: boolean
   regimeSMAperiod: 200
   In init(): fetch BTC daily candles, compute 200-day SMA
   In onBar(): check if current date is bull or bear
   In bear: block short signals
```

---

## Deprioritized Ideas

### Multi-timeframe stacking (ADA 1h + ADA 4h in same aggregation)

**Verdict: Low priority.** Testing ADA at both 1h and 4h in the same aggregation would generate correlated signals -- when ADA's FR spikes, both timeframes would fire. The single_strongest allocator would pick the one with the higher weight (likely 1h since it updates more frequently), making the 4h version redundant. For top_n allocation, it wastes one of the N slots on a correlated signal. Better to use the "best" timeframe per asset.

### Cross-exchange FR arbitrage (Binance vs Bybit)

**Verdict: Interesting but not actionable now.** The spread between Binance and Bybit FR for BTC is typically 0.0019% (0.0081% vs 0.0100%), which translates to ~0.7% annualized. After fees on two exchanges (2x the cost), the spread is too thin. This is a live-trading arbitrage strategy requiring simultaneous positions on two exchanges, which our backtesting system cannot simulate. Requires: multi-exchange order routing, cross-exchange margin management, real-time FR comparison. Complexity: Very High. ROI: Low-Medium.

### Kelly criterion optimization for position sizing

**Verdict: Already implemented.** V2 already has `positionSizeMethod: 'fractionalKelly'`. However, Kelly requires sufficient trade history (20+ trades) before it activates, and the strategy trades infrequently (1-2 trades/month per asset). In aggregation mode with 6-7 assets, each sub-strategy independently tracks its Kelly stats from shadow trades that may not be executed. The current `volAdjusted` sizing is simpler and works well. Testing fractionalKelly in aggregation requires careful engineering of shared vs per-asset trade history. Low marginal improvement expected.

### Enhanced v2 parameter exploration

**Verdict: Risky (overfitting).** The current default params work well across many assets. Grid-searching per-asset optimal params has already been shown to over-optimize (ADA, OP, INJ failed walk-forward with 0 OOS trades). The key lesson from v1 analysis was "default params outperform optimized params." Further parameter tuning is likely to make things worse, not better.

### Seasonal/monthly patterns

**Verdict: Insufficient data.** With only 2 years of data, we cannot reliably detect seasonal patterns (would need 5+ years for monthly seasonality). BitMEX's 9-year analysis found that FR dynamics change dramatically across market phases, but those phases are driven by macro events (ETF launch, halving, regulatory changes), not by calendar seasonality. Not actionable.

---

## Implementation Roadmap

### Priority Order (by expected Sharpe improvement / effort ratio)

| Priority | Experiment | Effort | Expected Impact | Risk |
|----------|-----------|--------|----------------|------|
| 1 | **Exp 1**: V1 Top Performers Aggregation Tournament | 2 hours | High (+0.1-0.3 Sharpe) | Low |
| 2 | **Exp 2**: Expand Symbol Universe to 50+ | 4-6 hours | High (+3-5 new winners) | Low-Medium |
| 3 | **Exp 5**: Decorrelated Baskets (Quick approach) | 3-4 hours | Medium (MaxDD reduction) | Medium |
| 4 | **Exp 4**: OI Filter | 6-8 hours (needs infra) | Medium (+0.1-0.2 Sharpe per asset) | Low-Medium |
| 5 | **Exp 3**: Cross-Sectional FR Momentum | 4-6 hours | Medium-High (novel strategy) | Medium |

### Week 1 (Immediate)
- Run Experiment 1 (all infrastructure exists, just need to add configs and run)
- Start Experiment 2 Phase 1 (cache data for new symbols)

### Week 2
- Complete Experiment 2 (scan new symbols, test aggregations)
- Run Experiment 5 Approach A (3 separate aggregations, quick)

### Week 3
- Build OI infrastructure (Experiment 4 prerequisite)
- Implement cross-sectional weight calculator (Experiment 3)

### Week 4
- Run Experiment 4 with OI filter
- Run Experiment 3 cross-sectional backtest
- Final comparison: select best config for production upgrade

---

## References

### Academic Papers

1. **"Designing funding rates for perpetual futures in cryptocurrency markets"** - arXiv:2506.08573 (2025)
   - URL: https://arxiv.org/abs/2506.08573
   - Key Finding: Clamping function in FR mechanism creates predictable deviations; model-free no-arbitrage bounds hold even without fees

2. **"Exploring Risk and Return Profiles of Funding Rate Arbitrage on CEX and DEX"** - ScienceDirect (2025)
   - URL: https://www.sciencedirect.com/science/article/pii/S2096720925000818
   - Key Finding: FR arbitrage exhibits NO correlation with HODL strategies, providing diversification benefits

3. **"Perpetual Futures Pricing"** - Ackerer, Hugonnier & Jermann, Wharton/Mathematical Finance
   - URL: https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf
   - Key Finding: No-arbitrage pricing with explicit funding payment expressions

4. **"Fundamentals of Perpetual Futures"** - He & Manela (2024), arXiv:2212.06888
   - URL: https://arxiv.org/pdf/2212.06888
   - Key Finding: Theoretical foundation for why FR anchors futures to spot

### Industry Research

5. **"Can Funding Rate Predict Price Change?"** - Presto Research
   - URL: https://www.prestolabs.io/research/can-funding-rate-predict-price-change
   - Key Finding: FR explains 12.5% of price variation for individual assets, but cross-sectional application across top-50 assets shows "favorable performance metrics"

6. **"Cross-Sectional Alpha Factors in Crypto: 2+ Sharpe Ratio Without Overfitting"** - Unravel Finance
   - URL: https://blog.unravel.finance/p/cross-sectional-alpha-factors-in
   - Key Finding: Enhanced Carry (OI-weighted FR composite) + Momentum achieve Sharpe ~2.5 with inverse-vol weighting on top 50 assets

7. **"The Evolution of Funding Rates: 9 Years of BitMEX XBTUSD Analysis"** - BitMEX Blog (2025)
   - URL: https://www.bitmex.com/blog/2025q2-derivatives-report
   - Key Finding: $100K invested in FR arb in 2016 = $8M by 2025. 71.4% of 9,941 funding cycles were positive. Extreme rates resolve rapidly through automated arbitrage.

8. **"XBTUSD Funding Mean Reversion Strategy"** - BitMEX Blog
   - URL: https://www.bitmex.com/blog/xbtusd-funding-mean-reversion-strategy
   - Key Finding: 1-2 sigma thresholds most profitable. Funding receipts provide majority of returns, not directional alpha.

9. **"Funding Rates in Crypto: The Hidden Cost, Sentiment Signal, and Strategy Trigger"** - QuantJourney (Substack)
   - URL: https://quantjourney.substack.com/p/funding-rates-in-crypto-the-hidden
   - Key Finding: Persistent positive/negative FR indicates crowding; extreme rates >0.1% suggest market stress. Combine with volume, OI, and basis spreads.

10. **"How do futures open interest, funding rates, and liquidation data predict crypto price movements?"** - Gate.io Research (2025)
    - URL: https://web3.gate.com/en/crypto-wiki/article/how-do-futures-open-interest-funding-rates-and-liquidation-data-predict-crypto-price-movements-20251226
    - Key Finding: Integrated frameworks combining FR + OI + liquidation data achieved substantially higher accuracy than single indicators. FR > 10% annualized + rising OI = liquidation cascade imminent.

11. **"Anatomy of the Oct 10-11, 2025 Crypto Liquidation Cascade"** - SSRN
    - URL: https://papers.ssrn.com/sol3/Delivery.cfm/5611392.pdf?abstractid=5611392
    - Key Finding: $19B in OI erased in 36 hours. Extreme FR + rising OI preceded the cascade.

### Internal Research

12. **Funding Rate Spike Full Analysis** - `/workspace/docs/2026-02-18-funding-rate-spike-analysis.md`
    - 78 runs across 26 symbols x 3 TFs. WF validated on ATOM and DOT. Default params beat optimized.

13. **FR Spike V2 Aggregation Multi-Asset Spec** - `/workspace/docs/strategies/2026-02-20-140000-fr-spike-aggr-multi-asset.md`
    - Tier 1 (WF validated): ATOM, DOT. Tier 2 (strong defaults): ADA, OP, INJ.

14. **Paper Trading Guidance** - `/workspace/docs/strategies/2026-02-26-140000-paper-trading-guidance-fr-v2.md`
    - Production config details, slippage model, graduation criteria.

---

## Change Log

**Version 1.0** - 2026-03-03
- Initial research document
- 5 experiments defined with concrete plans
- Deprioritized ideas documented with rationale
- Implementation roadmap with weekly plan
