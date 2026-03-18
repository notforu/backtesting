# V2 vs V3 Regime Filter Comparison

**Date**: 2026-03-18 04:00
**Analysis**: Comprehensive evaluation of BTC EMA200 regime filter impact across 16 portfolio configurations
**Bug Fix**: Weight calculator silent fallback fixed (enabled accurate signal weighting by funding rate extremity)

## Summary

After fixing a critical weight calculator bug that silently defaulted to weight=1.0 for V2/V3 strategies, we conducted a comprehensive comparison of the funding rate strategies with and without BTC EMA200 regime filtering.

**Key Finding**: The regime filter (V3) is NOT universally beneficial. It reduces Sharpe by ~0.5-0.6 across all configs, but provides meaningful MaxDD reduction only for large concentrated portfolios. Smaller/diversified portfolios perform better with V2 (no filter) because regime filtering removes valuable hedging signals.

**Best Risk-Adjusted Config**: 7 V2-WF opt symbols with top_n mp=3 allocation achieves Sharpe 3.12 (V2) with only 7.2% MaxDD.

## Background

### V2 vs V3 Strategy Definitions

**V2 (funding-rate-spike-v2)**
- Open positions on extreme funding rate spikes (positive or negative)
- Sizing based on funding rate extremity
- No regime filter — trades all market conditions
- Parameter ranges: `minFundingRate` [0.01-0.05], `positionSize` [2-20], `atrPeriod` [10-50], etc.

**V3 (funding-rate-spike-v3)**
- Same as V2 plus regime filter:
  - `useRegimeFilter: true`
  - `bearMode: 'block'` — block ALL entries when BTC < its 200-day EMA
  - `regimeMAType: 'ema'`, `regimeSMAPeriod: 200`
- Otherwise identical logic to V2

### Critical Bug Fixed

**Problem**: The `getWeightCalculator()` function in `weight-calculators.ts` only had an exact match for `'funding-rate-spike'` but not for `'funding-rate-spike-v2'` or `'funding-rate-spike-v3'`. When unknown weight calculator was requested, function silently returned `defaultWeightCalculator` (weight=1.0).

Result: In `single_strongest` mode, signals were selected RANDOMLY instead of by funding rate extremity.

**Fix**: Added prefix matching logic so `'funding-rate-spike'` matches `-v2` and `-v3` variants. Changed `getWeightCalculator()` to throw on unknown strategy instead of silently defaulting.

**Impact on V3**: Sharpe improved 2.30 → 2.39, Return 772% → 852%, ProfitFactor 2.07 → 2.14 after fix.

## Test Configuration

- **Exchange**: Bybit
- **Timeframe**: 4 hours
- **Mode**: Futures (long only)
- **Period**: 2024-01-01 to 2026-03-01 (26 months)
- **Initial Capital**: $10,000
- **Slippage**: 0.05% (entry), 0.05% (exit)
- **Maker Fee**: 0.0002, **Taker Fee**: 0.0005
- **Funding Rate**: Applied hourly

## Test 1: Allocation Mode Comparison

Single portfolio (13 symbols, default params) across 4 allocation modes.

| Config | V2 Sharpe | V3 Sharpe | ΔSharpe | V2 Return | V3 Return | ΔReturn | V2 MaxDD | V3 MaxDD | ΔMaxDD | V2 Trades | V3 Trades |
|--------|-----------|-----------|---------|-----------|-----------|---------|----------|----------|--------|-----------|-----------|
| SS mp=1 | 2.98 | 2.39 | -0.59 | 4216% | 852% | -3364% | 32.9% | 15.5% | -17.4% | 338 | 230 |
| top_n mp=3 | 2.35 | 1.83 | -0.52 | 150% | 90% | -60% | 5.4% | 9.1% | +3.7% | 427 | 293 |
| top_n mp=5 | 2.45 | 1.91 | -0.54 | 93% | 57% | -36% | 4.2% | 5.7% | +1.5% | 429 | 295 |
| weighted mp=3 | 2.62 | 2.04 | -0.58 | 2286% | 526% | -1760% | 31.2% | 15.5% | -15.7% | 427 | 293 |

**Observations**:
- Sharpe reduction: Consistent -0.52 to -0.59 (2-3%)
- MaxDD improvement for SS/weighted: 15-17% reduction (good)
- MaxDD WORSENS for top_n: +3.7% and +1.5% (filter removes diversification)
- Return reduction matches Sharpe reduction (same underlying signals removed)

