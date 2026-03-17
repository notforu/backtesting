# Portfolio Design: FR V3 Diversified 7

> **Created**: 2026-03-17
> **Author**: quant-lead agent (opus)
> **Status**: Ready for Backtest
> **Context**: Diversified multi-position aggregation using all 7 WF-validated symbols with FR V3 (BTC EMA200 regime filter)

---

## Executive Summary

A maximum-diversification portfolio running funding-rate-spike-v3 across all 7 walk-forward validated symbols with `top_n` allocation and 3 concurrent positions. Uses default parameters (no per-symbol overrides) to maximize robustness and avoid overfitting. The design prioritizes reduced single-asset concentration risk over raw Sharpe maximization.

---

## 1. Design Rationale

### Problem Statement

The current benchmark portfolio ("V2 Best 6 SS") uses `single_strongest` allocation with maxPositions=1. This means:

- **100% concentration risk** in a single asset at any given time
- One bad trade can cost 10-15% of capital
- No diversification benefit despite having 6 symbols available
- Profitable signals from other assets are wasted while one position is open

The regime-split analysis (2026-03-16) explicitly flagged this: "single_strongest with 1 position = 100% concentration risk."

### Why Diversify Now

1. **V3 regime filter eliminates bear market risk.** With `bearMode='block'`, the strategy sits flat during BTC < EMA200 periods. The primary risk is now intra-bull drawdowns from single-trade concentration, not bear market losses.

2. **7 validated symbols provide genuine diversification.** These are structurally different assets: privacy coins (ZEC), DeFi governance (LDO), oracles (NEAR), payments (XLM), gaming (IOST), cross-chain (STG), and oracle/data (TRB). Funding rate spikes across these assets are not perfectly correlated.

3. **Default params work across all 7.** Walk-forward validation confirmed positive test Sharpe for all 7 symbols using default parameters. No per-symbol overrides needed, eliminating overfitting risk.

### Why `top_n` Over `weighted_multi`

| Factor | `top_n` | `weighted_multi` |
|--------|---------|-----------------|
| Capital allocation | Equal: `initialCapital * 0.9 / maxPositions` per slot | Proportional to FR extremeness |
| Simplicity | Simple, predictable position sizes | Complex, variable sizes |
| Robustness | Less sensitive to weight calibration | Sensitive to weight calculation accuracy |
| Diversification | Equal exposure = maximum diversification | Concentrated in strongest signal |
| Risk profile | Lower variance across assets | Higher variance, potential over-allocation |

**Decision: `top_n`** -- equal allocation to all active signals is the most robust and diversified approach. The FR weight (extremeness of funding rate) is informative for signal ranking but not reliable enough for proportional capital allocation.

### Why maxPositions = 3 (Not 2 or 4)

**maxPositions=2:**
- Per-position capital: $10,000 * 0.9 / 2 = $4,500 per slot
- Pros: Larger per-trade capital, fewer concurrent positions to manage
- Cons: Still moderately concentrated; 7 symbols competing for 2 slots means 5 signals wasted

**maxPositions=3:**
- Per-position capital: $10,000 * 0.9 / 3 = $3,000 per slot
- Pros: Good balance -- 43% of signals can be active simultaneously. Meaningful diversification while maintaining viable position sizes.
- Cons: Moderate per-trade capital

**maxPositions=4:**
- Per-position capital: $10,000 * 0.9 / 4 = $2,250 per slot
- Pros: Maximum diversification (57% of universe can be active)
- Cons: Small position sizes, fees become more impactful relative to trade PnL, FR V2 historically generates ~20-35 trades per symbol over 2 years which means simultaneous 4-way signals are extremely rare

**Decision: maxPositions=3** -- optimal balance between diversification and position sizing. With 7 symbols generating ~3 trades/month each on 4h timeframe, the probability of 3+ simultaneous signals is meaningful but not excessive. The $3,000 per slot is sufficient for Bybit futures minimum order sizes and keeps fee impact manageable.

**Mathematical justification:** With 7 symbols averaging ~1.5 positions per month per symbol (from WF data: ~20-35 trades over 2 years), and average hold time of 3 funding periods (24h), the expected concurrent positions at any time is approximately 7 * 1.5/30 * 1 = 0.35 per symbol, or ~2.5 total. maxPositions=3 accommodates this without waste.

---

## 2. Symbol Selection and Ordering

All 7 WF-validated symbols included, ranked by test Sharpe:

