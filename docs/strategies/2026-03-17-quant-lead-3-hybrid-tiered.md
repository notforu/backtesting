# Strategy: FR V3 Hybrid Tiered Aggregation Portfolio

> **Created**: 2026-03-17 12:00
> **Author**: quant-lead agent (opus)
> **Status**: Ready for Implementation & Backtesting
> **Context**: Designing an optimized V3 aggregation portfolio that combines walk-forward validated symbols with per-symbol optimized params and weighted_multi allocation

---

## Executive Summary

This portfolio design combines two previously separate advantages: (1) per-symbol walk-forward-optimized parameters for symbols where optimization data exists (LDO, XLM, NEAR), and (2) the `weighted_multi` allocation mode to spread capital proportionally across the top 2-3 signals by conviction strength. The V3 strategy's BTC EMA200 regime filter with `bearMode='block'` provides macro downside protection. XLM anchors the portfolio as the only symbol with positive bear-market Sharpe.

---

## Hypothesis

**Core Edge**: Funding rate spikes represent structural crowd-leverage imbalances. When the crowd overleverages in one direction, mean-reversion to fair value creates a predictable contrarian trade. The V3 regime filter blocks entries during bear markets where this contrarian edge systematically fails.

**Why Hybrid Tiered Works**: Walk-forward optimization identifies the best parameters per symbol, but only 3 of 7 validated symbols have optimized params. Rather than forcing all symbols onto either default or optimized params, the hybrid approach uses the best available configuration for each symbol. The `weighted_multi` allocation mode then allocates capital proportionally to the FR signal's extremeness (how far above/below the percentile threshold the current FR sits), giving more capital to higher-conviction signals.

**Why `weighted_multi` Over `single_strongest`**:

The current production benchmark uses `single_strongest` (1 position = 100% capital concentration). This maximizes Sharpe when the single best signal is correct, but creates:
- **Concentration risk**: One bad trade costs 100% of position capital
- **Idle capital**: When multiple extreme FR signals fire simultaneously, only one is traded
- **No diversification benefit**: Cannot exploit the low cross-symbol FR correlation documented in ScienceDirect (2025)

`weighted_multi` with maxPositions=3 addresses all three:
- Max 3 concurrent positions, capital proportional to signal weight
- Multiple simultaneous opportunities captured
- Portfolio-level diversification reduces per-trade impact of losses
- Expected: lower peak Sharpe than SS, but lower MaxDD and more robust equity curve

**Why This Edge Persists**:
1. Retail traders systematically overlever in crypto perpetual futures
2. Funding rate mechanism creates a measurable "crowding tax"
3. Mid-cap tokens (LDO, ZEC, TRB, IOST, STG, NEAR) have less efficient FR markets than large-caps
4. XLM has unique FR dynamics that work in BOTH market regimes

**Market Conditions**:
- **Works best**: Bull markets (BTC > EMA200), volatile altcoin environment with frequent FR spikes
- **Neutral**: Choppy/sideways (regime filter occasionally activates, reduces trade frequency)
- **Blocked by design**: Bear markets (BTC < EMA200, bearMode='block' prevents all entries)

---

## Classification

**Style**: Mean Reversion (funding rate contrarian)

**Holding Period**: Swing (8h - 48h, 1-6 funding periods)

**Complexity**: Single-TF multi-asset portfolio (6 assets, 4h timeframe, shared capital with signal-weighted allocation)

**Market Type**: Futures only (requires perpetual futures funding rates)

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: 4h

**Purpose**: Main signal generation, position management, stop/TP checks

**Rationale**: 4h matches the holding period (1-6 funding cycles of 8h each = 8h-48h hold). FR is published every 8h; 4h candles give 2 decision points per funding cycle. Proven optimal across all WF-validated symbols.

### Secondary Timeframes

**BTC Daily (1d)**: Used internally by V3 for regime filter
- **Purpose**: BTC EMA200 regime determination (bull/bear)
- **How Used**: BTC daily candles are injected into strategy state. On each bar, if BTC price > EMA200 of BTC daily closes, regime = BULL (trading allowed). If below, regime = BEAR (all entries blocked).
- **Note**: This data is loaded by the aggregate engine and injected via `_btcDailyCandles`