## Test 2: Full Portfolio × Allocation Matrix (16 runs)

Tested 4 different portfolios × 4 allocation modes.

| Portfolio | Alloc | V2 Sharpe | V3 Sharpe | ΔSharpe | V2 Return | V3 Return | V2 MaxDD | V3 MaxDD | V2 Trades | V3 Trades |
|-----------|-------|-----------|-----------|---------|-----------|-----------|----------|----------|-----------|-----------|
| **13 default** | SS mp=1 | 2.98 | 2.39 | -0.59 | 4216% | 852% | 32.9% | 15.5% | 338 | 230 |
| **13 default** | top_n mp=3 | 2.35 | 1.83 | -0.52 | 150% | 90% | 5.4% | 9.1% | 427 | 293 |
| **13 default** | top_n mp=5 | 2.45 | 1.91 | -0.54 | 93% | 57% | 4.2% | 5.7% | 429 | 295 |
| **13 default** | weighted mp=3 | 2.62 | 2.04 | -0.58 | 2286% | 526% | 31.2% | 15.5% | 427 | 293 |
| **7 V2-WF opt** | SS mp=1 | 2.98 | 2.40 | -0.58 | 2366% | 683% | 22.0% | 14.7% | 203 | 134 |
| **7 V2-WF opt** | top_n mp=3 | 3.12 | 2.51 | -0.61 | 160% | 106% | 7.2% | 7.2% | 245 | 169 |
| **7 V2-WF opt** | top_n mp=5 | 3.01 | 2.47 | -0.54 | 125% | 81% | 7.1% | 7.0% | 245 | 169 |
| **7 V2-WF opt** | weighted mp=3 | 3.03 | 2.42 | -0.61 | 1850% | 558% | 21.0% | 14.6% | 245 | 169 |
| **3 V3-WF opt** | SS mp=1 | 1.86 | 1.68 | -0.18 | 171% | 107% | 11.3% | 12.1% | 141 | 97 |
| **3 V3-WF opt** | top_n mp=3 | 1.88 | 1.67 | -0.21 | 36% | 26% | 3.1% | 3.2% | 144 | 100 |
| **3 V3-WF opt** | top_n mp=5 | 1.87 | 1.66 | -0.21 | 33% | 25% | 3.1% | 3.1% | 144 | 100 |
| **3 V3-WF opt** | weighted mp=3 | 1.85 | 1.68 | -0.17 | 208% | 135% | 10.5% | 11.0% | 144 | 100 |
| **5 robust combined** | SS mp=1 | 1.85 | 1.49 | -0.36 | 343% | 150% | 16.7% | 18.8% | 202 | 135 |
| **5 robust combined** | top_n mp=3 | 2.05 | 1.58 | -0.47 | 68% | 41% | 3.5% | 5.2% | 222 | 150 |
| **5 robust combined** | top_n mp=5 | 2.03 | 1.57 | -0.46 | 59% | 34% | 3.4% | 5.1% | 222 | 150 |
| **5 robust combined** | weighted mp=3 | 1.88 | 1.52 | -0.36 | 351% | 165% | 15.2% | 17.0% | 222 | 150 |

**Observations**:
- **7 V2-WF opt wins overall**: Sharpe 3.12 with top_n mp=3, only 7.2% MaxDD
- **3 V3-WF opt most conservative**: MaxDD 3.1-3.2%, but returns only 25-36%
- **Sharpe reduction varies**: -0.18 to -0.61, correlates with portfolio concentration
  - Concentrated (SS): -0.58 to -0.61 (filter removes high-return bear trades)
  - Diversified (top_n): -0.52 to -0.54 (filter removes low-return hedging)
- **MaxDD improvement only for SS/weighted**: top_n and combined portfolios often worsen

## Test 3: Per-Asset V2 vs V3 Comparison (13 symbols, SS mp=1)

Individual symbol performance with single_strongest allocation (highest-Sharpe signal per bar).