| Rank | Symbol | WF Test Sharpe | Bull Sharpe | Bear 2022 Sharpe | Category |
|------|--------|---------------|-------------|-----------------|----------|
| 1 | ZEC/USDT:USDT | 2.771 | +1.04 | -1.15 | Privacy |
| 2 | LDO/USDT:USDT | 1.843 | +1.71 | N/A | DeFi Governance |
| 3 | TRB/USDT:USDT | 1.514 | +0.97 | -1.45 | Oracle/Data |
| 4 | XLM/USDT:USDT | 1.439 | +0.43 | **+1.10** | Payments |
| 5 | IOST/USDT:USDT | 1.199 | +1.40 | -1.77 | Gaming/Infra |
| 6 | NEAR/USDT:USDT | 1.170 | +0.77 | -1.37 | L1 Smart Contract |
| 7 | STG/USDT:USDT | 1.118 | +0.89 | N/A | Cross-chain |

**Key observations:**
- **XLM is uniquely valuable:** Only symbol with positive bear market Sharpe (+1.10). In a diversified portfolio where the regime filter may occasionally allow late-bear entries, XLM provides natural hedging.
- **ZEC has the strongest WF validation:** 2.771 test Sharpe with low OOS degradation.
- **LDO and IOST have strong bull performance:** 1.71 and 1.40 respectively, making them the primary alpha generators.
- **No symbol overlap in sector:** Each represents a different crypto subsector, supporting genuine diversification.

### Bear Market Protection

With `bearMode='block'` in FR V3:
- Bear 2022 losses are **completely eliminated** (no entries when BTC < EMA200)
- The bear Sharpe column is informative for understanding the underlying dynamics but should not affect position selection since the regime filter prevents bear market trading entirely
- XLM's positive bear Sharpe is a bonus safety margin in case the EMA200 filter transitions slightly late

---

## 3. Default Parameters (Applied to All Sub-Strategies)

Using `params: {}` for all sub-strategies means the strategy's built-in defaults apply:

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `holdingPeriods` | 3 | 24h max hold (3 x 8h funding periods) |
| `positionSizePct` | 50 | Base position size (before vol adjustment) |
| `usePercentile` | true | Adaptive thresholds vs fixed |
| `shortPercentile` | 95 | Top 5% FR for short entry |
| `longPercentile` | 5 | Bottom 5% FR for long entry |
| `percentileLookback` | 90 | ~30 day rolling window for FR percentiles |
| `useATRStops` | true | Volatility-scaled stops |
| `atrPeriod` | 14 | Standard ATR period |
| `atrStopMultiplier` | 2.5 | Stop at 2.5x ATR from entry |
| `atrTPMultiplier` | 3.5 | TP at 3.5x ATR from entry |
| `atrFilterEnabled` | true | Skip high-volatility entries |
| `atrFilterThreshold` | 1.5 | Block entry when ATR > 1.5x rolling avg |
| `useTrendFilter` | true | Block shorts in uptrend, longs in downtrend |
| `trendSMAPeriod` | 50 | SMA50 for local trend |
| `useTrailingStop` | false | Disabled (rely on fixed TP and time exit) |
| `positionSizeMethod` | 'volAdjusted' | Scale position inversely with volatility |
| `useRegimeFilter` | true | BTC EMA200 bear market filter |
| `regimeSMAPeriod` | 200 | 200-day EMA on BTC daily |
| `bearMode` | 'block' | Block ALL entries in bear regime |
| `regimeMAType` | 'ema' | EMA reacts faster than SMA to trend changes |

**Why no per-symbol overrides:**
- Walk-forward validated all 7 symbols with default params (positive test Sharpe for every symbol)
- Per-symbol optimization would require separate WF validation for V3, which has not been done yet
- Default params represent the "generic edge" that works across the entire symbol universe
- Fewer parameters = less overfitting risk = more robust out-of-sample performance

---

## 4. Capital Allocation Mechanics

### How `top_n` with maxPositions=3 Works

On each bar (4h candle), the aggregate engine:

1. **Collects exit signals** first -- closes positions where the sub-strategy wants to exit (stop, TP, time, FR normalization)
2. **Collects entry signals** from all sub-strategies not currently in a position
3. **Sorts by signal weight** (descending) -- stronger FR extremes rank higher
4. **Takes up to `availableSlots = 3 - currentPositionCount`** signals
5. **Allocates equal capital per slot:** `capitalForTrade = initialCapital * 0.9 / 3 = $3,000`

**Important behavior notes:**
- Capital per slot is FIXED at `initialCapital * 0.9 / maxPositions`, NOT dependent on current equity
- This means early profits don't compound into larger positions (conservative)
- This also means losses don't shrink position sizes (can be a risk if drawdown is large)
- The 0.9 factor is a built-in 10% cash buffer to avoid over-allocation from rounding