### Timeframe Interaction

The 4h candle drives all entry/exit decisions. The BTC daily regime is checked once per day (cached). Regime filter only affects new entry decisions -- existing positions are managed normally regardless of regime.

---

## Asset Configuration

### Portfolio Composition (6 Symbols)

The portfolio selects 5 symbols from Tier 1 + Tier 2, plus 1 from Tier 3 (NEAR, because it has optimized params).

| # | Symbol | Tier | WF Test Sharpe | Bull Sharpe | Bear Sharpe | Params | Rationale |
|---|--------|------|---------------|-------------|-------------|--------|-----------|
| 1 | **ZEC** | Tier 1 | 2.771 | +1.04 | -1.15 | Default | Highest WF Sharpe in entire universe. Strong bull performer. |
| 2 | **LDO** | Tier 1 | 1.843 | +1.71 | N/A | **Optimized** | Second-best WF. Excellent bull Sharpe. Optimized params available. |
| 3 | **XLM** | Tier 1 | 1.439 | +0.43 | **+1.10** | **Optimized** | ONLY symbol with positive bear Sharpe. All-weather anchor. |
| 4 | **TRB** | Tier 2 | 1.514 | +0.97 | -1.45 | Default | Strong WF and bull performance. Regime filter protects bear. |
| 5 | **IOST** | Tier 2 | 1.199 | +1.40 | -1.77 | Default | Highest bull Sharpe in Tier 2 (1.40 in both bull periods). |
| 6 | **NEAR** | Tier 3 | 1.170 | +0.77 | -1.37 | **Optimized** | Marginal standalone but has optimized params. Adds diversity. |

### Why These 6 (Not 5 or 7)

**Excluded STG** (Tier 3, WF 1.118, Bull +0.89, no bear data):
- Weakest WF Sharpe
- No bear data means unknown risk profile
- No optimized params available
- Adding a 7th symbol dilutes capital further in weighted_multi mode without proportional benefit

**Included NEAR over STG**:
- Has walk-forward-optimized parameters (holdPeriods=3, shortPct=96, longPct=6, atrStop=3, atrTP=2.5)
- Optimized params should improve on default performance
- Still above minimum WF threshold (1.170)

### Symbol Diversity

The 6 symbols span different crypto sectors:
- **ZEC**: Privacy coin (unique market dynamics, regulatory-driven volatility)
- **LDO**: DeFi/staking infrastructure (Lido DAO)
- **XLM**: Payments/remittance (Stellar)
- **TRB**: Oracle infrastructure (Tellor)
- **IOST**: Layer 1 infrastructure
- **NEAR**: Layer 1 smart contract platform

This sector diversity reduces correlation between FR spike events, which is critical for `weighted_multi` to provide real diversification benefit.

---

## Indicators & Data Requirements

### Per-Symbol Indicators (calculated by V3 strategy internally)

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| Funding Rate Percentile | 4h (8h FR) | Entry signal | lookback=90, short=95/96/94, long=5/2/10/6 | Per-symbol thresholds |
| SMA(50) | 4h | Asset-level trend filter | period=50 | useTrendFilter=true (default) |
| ATR(14) | 4h | Stop/TP levels, position sizing, vol filter | period=14 | Stops set at entry ATR |
| FR Normalization | 4h | Exit signal | 75th/25th percentile | Exit when FR normalizes |
| BTC EMA(200) | 1d | Regime filter | period=200, type=ema | Bull/bear classification |

### Funding Rate Data

- Source: Bybit perpetual futures (CCXT)
- Published every 8 hours (00:00, 08:00, 16:00 UTC)
- Must be cached via `scripts/cache-funding-rates.ts`
- Minimum 90 observations (~30 days) for percentile calculation

### BTC Daily Candles

- Source: Bybit (or Binance for historical periods)
- At least 200 daily candles needed for EMA200
- Injected into strategy via `(strategy as any)._btcDailyCandles`

---

## Entry Logic

### Overview