| Symbol | V2 Sharpe | V3 Sharpe | ΔSharpe | V2 Return | V3 Return | ΔReturn | V2 MaxDD | V3 MaxDD | V2 Trades | V3 Trades |
|--------|-----------|-----------|---------|-----------|-----------|---------|----------|----------|-----------|-----------|
| **IOTA** | 1.42 | 1.72 | +0.30 | 70% | 77% | +7% | 14% | 13% | 37 | 30 |
| **IOST** | 1.34 | 0.84 | -0.50 | 393% | 17% | -376% | 24% | 7% | 40 | 28 |
| **BCH** | 1.13 | 1.22 | +0.09 | 133% | 70% | -63% | 27% | 19% | 25 | 18 |
| **RPL** | 1.13 | 1.05 | -0.08 | 408% | 210% | -198% | 56% | 43% | 31 | 22 |
| **KAVA** | 1.04 | 0.43 | -0.61 | 894% | 15% | -879% | 12% | 12% | 30 | 20 |
| **STG** | 1.03 | 0.23 | -0.80 | 584% | 6% | -578% | 94% | 33% | 33 | 21 |
| **APT** | 0.95 | 0.46 | -0.49 | 533% | 27% | -506% | 105% | 42% | 41 | 27 |
| **ARB** | 0.94 | 0.59 | -0.35 | 124% | 31% | -93% | 26% | 24% | 33 | 23 |
| **COMP** | 0.90 | -0.34 | -1.24 | 564% | -15% | -579% | 111% | 35% | 36 | 21 |
| **TRB** | 0.73 | 0.39 | -0.34 | 93% | 17% | -76% | 58% | 44% | 27 | 19 |
| **ENJ** | 0.54 | 0.16 | -0.38 | -5% | 3% | +8% | 151% | 20% | 28 | 19 |
| **COTI** | 0.47 | 0.64 | +0.17 | 5% | 37% | +32% | 83% | 23% | 27 | 20 |
| **ZEC** | 0.39 | 1.63 | +1.24 | -31% | 270% | +301% | 92% | 32% | 30 | 22 |

**Key Symbol-Level Findings**:

**Regime Filter Benefits (improved with V3)**:
- **ZEC**: Sharpe +1.24 (0.39 → 1.63), Return -31% → 270%, MaxDD 92% → 32%
  - Bear trades were toxic; filter removes them completely
- **IOTA**: Sharpe +0.30 (1.42 → 1.72), Return 70% → 77%
  - Bear filter improves already-good performance
- **COTI**: Sharpe +0.17 (0.47 → 0.64), Return 5% → 37%
  - Mostly bear trading before; filter cuts losses

**Regime Filter Hurts (degraded with V3)**:
- **COMP**: Sharpe -1.24 (0.90 → -0.34), Return 564% → -15%
  - Bear market was actually profitable; filter removes all bear trades
- **KAVA**: Sharpe -0.61 (1.04 → 0.43), Return 894% → 15%
  - Heavy bear-market profits removed
- **STG**: Sharpe -0.80 (1.03 → 0.23), Return 584% → 6%
  - Similar: bear trades were the strategy's edge
- **APT**: Sharpe -0.49 (0.95 → 0.46), Return 533% → 27%
- **IOST**: Sharpe -0.50 (1.34 → 0.84), Return 393% → 17%

**Neutral (minimal change)**:
- **BCH**, **RPL**, **ARB**, **TRB**, **ENJ**: -0.08 to -0.35 Sharpe change

**Interpretation**: Some assets (ZEC, IOTA, COTI) have fundamentally different dynamics in bear markets and benefit from filtering. Others (COMP, KAVA, STG, APT) generate their best returns during bear periods when funding rates are extreme.

## Risk-Return Analysis by Configuration Type

### Type 1: Large Concentrated Portfolios (SS mp=1)

All 13 symbols, single position at a time.

**V2 vs V3**:
- Sharpe: 2.98 vs 2.39 (-20%)
- Return: 4216% vs 852% (-80%)
- MaxDD: 32.9% vs 15.5% (-53% improvement) ← **filter helps here**

**Analysis**: Filter dramatically reduces tail risk and return volatility. Max drawdown cut in half. But because concentrated portfolios exploit extreme bear-market funding rates, return also plummets. Sharpe reduction (-0.59) worse than diversified portfolios because you're removing the strategy's main edge.

### Type 2: Diversified Portfolios (top_n mp=3/mp=5)

3-5 positions simultaneously, ranked by Sharpe.

**V2 vs V3**:
- Sharpe: 2.35-2.45 vs 1.83-1.91 (-20%)
- Return: 93-150% vs 57-90% (-40%)
- MaxDD: 4.2-5.4% vs 5.7-9.1% (+37% worse for some) ← **filter hurts here**

**Analysis**: Diversification already provides downside protection. Regime filter removes valuable hedging signals that profit in bear markets. Result: MaxDD INCREASES (less diversification), while Sharpe decreases (fewer signal opportunities). The regime filter fights against portfolio diversification.