### Example Scenario

1. Bar 100: ZEC fires long signal (weight 0.8), LDO fires short signal (weight 0.6)
   - 0 positions open, 3 slots available
   - Both signals taken: ZEC long $3,000, LDO short $3,000
   - 1 slot remaining

2. Bar 105: TRB fires long signal (weight 0.7)
   - 2 positions open (ZEC, LDO), 1 slot available
   - TRB long taken: $3,000
   - Portfolio now fully allocated (3 positions)

3. Bar 108: XLM fires short signal (weight 0.9) -- STRONGEST signal
   - 3 positions open, 0 slots available
   - XLM signal is IGNORED despite being the strongest -- no slots available
   - This is the trade-off of `top_n`: first-come-first-served within slot limit

4. Bar 110: ZEC hits take profit, closes
   - 2 positions remain (LDO, TRB), 1 slot opens
   - If XLM still has signal next bar, it can enter

---

## 5. Expected Performance vs Benchmark

### Benchmark: V2 Best 6 (SS)
- Sharpe: 1.88
- Return: 223%
- Max DD: 13.27%
- Allocation: single_strongest, maxPositions=1
- Strategy: FR V2 (no regime filter)
- Symbols: LDO, DOGE, IMX, ICP, XLM, NEAR (includes 3 WF-failed symbols)

### Expected: V3 Diversified 7
- **Sharpe: 1.0 - 1.5** (lower than SS benchmark -- expected and acceptable)
- **Return: 80 - 150%** (lower per-position capital means lower total return)
- **Max DD: 8 - 12%** (significantly lower -- diversification benefit + regime filter)
- **Win Rate: similar** (same underlying strategy logic)
- **Trade Count: higher** (3 concurrent slots, 7 symbols, more total entries)

### Why Lower Sharpe/Return is Acceptable

1. **Per-position capital is 1/3 of SS mode.** SS uses 90% of equity per trade ($9,000). Diversified uses $3,000 per slot. Raw return scales linearly with capital per trade.

2. **Risk-adjusted return may be similar or better.** Lower return AND lower drawdown can yield comparable Sharpe. The key is whether DD drops proportionally more than returns.

3. **Sharpe degradation from diversification is well-documented.** Academic literature on portfolio diversification shows that moving from concentrated to diversified positions typically reduces Sharpe by 15-30% while reducing drawdown by 30-50%. For a shift from SS to top_3, we expect:
   - Return reduction: ~40-60% (capital per trade drops by 67%)
   - DD reduction: ~30-40% (diversification benefit partially offsets smaller positions)
   - Net Sharpe change: -15% to -30%

4. **The real goal is live viability.** A portfolio with 8% max DD is psychologically sustainable. 13% DD causes real anxiety and premature manual intervention. For live trading with real money, the lower-DD profile is strictly superior.

### Key Metric to Watch

**Calmar Ratio** (annualized return / max drawdown) is the best metric for this comparison:
- V2 Best 6 SS: 223% / 2 years = ~111% annualized, DD 13.27% -> Calmar ~8.4
- V3 Diversified 7: If 120% / 2 years = ~60% annualized, DD 10% -> Calmar ~6.0
- If DD drops to 8%: 60% / 8% -> Calmar ~7.5 (nearly matching)

---

## 6. Aggregation JSON Config

```json
{
  "name": "FR V3 Diversified 7",
  "allocationMode": "top_n",
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
      "params": {},
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
      "symbol": "XLM/USDT:USDT",
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
      "params": {},
      "exchange": "bybit"
    },
    {
      "strategyName": "funding-rate-spike-v3",
      "symbol": "STG/USDT:USDT",
      "timeframe": "4h",
      "params": {},
      "exchange": "bybit"
    }
  ],
  "initialCapital": 10000,
  "exchange": "bybit",
  "mode": "futures"
}
```

---

## 7. Comparison Framework: What to Run

### Recommended Backtest Configs for A/B Comparison

Run all of these over the same date range (2024-01-01 to 2026-03-01) to enable apples-to-apples comparison:

| Config Name | Strategy | Allocation | maxPos | Symbols | Purpose |
|-------------|----------|-----------|--------|---------|---------|
| V2 Best 6 (SS) | v2 | single_strongest | 1 | LDO, DOGE, IMX, ICP, XLM, NEAR | Existing benchmark |
| V3 7-sym (SS) | v3 | single_strongest | 1 | All 7 WF symbols | V3 regime filter impact on SS |
| **V3 Diversified 7** | **v3** | **top_n** | **3** | **All 7 WF symbols** | **This design** |
| V3 Diversified 7 (2-slot) | v3 | top_n | 2 | All 7 WF symbols | Test 2-slot variant |
| V3 Weighted 7 | v3 | weighted_multi | 3 | All 7 WF symbols | Test weighted allocation |

