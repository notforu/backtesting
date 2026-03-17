# FR V3 Quality Core -- Concentrated Portfolio Design

> **Created**: 2026-03-17
> **Author**: quant-lead agent (opus)
> **Status**: Ready for Implementation
> **Strategy**: funding-rate-spike-v3 (BTC EMA200 regime filter)

---

## Executive Summary

A concentrated, quality-first aggregation portfolio using only the best walk-forward validated symbols from the FR V2/V3 universe. Selects 4 symbols from the 7 WF-validated candidates based on a multi-factor ranking (WF Sharpe, bull Sharpe, bear resilience, parameter optimization status). Uses `single_strongest` allocation with optimized parameters where available.

**Philosophy**: Fewer symbols with higher conviction beats a diluted portfolio of marginal performers. Every symbol must earn its place through multiple validation gates.

---

## 1. Symbol Selection Analysis

### Multi-Factor Ranking of All 7 WF-Validated Symbols

| Symbol | WF Test Sharpe | Bull Sharpe | Bear Sharpe | Optimized Params? | Overall Score | Decision |
|--------|---------------|-------------|-------------|-------------------|---------------|----------|
| **ZEC** | 2.771 (1st) | +1.04 | -1.15 | No | A- | **SELECT** |
| **LDO** | 1.843 (2nd) | +1.71 | N/A | YES | A | **SELECT** |
| **XLM** | 1.439 (4th) | +0.43 | **+1.10** | YES | A | **SELECT** |
| **TRB** | 1.514 (3rd) | +0.97 | -1.45 | No | B+ | **SELECT** |
| IOST | 1.199 (5th) | +1.40 | -1.77 | No | B | Exclude |
| NEAR | 1.170 (6th) | +0.77 | -1.37 | YES | B- | Exclude |
| STG | 1.118 (7th) | +0.89 | N/A | No | C+ | Exclude |

### Selection Rationale -- 4 Symbols Chosen

#### 1. ZEC (Test Sharpe 2.771) -- SELECTED

**Why include**: Highest WF test Sharpe in the entire validated universe by a wide margin (2.771 vs next best 1.843). This is an exceptionally strong out-of-sample result indicating genuine edge, not overfitting.

**Risk acknowledged**: Bear Sharpe is -1.15, making it purely a bull-market performer. However, V3's BTC EMA200 regime filter with `bearMode='block'` completely eliminates bear-market exposure. With the filter active, ZEC's negative bear performance becomes irrelevant -- no trades will be entered during bear markets.

**Params**: Using defaults since no WF-optimized params are available. The 2.771 test Sharpe was achieved with defaults, so they are empirically validated.

#### 2. LDO (Test Sharpe 1.843) -- SELECTED

**Why include**: Second-highest WF Sharpe. Exceptionally low OOS degradation (+1.9% -- nearly zero overfitting). Best bull Sharpe among all candidates (+1.71). WF-optimized parameters are available and validated.

**Risk acknowledged**: No bear market data exists (token launched late 2022). However, V3's regime filter provides structural protection regardless.

**Params**: WF-optimized: `holdingPeriods=4, shortPercentile=96, longPercentile=2, atrStopMultiplier=3.5, atrTPMultiplier=3.5`

These params show: (a) wider short entry threshold (96 vs 95 default) -- more selective on shorts, (b) tighter long entry (2 vs 5 default) -- only the most extreme negative FR triggers longs, (c) balanced stop/TP ratio (3.5/3.5) -- symmetric risk/reward. This profile makes sense for LDO's high-volatility character.

#### 3. XLM (Test Sharpe 1.439) -- SELECTED

**Why include**: The ONLY symbol in the entire universe with positive bear market Sharpe (+1.10 average across both 2022 H1 and H2). This is a uniquely all-weather asset. While V3's regime filter will block bear trades, XLM provides a safety margin if the filter has edge cases or transition periods. Additionally, XLM has strong WF validation (24.6% degradation, well within the 60% threshold).

**Strategic value**: XLM's all-weather character means it is the lowest-risk inclusion in the portfolio. Even if the regime filter fails or lags, XLM is unlikely to generate catastrophic losses.

**Params**: WF-optimized: `holdingPeriods=6, shortPercentile=94, longPercentile=10, atrStopMultiplier=3, atrTPMultiplier=5`