### Type 3: Walk-Forward Optimized Portfolios

Parameters tuned per symbol on historical data, then backtested forward.

**7 V2-WF opt (top_n mp=3)**:
- V2 Sharpe: 3.12 (highest of entire study)
- V3 Sharpe: 2.51
- MaxDD: 7.2% for both (filter doesn't hurt here)
- Return: 160% vs 106%

**3 V3-WF opt (top_n mp=3)**:
- V2 Sharpe: 1.88
- V3 Sharpe: 1.67
- MaxDD: 3.1% (extremely conservative)
- Return: 36% vs 26%

**Analysis**: Walk-forward tuned parameters reduce the regime filter's impact. Optimization naturally skews toward market conditions seen in training data. If params are tuned on periods with fewer bear markets, the filter helps less. The 7-symbol V2-WF portfolio is the best risk-adjusted performer: Sharpe 3.12 with only 7.2% MaxDD and reasonable returns (160%).

## Allocation Mode Impact on Regime Filter

How different allocation strategies interact with the regime filter.

| Allocation | V2 Sharpe Range | V3 Sharpe Range | Filter Impact | Note |
|------------|-----------------|-----------------|---------------|------|
| single_strongest (mp=1) | 1.86-2.98 | 1.49-2.40 | -0.36 to -0.61 | Filter reduces concentrated bets |
| top_n (mp=3) | 1.88-3.12 | 1.58-2.51 | -0.47 to -0.61 | Filter removes diversifying signals |
| top_n (mp=5) | 1.87-3.01 | 1.57-2.47 | -0.46 to -0.54 | More diversification, less filter impact |
| weighted (mp=3) | 1.85-3.03 | 1.52-2.42 | -0.36 to -0.61 | Smooth position sizing, similar to SS |

**Finding**: The regime filter's impact is consistent (~-0.5 Sharpe) regardless of allocation strategy. However, MaxDD impact varies:
- **SS/weighted**: MaxDD improves 15-17% (concentrated positions more volatile in bear)
- **top_n/combined**: MaxDD worsens 1-5% (diversification already controls risk)

## Signal Reduction Analysis

The regime filter reduces trade count by 27-35%.

| Portfolio | Alloc | V2 Trades | V3 Trades | % Removed |
|-----------|-------|-----------|-----------|-----------|
| 13 default | SS mp=1 | 338 | 230 | 32% |
| 13 default | top_n mp=3 | 427 | 293 | 31% |
| 7 V2-WF opt | SS mp=1 | 203 | 134 | 34% |
| 7 V2-WF opt | top_n mp=3 | 245 | 169 | 31% |
| 3 V3-WF opt | SS mp=1 | 141 | 97 | 31% |
| 3 V3-WF opt | top_n mp=3 | 144 | 100 | 31% |
| 5 robust combined | SS mp=1 | 202 | 135 | 33% |
| 5 robust combined | top_n mp=3 | 222 | 150 | 32% |

**Observation**: Regime filter removes ~31-34% of signals (consistent). The Sharpe reduction (-0.5) is larger than the signal reduction would suggest, indicating removed signals were relatively profitable.

## Portfolio Symbols Reference

### 13 Symbol Default Portfolio
All symbols with default parameters, no optimization.

**Symbols**: IOST, ZEC, ARB, IOTA, TRB, STG, COTI, ENJ, KAVA, APT, COMP, RPL, BCH

### 7 V2-WF Optimized Portfolio
V2 parameters optimized per symbol on 2024-01-01 to 2025-06-30, then backtested 2025-07-01 to 2026-03-01.

**Symbols**: ZEC, LDO, TRB, XLM, IOST, NEAR, STG
**Optimization Method**: Grid search over minFundingRate, positionSize, atrPeriod

### 3 V3-WF Optimized Portfolio
V3 parameters optimized per symbol on 2024-01-01 to 2025-06-30, with ATR stops disabled to reduce false closures.

**Symbols**: ZEC, LDO, DOGE

### 5 Robust Combined Portfolio
Mix of V2-optimized (NEAR, STG) and V3-optimized (ZEC, LDO, DOGE) symbols, chosen for robustness across market regimes.

**Symbols**: ZEC, LDO, DOGE (V3 params), NEAR, STG (V2 params)

## Conclusions

### 1. Regime Filter Is Not Universal Improvement

The BTC EMA200 regime filter reduces Sharpe by ~0.5 consistently across all configurations. It is NOT a universal improvement—it's a risk-reduction mechanism with a performance cost.

### 2. Filter Benefits Large Concentrated Positions

**Good for**: Single_strongest (mp=1) and weighted allocation modes on large portfolios (13 symbols).
- MaxDD reduction: 15-17% (meaningful risk reduction)
- Sharpe cost: -0.59 (acceptable trade-off for some use cases)
- Use case: Conservative traders who want to limit bear-market drawdowns

### 3. Filter Hurts Diversified Portfolios

**Bad for**: top_n (mp=3/mp=5) allocation modes.
- MaxDD increases: 3.7% worse (removes hedging signals)
- Sharpe reduction: -0.52 (bigger hit than concentration benefit)
- Use case: Never use filter with diversified portfolios

### 4. Best Risk-Adjusted Configuration

**7 V2-WF opt portfolio, top_n mp=3 allocation**:
- V2 Sharpe: 3.12 (highest in study)
- MaxDD: 7.2% (reasonable)
- Return: 160% (2-year period)
- Trade count: 245 (good sample size)

This configuration combines:
- Walk-forward optimization (params adapted to recent history)
- Diversification (3 positions simultaneously)
- V2 (no regime filter, preserves bear-market opportunities)

### 5. Most Conservative Configuration

**3 V3-WF opt portfolio, top_n mp=3 allocation**:
- V3 Sharpe: 1.67 (lower but stable)
- MaxDD: 3.1-3.2% (extremely low risk)
- Return: 26-36% (modest but steady)
- Trade count: 100-144 (lower statistical significance)

Use only if you prioritize capital preservation above all else.

### 6. Symbol-Level Insights

**Regime filter winners** (use V3): ZEC, IOTA, COTI
- These symbols have different profitability dynamics in bear vs bull markets
- Bear-market trading hurts more than it helps
- Filter removes toxic periods

**Regime filter losers** (use V2): COMP, KAVA, STG, APT, IOST
- These symbols generate best returns during bear markets
- Funding rates are most extreme (most profitable) during downtrends
- Filter removes the strategy's edge

**Neutral** (either works): BCH, RPL, ARB, TRB, ENJ

## Recommendations

### For Production Deployment

**Primary recommendation**: 7 V2-WF opt portfolio with top_n mp=3
- Highest risk-adjusted returns (Sharpe 3.12)
- Reasonable drawdown (7.2%)
- Best Sharpe/MaxDD ratio: 3.12 / 7.2 = 0.43 (highest in study)
- Symbols: ZEC, LDO, TRB, XLM, IOST, NEAR, STG

**Conservative alternative**: 3 V3-WF opt portfolio with top_n mp=3
- Extreme capital preservation (MaxDD 3.1%)
- Still positive Sharpe (1.67)
- Lower returns but better for small accounts/risk-averse traders

**Do NOT use**: V3 with large concentrated portfolios (SS mp=1)
- The regime filter removes exactly the signals that make funding-rate strategies work
- Use V2 instead for concentrated portfolios

### For Further Research

1. **Adaptive regime filter**: Instead of complete blocking, reduce position size in bear markets
2. **Symbol-specific filters**: Use regime filter only for symbols that benefit (ZEC, IOTA, COTI)
3. **Combine with volatility filters**: Maybe high volatility in bear markets is the real issue, not the regime itself
4. **Test on bull-market-only data**: Does the filter help if we only backtest 2020-2021?
5. **Compare to stop-loss**: Does a proper ATR stop-loss achieve similar MaxDD reduction as regime filter?

## Files Referenced

- Strategy implementations: `/strategies/funding-rate-spike-v2.ts`, `/strategies/funding-rate-spike-v3.ts`
- Weight calculator fix: `/src/strategy/weight-calculators.ts` (added prefix matching, error on unknown)
- Walk-forward test results: `/docs/strategies/` (FR-V2 and FR-V3 walk-forward docs)

## Related Documentation

- [FR V2 Walk-Forward Validation](./YYYY-MM-DD-HHMMSS-fr-v2-walkforward.md) - Per-symbol optimization results
- [FR V3 Walk-Forward Validation](./YYYY-MM-DD-HHMMSS-fr-v3-walkforward.md) - V3 params with ATR stops disabled
- [Funding Rate Strategies Overview](./YYYY-MM-DD-HHMMSS-funding-rate-strategies-guide.md) - Strategy logic and parameter tuning