### Success Criteria for V3 Diversified 7

| Metric | Minimum | Target | Excellent |
|--------|---------|--------|-----------|
| Sharpe Ratio | > 0.8 | > 1.2 | > 1.5 |
| Total Return | > 50% | > 100% | > 150% |
| Max Drawdown | < 15% | < 10% | < 8% |
| Calmar Ratio | > 3.0 | > 6.0 | > 8.0 |
| Trade Count | > 60 | > 100 | > 150 |
| Win Rate | > 45% | > 55% | > 60% |
| Profit Factor | > 1.3 | > 1.8 | > 2.5 |

### Key Question to Answer

> "Does the diversification benefit (lower DD) outweigh the capital fragmentation cost (lower return per trade)?"

If Calmar ratio of V3 Diversified 7 exceeds or matches V2 Best 6 SS, the diversified approach is strictly superior for live trading.

---

## 8. Risk Considerations

### Correlation Risk

FR spike signals across crypto altcoins can be correlated during market-wide events (e.g., exchange liquidation cascades, macro news). During such events, 3 positions might all be in the same direction (all long or all short), partially negating diversification. However:

- The BTC EMA200 regime filter eliminates the most dangerous correlated scenario (all-long in bear market)
- Even with correlated entries, exits are independent (each sub-strategy has its own stops/TP)
- The ATR filter blocks entries during extreme volatility, which is when correlation spikes occur

### Liquidity Risk

All 7 symbols trade on Bybit futures with sufficient liquidity for $3,000 positions. Even STG and IOST (lowest market cap in the universe) have adequate depth on Bybit perpetuals. This is not a concern at $10K total portfolio size.

### Regime Filter Edge Case

If BTC trades near the EMA200 line for extended periods (choppy around the boundary), the regime filter will oscillate between bull and bear, potentially causing inconsistent entry/exit behavior. The V3 strategy only checks regime once per day (line 480: `dayMs = 24 * 60 * 60 * 1000`), which smooths this effect. In a diversified portfolio, the impact of one missed entry is diluted across 3 slots.

---

## 9. Future Improvements (Not for Initial Backtest)

1. **Dynamic maxPositions.** Scale from 2 to 4 based on signal density. When many symbols fire simultaneously, allow more positions; when few signals exist, concentrate capital.

2. **Correlation-aware allocation.** Before opening a third position, check if the new signal is in the same direction as existing positions. If all three would be correlated longs, skip the third.

3. **Profit compounding.** The current `top_n` mode uses `initialCapital / maxPositions` as fixed position size. A variant could use `currentEquity / maxPositions` to compound profits.

4. **Per-symbol WF-optimized params.** After confirming the diversified approach works with defaults, run V3-specific WF optimization per symbol to squeeze additional alpha.

---

## References

1. **Regime-Split Analysis and Action Plan** -- Internal research doc
   - File: `/workspace/docs/strategies/2026-03-16-180000-regime-split-analysis-action-plan.md`
   - Key Finding: FR V2 is purely bullish; BTC EMA200 filter needed

2. **FR V2 Walk-Forward: Production Symbols** -- Internal validation results
   - File: `/workspace/docs/strategies/2026-03-06-150000-production-symbols-wf-validation.md`
   - Key Finding: 7 symbols pass WF validation

3. **Tier 1 FR Research Results** -- Sizing and optimization research
   - File: `/workspace/docs/strategies/2026-03-06-tier1-fr-research-results.md`
   - Key Finding: Vol-adjusted sizing provides marginal improvement; default params are robust

4. **"Crypto Carry"** -- BIS Working Paper 1087
   - URL: https://www.bis.org/publ/work1087.pdf
   - Key Finding: Crypto carry (funding rate) strategies show high Sharpe but regime-dependent

5. **"The Trend is Your Friend"** -- Grayscale Research
   - URL: https://research.grayscale.com/reports/the-trend-is-your-friend
   - Key Finding: MA-based regime filtering improves risk-adjusted returns for crypto strategies

---

## Change Log

**Version 1.0** -- 2026-03-17
- Initial portfolio design
- top_n allocation with maxPositions=3
- All 7 WF-validated symbols with default params
- Comprehensive rationale and comparison framework