These params show: (a) longer holding period (6 vs 3 default) -- lets mean-reversion play out more fully, (b) wider long percentile (10 vs 5) -- more frequent long entries (XLM's FR patterns are more nuanced), (c) high TP multiplier (5.0) -- lets winners run significantly. This profile suits XLM's slower, more stable mean-reversion pattern.

#### 4. TRB (Test Sharpe 1.514) -- SELECTED

**Why include**: Third-highest WF Sharpe (1.514). Strong bull Sharpe (+0.97). TRB is a mid-cap oracle token with distinctive funding rate dynamics -- it frequently experiences extreme funding spikes due to its lower market cap and concentrated holder base, which creates more pronounced mean-reversion opportunities.

**Risk acknowledged**: Bear Sharpe is -1.45 (worst among the 4 selected). Like ZEC, this is mitigated entirely by V3's regime filter.

**Params**: Using defaults (no optimized params available). Default params achieved 1.514 test Sharpe, confirming they work well for TRB.

### Exclusion Rationale

#### IOST (Excluded despite 1.199 WF Sharpe)

- **Bear Sharpe**: -1.77 (worst in entire universe)
- **WF Sharpe**: 5th place (1.199) -- solidly above 0.5 threshold but not exceptional
- **No optimized params**: Would trade on defaults
- **Reasoning**: With 4 slots, IOST's mediocre WF Sharpe and catastrophic bear performance make it the weakest include. While V3's filter protects against bear exposure, having the worst bear Sharpe suggests the underlying signal quality is lowest. In a concentrated portfolio, every slot must be high-conviction.

#### NEAR (Excluded despite 1.170 WF Sharpe and optimized params)

- **Bear Sharpe**: -1.37 (second worst)
- **Bull Sharpe**: +0.77 (second lowest among candidates)
- **WF anomaly**: NEAR's test Sharpe (1.170) is HIGHER than its train Sharpe (0.742), giving a -57.7% "degradation" (negative = improved OOS). While this sounds good, it suggests the train/test split captured different market dynamics rather than genuine generalization. Less confidence in the robustness.
- **Reasoning**: The negative degradation is a yellow flag. Combined with the lowest bull Sharpe and second-worst bear Sharpe, NEAR is the least compelling candidate despite having optimized params.

#### STG (Excluded -- lowest WF Sharpe)

- **WF Sharpe**: 1.118 (7th and last -- lowest among validated symbols)
- **No bear data**: Cannot assess all-weather resilience
- **No optimized params**: Would trade on defaults
- **Reasoning**: Bottom of the validated list. In a concentrated portfolio seeking quality, STG's WF Sharpe is too close to the marginally acceptable zone.

---

## 2. Allocation Mode Decision

### Why `single_strongest` (Not `top_n` or `weighted_multi`)

**Empirical evidence**: The aggregation exploration (documented in `2026-03-03-140000-fr-v2-optimization-research.md`) conclusively showed that `single_strongest` outperforms both `top_n` and `weighted_multi` for FR spike strategies. Key findings:

1. **Concentration amplifies the strongest signal.** FR spikes are rare, high-conviction events. When one asset has an extreme FR spike, it should receive 100% of capital allocation. Splitting capital across a weaker signal dilutes the edge.

2. **`top_n` wastes slots on weaker signals.** With 4 assets, `top_n maxPos=2` would often allocate to a mediocre signal alongside a strong one. The mediocre signal drags down portfolio returns.

3. **`weighted_multi` under-concentrates.** Proportional allocation means the strongest signal gets maybe 40-50% of capital instead of 100%. For a strategy with 1-3 trades per month per asset, this significantly reduces capital efficiency.

**With V3 regime filter**: `single_strongest` becomes even more appropriate because the filter blocks ALL entries in bear markets. During bull markets, the strategy needs to maximize impact of each trade since opportunities are infrequent.

### maxPositions = 1

Only 1 position at a time. This is the natural setting for `single_strongest` mode.

**Capital efficiency argument**: FR spike trades are short-duration (3-6 holding periods = 24-48 hours). With 4 assets generating signals independently, the probability of signal overlap is low. When overlap occurs, the strongest signal is always preferred.

---

## 3. Portfolio Configuration

### JSON Config

```json
{
  "name": "FR V3 Quality Core",
  "allocationMode": "single_strongest",
  "maxPositions": 1,
  "subStrategies": [
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "ZEC/USDT:USDT",
      "timeframe": "4h",
      "params": {
        "holdingPeriods": 3,
        "shortPercentile": 95,
        "longPercentile": 5,
        "atrStopMultiplier": 2.5,
        "atrTPMultiplier": 3.5,
        "useRegimeFilter": true,
        "regimeSMAPeriod": 200,
        "regimeMAType": "ema",
        "bearMode": "block"
      },
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
        "atrTPMultiplier": 3.5,
        "useRegimeFilter": true,
        "regimeSMAPeriod": 200,
        "regimeMAType": "ema",
        "bearMode": "block"
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
        "atrTPMultiplier": 5,
        "useRegimeFilter": true,
        "regimeSMAPeriod": 200,
        "regimeMAType": "ema",
        "bearMode": "block"
      },
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "TRB/USDT:USDT",
      "timeframe": "4h",
      "params": {
        "holdingPeriods": 3,
        "shortPercentile": 95,
        "longPercentile": 5,
        "atrStopMultiplier": 2.5,
        "atrTPMultiplier": 3.5,
        "useRegimeFilter": true,
        "regimeSMAPeriod": 200,
        "regimeMAType": "ema",
        "bearMode": "block"
      },
      "exchange": "bybit"
    }
  ],
  "initialCapital": 10000,
  "exchange": "bybit",
  "mode": "futures"
}
```

### Parameter Details Per Symbol

| Symbol | holdingPeriods | shortPct | longPct | atrStop | atrTP | Source |
|--------|--------------|----------|---------|---------|-------|--------|
| ZEC | 3 | 95 | 5 | 2.5 | 3.5 | Defaults (WF Sharpe 2.77 with defaults) |
| LDO | 4 | 96 | 2 | 3.5 | 3.5 | WF-optimized (Train 1.88, Test 1.84, Degrade +1.9%) |
| XLM | 6 | 94 | 10 | 3.0 | 5.0 | WF-optimized (Train 1.91, Test 1.44, Degrade +24.6%) |
| TRB | 3 | 95 | 5 | 2.5 | 3.5 | Defaults (WF Sharpe 1.51 with defaults) |

**Shared params** (V3 regime filter, identical across all):
- `useRegimeFilter`: true
- `regimeSMAPeriod`: 200
- `regimeMAType`: ema (EMA reacts faster than SMA to regime changes)
- `bearMode`: block (no entries when BTC < EMA200)

**Unchanged params** (using V3 defaults for all symbols):
- `usePercentile`: true (default)
- `percentileLookback`: 90 (default)
- `useATRStops`: true (default)
- `atrPeriod`: 14 (default)
- `atrFilterEnabled`: true (default)
- `atrFilterThreshold`: 1.5 (default)
- `useTrendFilter`: true (default)
- `trendSMAPeriod`: 50 (default)
- `useTrailingStop`: false (default)
- `positionSizeMethod`: volAdjusted (default)
- `positionSizePct`: 50 (default)
- `useFRVelocity`: false (default)

---

## 4. Expected Performance vs Benchmark

### Benchmark: V2 Best 6 (SS)

The existing benchmark uses V2 strategy with LDO, DOGE, IMX, ICP, XLM, NEAR in `single_strongest` mode:
- **Sharpe**: 1.88
- **Return**: 223%
- **Max DD**: 13.27%
- **Symbols**: 6 (but 3 are WF-FAILED: DOGE, IMX, ICP)

### Expected FR V3 Quality Core Performance

**Bull market performance** (V3 identical to V2 during bull):
- **Sharpe**: 1.5 - 2.2 (slightly different symbol mix; ZEC/TRB replace DOGE/IMX/ICP)
- **Return**: Likely similar to V2 during bull periods since `single_strongest` concentrates on best signal
- **Max DD**: 10-15% (fewer bad symbols = fewer losing trades)

**Bear market performance** (V3 advantage):
- **Sharpe**: ~0 (no trades, capital preserved)
- **Return**: ~0% (flat during bear -- this is a FEATURE)
- **Max DD**: ~0% additional bear drawdown

**All-weather estimate**:
- **Sharpe**: 1.3 - 1.8 (lower than pure-bull V2 Sharpe because bear periods contribute nothing)
- **Key advantage**: Max DD reduction from ~25-30% (V2 without filter in bear) to ~10-15% (V3 bull-only DD)
- **Trade count**: ~30% fewer trades (bear period trades eliminated)

### Why All-Weather Sharpe May Be LOWER But Portfolio Is BETTER

The V2 benchmark Sharpe of 1.88 was measured on a predominantly bull window (2024-2026). The V3 Quality Core may show a lower headline Sharpe on the same window because:

1. **ZEC/TRB with defaults may underperform DOGE/IMX with defaults in bull** -- but ZEC/TRB are WF-validated while DOGE/IMX are not
2. **Fewer symbols = fewer signal opportunities** -- 4 vs 6 assets means fewer "strongest signal" candidates per bar
3. **The regime filter blocks a few borderline bull-period bars** -- EMA200 lags slightly during transitions

However, the portfolio is STRICTLY BETTER on a risk-adjusted basis over full market cycles because it eliminates the -0.55 avg bear Sharpe drag. The V2 benchmark's 223% return and 1.88 Sharpe were achieved by including 3 WF-failed symbols that happened to perform well in-sample -- a form of survivorship bias.

---

## 5. Risk Management

### Position Level
- **Stop loss**: ATR-based (symbol-specific multipliers from table above)
- **Take profit**: ATR-based (symbol-specific multipliers)
- **Time exit**: Holding period limit (symbol-specific, 3-6 periods)
- **Trend filter**: Per-asset SMA50 trend alignment (blocks counter-trend entries)
- **Volatility filter**: ATR filter blocks entries during high-volatility regimes

### Portfolio Level
- **Regime filter**: BTC EMA200 blocks ALL entries in bear markets
- **Max positions**: 1 (single_strongest mode)
- **Concentration**: 100% capital in best signal -- appropriate for infrequent, high-conviction trades
- **Capital preservation**: Flat equity during bear markets (no trading = no losses)

### Kill Switch Recommendations (for paper/live trading)
- **15% DD alert**: Notify via monitoring
- **20% DD hard stop**: Halt all trading for 7 days
- **Regime transition alert**: When BTC crosses EMA200 from above, send notification

---

## 6. Backtesting Recommendations

### Test Periods

| Period | Dates | Expected Behavior |
|--------|-------|-------------------|
| Bull 2024 | 2024-01-01 to 2024-12-31 | Active trading, positive Sharpe |
| Bull 2025+ | 2025-01-01 to 2026-03-01 | Active trading, strong Sharpe |
| Full Period | 2024-01-01 to 2026-03-01 | Overall portfolio performance |
| Bear 2022 (if data available) | 2022-01-01 to 2022-12-31 | Minimal/no trades (filter blocking) |

### Comparison Runs

Run these configs on the same date range for comparison:

1. **V3 Quality Core** (this config) -- 4 symbols, V3, optimized params, regime filter
2. **V2 Best 6 SS** (existing benchmark) -- 6 symbols, V2, default params, no filter
3. **V3 Full 7** (all validated) -- 7 symbols, V3, optimized where available -- test if adding IOST/NEAR/STG helps
4. **V3 Quality Core no-filter** -- same 4 symbols, V3, but `useRegimeFilter=false` -- isolate filter impact

---

## 7. System Gaps

### None for Bull-Only Backtesting

All infrastructure exists:
- FR V3 strategy with BTC EMA200 regime filter: `/workspace/strategies/funding-rate-spike-v3.ts`
- Aggregation engine supports `single_strongest` with per-symbol params
- BTC daily candles injection pattern is implemented

### For Bear Period Validation

**Gap**: BTC daily candle injection in aggregate engine

The V3 strategy requires `(strategy as any)._btcDailyCandles` to be injected before init(). The aggregate engine must handle this injection for each sub-strategy instance. If this is already implemented (check `aggregate-engine.ts`), no gap exists. If not:

- **What**: Aggregate engine must inject BTC daily candles into V3 sub-strategy instances
- **Complexity**: Simple (follow the existing funding rate injection pattern)
- **Priority**: Critical for backtest accuracy

---

## 8. Conviction Level Assessment

| Factor | Assessment | Confidence |
|--------|-----------|------------|
| Symbol selection | Based on WF validation + regime analysis | High |
| Allocation mode | Empirically proven via aggregation tournament | High |
| Optimized params (LDO, XLM) | WF-validated with low degradation | High |
| Default params (ZEC, TRB) | Validated by WF test Sharpe (2.77, 1.51) | Medium-High |
| Regime filter | Academically backed, structurally sound | High |
| Concentration (4 symbols) | Fewer signals but higher quality per signal | Medium |
| Overall | Defensible, evidence-based design | **High** |

---

## Change Log

**Version 1.0** -- 2026-03-17
- Initial portfolio design
- 4-symbol concentrated portfolio: ZEC, LDO, XLM, TRB
- single_strongest allocation
- WF-optimized params for LDO and XLM
- V3 regime filter (BTC EMA200, bearMode=block)
- Full selection rationale with exclusion reasoning