The V3 strategy handles all entry logic internally. The aggregate engine's role is to:
1. Run each sub-strategy in shadow mode to generate signals
2. Compute signal weights (FR intensity / max FR intensity for that symbol)
3. Select top N signals by weight when allocation mode is `weighted_multi`
4. Allocate capital proportionally to signal weight

### Long Entry Conditions (per sub-strategy)

**ALL of the following must be true:**

1. **Regime filter**: BTC daily close > BTC EMA(200) (bull regime)
2. **FR signal**: Current funding rate < Xth percentile of last 90 FR observations (symbol-specific threshold)
3. **ATR volatility filter**: Current ATR < 1.5 * rolling average ATR (not too volatile)
4. **Trend alignment**: Asset price > SMA(50) on 4h (in uptrend -- don't long in downtrend)
5. **No existing position**: Not already in a position for this symbol

### Short Entry Conditions (per sub-strategy)

**ALL of the following must be true:**

1. **Regime filter**: BTC daily close > BTC EMA(200) (bull regime -- in bear, bearMode='block' prevents ALL entries)
2. **FR signal**: Current funding rate > Yth percentile of last 90 FR observations (symbol-specific threshold)
3. **ATR volatility filter**: Current ATR < 1.5 * rolling average ATR
4. **Trend alignment**: Asset price < SMA(50) on 4h (in downtrend -- don't short in uptrend)
5. **No existing position**: Not already in a position for this symbol

### Position Sizing (per sub-strategy, then overridden by aggregate engine)

The aggregate engine overrides individual strategy sizing. For `weighted_multi` with maxPositions=3:
- Total capital available = portfolio equity
- Each selected signal gets capital proportional to its weight: `capitalForSignal = totalCapital * (signalWeight / sumOfSelectedWeights)`
- Position size = `capitalForSignal * positionSizePct / 100 / currentPrice`

---

## Exit Logic

Exit logic is handled entirely by each sub-strategy instance. The aggregate engine monitors for exit signals and closes positions when the strategy signals an exit.

### Stop Loss

**Type**: ATR-based (set at entry, does NOT widen with subsequent ATR changes)

**Per-symbol calculation**:
- LDO: `stopPrice = entryPrice - ATR(14) * 3.5`
- XLM: `stopPrice = entryPrice - ATR(14) * 3.0`
- NEAR: `stopPrice = entryPrice - ATR(14) * 3.0`
- ZEC, TRB, IOST (defaults): `stopPrice = entryPrice - ATR(14) * 2.5`

### Take Profit

**Type**: ATR-based (set at entry)

**Per-symbol calculation**:
- LDO: `tpPrice = entryPrice + ATR(14) * 3.5`
- XLM: `tpPrice = entryPrice + ATR(14) * 5.0`
- NEAR: `tpPrice = entryPrice + ATR(14) * 2.5`
- ZEC, TRB, IOST (defaults): `tpPrice = entryPrice + ATR(14) * 3.5`

### FR Normalization Exit

- Long exit: When FR rises above the 25th percentile (crowd no longer excessively short)
- Short exit: When FR drops below the 75th percentile (crowd no longer excessively long)

### Time-Based Exit

**Per-symbol max hold time** (in 8h funding periods):
- LDO: 4 periods (32h)
- XLM: 6 periods (48h)
- NEAR: 3 periods (24h)
- ZEC, TRB, IOST (defaults): 3 periods (24h)

### Exit Priority

1. Stop loss (checked first -- capital preservation)
2. Take profit (checked second)
3. FR normalization (checked third -- signal-based exit)
4. Time-based exit (last resort)

---

## Risk Management

### Position Sizing

**Method**: Vol-adjusted (default for all sub-strategies)
- `positionPct = basePct * (avgATR / currentATR)` clamped to [15%, 50%]
- Calmer markets = larger positions, volatile markets = smaller positions

### Per-Trade Risk

**Max risk per trade**: Determined by ATR stop distance
- With 2.5x ATR stop and typical 4h ATR, expect ~3-8% per-trade risk
- Vol-adjusted sizing scales this down in high-vol environments

### Portfolio Risk

**Max concurrent positions**: 3 (via `maxPositions=3` in `weighted_multi`)
- Worst case: all 3 positions hit stops simultaneously
- With ~5% average stop distance and 33% capital allocation each, max single-bar loss ~5%
- Much better than `single_strongest` where 1 position with 100% capital at 5% stop = 5% loss

**Capital allocation**: Proportional to signal weight
- Strongest signal gets more capital (up to ~50% in practice)
- Weaker signals get less (down to ~15-20%)
- Natural Kelly-like behavior: more conviction = more capital

**BTC regime filter**: The ultimate portfolio-level risk control
- Blocks ALL new entries when BTC < EMA200
- Existing positions still managed (stops/TP fire)
- Historically eliminates the -0.55 average bear Sharpe drag

### Leverage

**Max leverage**: 1x (no leverage beyond position sizing)
- The strategy uses perpetual futures but sizes positions at 15-50% of equity per trade
- With max 3 concurrent positions, max gross exposure ~150% (unlikely in practice)

---

## Parameter Configuration

### Symbols with Optimized Parameters

**LDO/USDT:USDT** (WF-optimized):
| Parameter | Value | Default | Change |
|-----------|-------|---------|--------|
| holdingPeriods | 4 | 3 | +1 period: longer holds capture more reversion |
| shortPercentile | 96 | 95 | Slightly tighter: only most extreme shorts |
| longPercentile | 2 | 5 | Much tighter: only the most extreme longs |
| atrStopMultiplier | 3.5 | 2.5 | Wider stops: lets trades breathe more |
| atrTPMultiplier | 3.5 | 3.5 | Same as default |

**XLM/USDT:USDT** (WF-optimized):
| Parameter | Value | Default | Change |
|-----------|-------|---------|--------|
| holdingPeriods | 6 | 3 | 2x longer: XLM reverts slowly |
| shortPercentile | 94 | 95 | Slightly wider: more short entries |
| longPercentile | 10 | 5 | 2x wider: more long entries |
| atrStopMultiplier | 3 | 2.5 | Slightly wider stops |
| atrTPMultiplier | 5 | 3.5 | Much wider TP: captures full XLM reversion moves |

**NEAR/USDT:USDT** (WF-optimized):
| Parameter | Value | Default | Change |
|-----------|-------|---------|--------|
| holdingPeriods | 3 | 3 | Same as default |
| shortPercentile | 96 | 95 | Slightly tighter |
| longPercentile | 6 | 5 | Slightly wider |
| atrStopMultiplier | 3 | 2.5 | Wider stops |
| atrTPMultiplier | 2.5 | 3.5 | Tighter TP: NEAR reverts quickly, take profits early |

### Symbols with Default Parameters

**ZEC/USDT:USDT**, **TRB/USDT:USDT**, **IOST/USDT:USDT**: All use V3 defaults:
- holdingPeriods=3, shortPercentile=95, longPercentile=5
- atrStopMultiplier=2.5, atrTPMultiplier=3.5
- useRegimeFilter=true, regimeSMAPeriod=200, regimeMAType='ema', bearMode='block'
- All other params: V3 defaults (useTrendFilter=true, atrFilterEnabled=true, etc.)

### Common V3 Parameters (applied to ALL sub-strategies)

| Parameter | Value | Notes |
|-----------|-------|-------|
| useRegimeFilter | true | BTC EMA200 regime filter active |
| regimeSMAPeriod | 200 | Standard 200-period EMA |
| regimeMAType | 'ema' | EMA reacts faster than SMA to trend changes |
| bearMode | 'block' | Block ALL entries in bear regime |
| usePercentile | true | Adaptive percentile thresholds |
| percentileLookback | 90 | 90 FR observations (~30 days) |
| useATRStops | true | ATR-based stops and TP |
| atrPeriod | 14 | Standard ATR period |
| atrFilterEnabled | true | High-vol entry filter |
| atrFilterThreshold | 1.5 | Block if ATR > 1.5x average |
| useTrendFilter | true | SMA50 trend alignment |
| trendSMAPeriod | 50 | 50-period SMA for trend |
| useTrailingStop | false | No trailing stop (default) |
| positionSizeMethod | 'volAdjusted' | Inverse-volatility sizing |
| positionSizePct | 50 | Base size 50% of equity |
| minPositionPct | 15 | Minimum 15% size |
| maxPositionPct | 50 | Maximum 50% size |
| useFRVelocity | false | No FR velocity filter |

---

## Aggregation Configuration (JSON)

This is the exact JSON config to create via the API (`POST /api/aggregations`) or the dashboard UI:

```json
{
  "name": "FR V3 Hybrid Tiered",
  "allocationMode": "weighted_multi",
  "maxPositions": 3,
  "subStrategies": [
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "ZEC/USDT:USDT",
      "timeframe": "4h",
      "params": {},
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "LDO/USDT:USDT",
      "timeframe": "4h",
      "params": {
        "holdingPeriods": 4,
        "shortPercentile": 96,
        "longPercentile": 2,
        "atrStopMultiplier": 3.5,
        "atrTPMultiplier": 3.5
      },
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "XLM/USDT:USDT",
      "timeframe": "4h",
      "params": {
        "holdingPeriods": 6,
        "shortPercentile": 94,
        "longPercentile": 10,
        "atrStopMultiplier": 3,
        "atrTPMultiplier": 5
      },
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "TRB/USDT:USDT",
      "timeframe": "4h",
      "params": {},
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "IOST/USDT:USDT",
      "timeframe": "4h",
      "params": {},
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "NEAR/USDT:USDT",
      "timeframe": "4h",
      "params": {
        "holdingPeriods": 3,
        "shortPercentile": 96,
        "longPercentile": 6,
        "atrStopMultiplier": 3,
        "atrTPMultiplier": 2.5
      },
      "exchange": "bybit"
    }
  ],
  "initialCapital": 10000,
  "exchange": "bybit",
  "mode": "futures"
}
```

---

## Design Rationale: Why This Configuration

### 1. Why `weighted_multi` with maxPositions=3

**The diversification argument**: The existing "V2 Best 6 (SS)" benchmark achieves Sharpe 1.88 with `single_strongest`. That is excellent, but it concentrates 100% of capital in one position at a time. With 6 symbols competing for a single slot, the winning signal must be correct every time.

With `weighted_multi` and maxPositions=3:
- If 3 signals fire simultaneously, capital is split proportionally (e.g., 50/30/20 based on FR extremeness)
- If only 1 signal fires, it gets 100% (behaves like single_strongest)
- The key advantage: when 2-3 uncorrelated signals fire, the portfolio benefits from diversification
- Expected: lower MaxDD (13.27% -> ~10%), possibly lower Sharpe (1.88 -> ~1.5-1.7), better risk-adjusted equity curve

**Why not maxPositions=2 or 4?**
- maxPositions=2: Marginal diversification. Often degrades to single_strongest when only 1 signal fires.
- maxPositions=4: Over-dilutes capital. With 6 symbols, 4 concurrent positions means ~67% of symbols are active, reducing the "selectivity" benefit.
- maxPositions=3: Sweet spot. ~50% of symbols can be active, meaningful diversification, still selective.

### 2. Why Optimized Params for LDO, XLM, NEAR Only

These are the only 3 symbols that passed walk-forward validation AND had optimization run on them:
- **LDO**: Train 1.879, Test 1.843, degradation only 1.9% -- extremely robust optimization
- **XLM**: Train 1.908, Test 1.439, degradation 24.6% -- good robustness
- **NEAR**: Train 0.742, Test 1.170, degradation -57.7% (IMPROVED out-of-sample) -- anomalous but positive

For ZEC, TRB, IOST: Walk-forward was done but the optimal params from their WF were not recorded in the available research. Using default params is the safe choice -- the earlier research explicitly noted "default params outperform optimized params" as a general principle. Only use optimized params when WF has validated them.

### 3. Why XLM is the Portfolio Anchor

XLM is the ONLY symbol in the entire FR V2/V3 universe with positive Sharpe in bear market regimes:
- Bear 2022 H1: Positive
- Bear 2022 H2: Positive
- Combined bear average: **+1.10**

This means even if the BTC EMA200 regime filter lags (e.g., BTC drops below EMA200 but the filter hasn't triggered yet due to the once-per-day check), XLM positions would still be profitable. XLM acts as an all-weather anchor.

Additionally, XLM's optimized params (longPercentile=10, atrTP=5) are the most different from defaults, suggesting XLM has genuinely different FR dynamics that benefit from customization.

### 4. Why Exclude STG

STG was excluded despite passing WF (1.118) because:
1. Lowest WF Sharpe of all 7 validated symbols
2. No bear market data available (unknown risk profile)
3. No optimized parameters available
4. Adding a 7th symbol to `weighted_multi` with maxPositions=3 means 4 symbols are always idle, diluting the pool without adding to active positions
5. With 6 symbols and 3 max positions, the allocation is already well-diversified

### 5. Why `bearMode='block'` and Not 'shortOnly' or 'mirror'

Based on the regime analysis document:
- FR V2's average bear Sharpe = -0.55 across all symbols
- The problem is structural: contrarian longs against a correct crowd are systematically unprofitable
- `block` is the safest choice: zero exposure in bear markets
- `shortOnly` could work for XLM (which has positive bear Sharpe) but adds complexity
- `mirror` is dangerous: inverting a failed contrarian signal does not create a valid trend-following signal

The simplest approach is best: just do not trade in bear markets.

---

## System Gaps

### No New Gaps Required

All infrastructure for this configuration already exists:

1. **V3 strategy**: `/workspace/strategies/funding-rate-spike-v3.ts` -- fully implemented with BTC EMA200 regime filter, bearMode parameter, and all required params
2. **Aggregate engine**: `/workspace/src/core/aggregate-engine.ts` -- supports `weighted_multi` allocation mode, per-sub-strategy params, BTC daily candle injection
3. **Dashboard aggregation UI**: Supports creating configs with per-symbol params
4. **API**: `POST /api/aggregations` accepts the exact JSON format above

### Potential Improvements (Nice-to-Have)

1. **Per-symbol weight multiplier**: Allow configuring a static weight boost per symbol (e.g., XLM gets 1.2x weight as anchor). Currently all weights are purely FR-intensity-based.
   - Complexity: Simple
   - Priority: Low

2. **Basket-level allocation**: Group symbols into correlated baskets and run single_strongest within each basket. Would further reduce correlation risk.
   - Complexity: Medium
   - Priority: Low (addressed in Experiment 5 of optimization research doc)

---

## Implementation Prompt

### FOR THE QUANT AGENT

You are creating and backtesting the "FR V3 Hybrid Tiered" aggregation portfolio.

#### Step 1: Create the Aggregation Config

Create the aggregation config via the dashboard API:

```bash
curl -X POST http://localhost:3000/api/aggregations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FR V3 Hybrid Tiered",
    "allocationMode": "weighted_multi",
    "maxPositions": 3,
    "subStrategies": [
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "ZEC/USDT:USDT",
        "timeframe": "4h",
        "params": {},
        "exchange": "bybit"
      },
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "LDO/USDT:USDT",
        "timeframe": "4h",
        "params": {
          "holdingPeriods": 4,
          "shortPercentile": 96,
          "longPercentile": 2,
          "atrStopMultiplier": 3.5,
          "atrTPMultiplier": 3.5
        },
        "exchange": "bybit"
      },
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "XLM/USDT:USDT",
        "timeframe": "4h",
        "params": {
          "holdingPeriods": 6,
          "shortPercentile": 94,
          "longPercentile": 10,
          "atrStopMultiplier": 3,
          "atrTPMultiplier": 5
        },
        "exchange": "bybit"
      },
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "TRB/USDT:USDT",
        "timeframe": "4h",
        "params": {},
        "exchange": "bybit"
      },
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "IOST/USDT:USDT",
        "timeframe": "4h",
        "params": {},
        "exchange": "bybit"
      },
      {
        "strategyName": "funding-rate-spike-v3",
        "symbol": "NEAR/USDT:USDT",
        "timeframe": "4h",
        "params": {
          "holdingPeriods": 3,
          "shortPercentile": 96,
          "longPercentile": 6,
          "atrStopMultiplier": 3,
          "atrTPMultiplier": 2.5
        },
        "exchange": "bybit"
      }
    ],
    "initialCapital": 10000,
    "exchange": "bybit",
    "mode": "futures"
  }'
```

Note the returned `id` for subsequent operations.

#### Step 2: Run Backtest (2024-01-01 to 2026-03-01)

```bash
curl -X POST http://localhost:3000/api/aggregations/<CONFIG_ID>/run \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-01-01",
    "endDate": "2026-03-01"
  }'
```

Or via the aggregate engine directly in a script:

```typescript
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';

const result = await runAggregateBacktest({
  subStrategies: [
    // ... same config as above
  ],
  allocationMode: 'weighted_multi',
  maxPositions: 3,
  initialCapital: 10000,
  startDate: new Date('2024-01-01').getTime(),
  endDate: new Date('2026-03-01').getTime(),
  exchange: 'bybit',
  mode: 'futures',
}, { saveResults: true, enableLogging: true });
```

#### Step 3: Compare Against Benchmarks

Run these comparison configs on the same date range:

1. **V2 Best 6 (SS)** benchmark: The existing production config with `single_strongest`
   - Symbols: LDO, DOGE, IMX, ICP, XLM, NEAR
   - Strategy: funding-rate-spike-v2
   - Expected: Sharpe ~1.88, Return ~223%, DD ~13.27%

2. **V3 Validated 7 (SS)**: Same 7 WF-validated symbols, V3, `single_strongest`
   - Symbols: ZEC, LDO, XLM, TRB, IOST, NEAR, STG
   - All default params
   - This tests the regime filter benefit without allocation mode change

3. **FR V3 Hybrid Tiered** (this config): The new weighted_multi with optimized params

Report comparison table:
| Config | Sharpe | Return% | MaxDD% | Trades | PF | Win% |
|--------|--------|---------|--------|--------|-----|------|

#### Step 4: Regime-Split Validation

If results are promising, also test across individual regime periods:
- Bull 2024: 2024-01-01 to 2024-12-31
- Bull 2025+: 2025-01-01 to 2026-03-01

Verify that:
1. Bull period Sharpe >= 0.8
2. No catastrophic drawdowns
3. Trade count is reasonable (30+ trades per year minimum)

#### Step 5: Save Results & Report

Ensure all backtest results are saved to the database. Report final comparison in a markdown file in `/docs/strategies/`.

---

## Expected Performance

### Compared to V2 Best 6 (SS) Benchmark

| Metric | V2 Best 6 (SS) | V3 Hybrid Tiered (Expected) | Direction |
|--------|----------------|------------------------------|-----------|
| Sharpe | 1.88 | 1.40 - 1.70 | Lower (diversification cost) |
| Return % | 223% | 120% - 180% | Lower (capital split across positions) |
| MaxDD % | 13.27% | 8% - 12% | **BETTER** (key advantage) |
| Trades | ~130 | 150 - 250 | More (multiple concurrent positions) |
| Profit Factor | ~2.0 | 1.5 - 2.0 | Similar or slightly lower |
| Win Rate | ~55% | 50-58% | Similar |

### Why Accept Lower Sharpe?

1. **MaxDD reduction is the primary goal**: Moving from 13.27% to ~10% improves capital preservation
2. **Risk-adjusted equity curve**: Smoother equity curve with less concentration risk
3. **Regime protection**: V3's BTC EMA200 filter eliminates bear market losses (not present in V2 benchmark)
4. **Optimized per-symbol params**: LDO, XLM, NEAR should perform better than defaults
5. **Portfolio robustness**: If one symbol enters a bad period, others compensate

### Failure Criteria

This configuration should be REJECTED if:
1. Sharpe < 1.0 (not competitive with simple alternatives)
2. MaxDD > 15% (worse than benchmark's DD)
3. Fewer than 80 trades over 2 years (insufficient statistical significance)
4. Negative return in any bull period
5. Significantly worse than V3 single_strongest with same 6 symbols (allocation mode hurts more than helps)

---

## References

### Internal Research (this project)

1. **FR V2 Walk-Forward: Production Symbols** - `/workspace/docs/strategies/2026-03-06-150000-production-symbols-wf-validation.md`
   - Source of WF-validated symbols and optimized parameters

2. **Regime Split Analysis and Action Plan** - `/workspace/docs/strategies/2026-03-16-180000-regime-split-analysis-action-plan.md`
   - Source of bull/bear Sharpe data, tier classifications, regime filter justification

3. **FR Spike V2 Optimization Research** - `/workspace/docs/strategies/2026-03-03-140000-fr-v2-optimization-research.md`
   - Source of aggregation exploration results, benchmark numbers, experimental framework

4. **New Symbol Scan Results** - `/workspace/docs/strategies/2026-03-06-130000-new-symbol-scan-results.md`
   - Confirms 7 WF-validated symbols are the full viable universe

5. **Tier 1 FR Research Results** - `/workspace/docs/strategies/2026-03-06-tier1-fr-research-results.md`
   - Vol-adjusted sizing validation, FR gradient failure documentation

### Academic & Industry Sources

6. **"Exploring Risk and Return Profiles of Funding Rate Arbitrage on CEX and DEX"** - ScienceDirect (2025)
   - URL: https://www.sciencedirect.com/science/article/pii/S2096720925000818
   - Key Finding: FR arbitrage exhibits NO correlation with HODL strategies, providing diversification benefits. Supports using multiple FR signals simultaneously.

7. **"The Trend is Your Friend: Managing Bitcoin's Volatility with Momentum Signals"** - Grayscale Research
   - URL: https://research.grayscale.com/reports/the-trend-is-your-friend-managing-bitcoins-volatility-with-momentum-signals
   - Key Finding: MA-based momentum filter reduces drawdown and improves risk-adjusted returns. Supports BTC EMA200 regime filter.

8. **"200 Day Moving Average Trading Strategy"** - QuantifiedStrategies.com
   - URL: https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/
   - Key Finding: SMA200 as regime filter reduces max drawdown from 29% to 14%.

9. **"Cross-Sectional Alpha Factors in Crypto: 2+ Sharpe Ratio Without Overfitting"** - Unravel Finance
   - URL: https://blog.unravel.finance/p/cross-sectional-alpha-factors-in
   - Key Finding: Inverse-volatility weighting across multiple assets improves Sharpe. Supports weighted_multi approach.

10. **"Can Funding Rate Predict Price Change?"** - Presto Research
    - URL: https://www.prestolabs.io/research/can-funding-rate-predict-price-change
    - Key Finding: FR has "favorable performance metrics" when applied cross-sectionally across multiple assets.

---

## Change Log

**Version 1.0** - 2026-03-17
- Initial specification
- 6-symbol portfolio with 3 optimized + 3 default param sub-strategies
- weighted_multi allocation with maxPositions=3
- V3 BTC EMA200 regime filter with bearMode=block
- Comprehensive rationale and comparison framework

---

## Notes

1. **The V2 benchmark comparison is not perfectly apples-to-apples**: V2 Best 6 uses different symbols (includes DOGE, IMX, ICP which failed WF) and does not have the regime filter. A fairer comparison is V3 SS with the same 6 symbols vs V3 weighted_multi with the same 6 symbols.

2. **Optimized params were derived from V2 walk-forward, not V3**: The WF optimization was done on funding-rate-spike-v2. V3 adds the regime filter on top. The optimized params should still be valid since they affect signal generation (percentiles, ATR multipliers, hold periods) which is identical between V2 and V3. The regime filter only adds an additional entry gate.

3. **XLM's optimized params are the most aggressive departure from defaults**: longPercentile=10 (vs default 5) means XLM will generate 2x more long signals. Combined with atrTP=5 (vs default 3.5), XLM is configured for longer holds with larger profit targets. This matches XLM's slower mean-reversion characteristic.

4. **NEAR's atrTP=2.5 is BELOW default 3.5**: This is the only symbol where optimization found a tighter TP is better. NEAR reverts quickly but not deeply -- taking profits early improves win rate at the cost of per-trade profit.

5. **If this config underperforms, the logical next test is**: Same 6 symbols with `single_strongest` and optimized params (hybrid tiered without the allocation mode change). This isolates whether the underperformance comes from `weighted_multi` or from the symbol/param selection.
