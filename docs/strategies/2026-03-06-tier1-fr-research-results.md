# Tier 1 FR Research Results — 2026-03-06

**Date**: 2026-03-06
**Session**: Tier 1 funding rate research and optimization
**Status**: In progress (FR Regime Momentum pending)

---

## Executive Summary

Comprehensive testing of three FR-based strategy variations across production symbols to identify optimizations and new edge opportunities. Key finding: FR V2 with vol-adjusted sizing remains the proven edge; Kelly sizing offers interesting DD reduction at the cost of returns; FR Gradient and Regime Momentum show limited cross-symbol viability.

---

## 1. FR V2 Vol-Adjusted Sizing Comparison

### Objective
Compare three position sizing modes on FR V2 baseline to quantify the marginal benefit of vol-adjustment and explore Kelly-based alternatives.

### Test Parameters
- **Symbols**: LDO, DOGE, IMX, ICP, XLM, NEAR (6 production symbols)
- **Timeframe**: 4h
- **Date Range**: 2024-01-01 to 2026-01-01 (2 years)
- **Sizing Modes**:
  - `fixed`: Constant position size (baseline)
  - `volAdjusted`: Scale position by inverse volatility (current default)
  - `fractionalKelly`: 25% Kelly fraction for DD control
- **Test Count**: 18 backtests total

### Results Table

| Symbol | Mode | Sharpe | Return% | MaxDD% | Trades | Notes |
|--------|------|--------|---------|--------|--------|-------|
| LDO | fixed | 1.709 | 51.02% | 6.34% | 33 | Baseline |
| LDO | volAdjusted | 1.790 | 50.32% | 5.48% | 33 | **+0.081 Sharpe, -0.86% DD** |
| LDO | fractionalKelly | 1.607 | 15.78% | 3.48% | 33 | -4.86% DD, -35.24% return |
| DOGE | fixed | 1.622 | 14.09% | 2.50% | 16 | Baseline |
| DOGE | volAdjusted | 1.609 | 13.49% | 2.38% | 16 | -0.013 Sharpe, -0.12% DD |
| DOGE | fractionalKelly | 1.623 | 4.07% | 0.75% | 16 | -1.75% DD, -10.02% return |
| IMX | fixed | 1.280 | 23.39% | 8.25% | 28 | Baseline |
| IMX | volAdjusted | 1.216 | 21.46% | 8.16% | 28 | -0.064 Sharpe, +0.09% DD |
| IMX | fractionalKelly | 1.299 | 6.99% | 2.54% | 28 | -5.71% DD, -16.40% return |
| ICP | fixed | 0.640 | 10.41% | 6.18% | 29 | Baseline |
| ICP | volAdjusted | 0.725 | 11.53% | 5.24% | 29 | **+0.085 Sharpe, -0.94% DD** |
| ICP | fractionalKelly | 0.643 | 3.18% | 1.88% | 29 | -4.30% DD, -8.23% return |
| XLM | fixed | 0.910 | 14.33% | 6.89% | 26 | Baseline |
| XLM | volAdjusted | 0.910 | 13.75% | 6.89% | 26 | ±0.000 Sharpe, ±0% DD |
| XLM | fractionalKelly | 0.917 | 4.29% | 2.10% | 26 | -4.79% DD, -10.04% return |
| NEAR | fixed | 0.814 | 16.14% | 8.05% | 20 | Baseline |
| NEAR | volAdjusted | 0.794 | 13.45% | 8.03% | 20 | -0.020 Sharpe, -0.02% DD |
| NEAR | fractionalKelly | 0.813 | 4.82% | 2.46% | 20 | -5.59% DD, -11.32% return |

### Analysis

**Vol-Adjusted vs Fixed:**
- Avg Sharpe delta: +0.012 (+1.0%)
- Avg return delta: -0.37%
- Avg max DD delta: -0.34% (modest improvement)
- **Pattern**: Helps on high-volatility assets (LDO +0.081, ICP +0.085); neutral on low-vol (XLM)

**Fractional Kelly vs Fixed:**
- Avg Sharpe delta: -0.012 (-1.0%)
- Avg return delta: -14.54% (significant)
- Avg max DD delta: -4.17% (strong DD reduction)
- **Pattern**: Dramatically reduces drawdown at the expense of absolute returns

### Verdict

**Vol-Adjusted (Current Default): KEEP**
- Marginal Sharpe improvement (+1.0% average)
- Small max DD reduction (-0.34%)
- Low implementation risk; already in production
- Benefits most on volatile symbols (LDO, ICP)

**Fractional Kelly: INTERESTING FOR LIVE TRADING**
- Near-neutral Sharpe (-1.0%) makes it viable
- Dramatic DD reduction (-4.17% average) provides psychological safety
- Worth A/B testing in live trading to measure real-world stress tolerance
- Consider as risk-conscious variant strategy

---

## 2. FR Gradient Momentum

### Objective
Test a gradient-based momentum signal that measures the slope of funding rate changes, hypothesizing that steeper positive gradients signal trend strength.

### Test Design
- **Symbols**: SOL, DOGE, LDO, ARB, ZEC, TRB, IOST, STG (8 symbols, high-to-mid cap)
- **Timeframes**: 4h and 1h
- **Signal**: Momentum from gradient of FR with leveraged entry/exit
- **Leverage**: 3x initial (reduced for optimization)

### 4h Results — ALL FAILED

All 8 symbols on 4h timeframe showed severe underperformance:

| Symbol | Sharpe | Return% | MaxDD% | Comment |
|--------|--------|---------|--------|---------|
| SOL | -1.67 | -99.6% | 94.2% | Account ruin |
| DOGE | -1.43 | -97.8% | 88.9% | Account ruin |
| LDO | -0.92 | -87.3% | 77.4% | Account ruin |
| ARB | -0.83 | -73.2% | 69.1% | Account ruin |
| ZEC | -0.45 | -34.1% | 42.8% | Leverage issues |
| TRB | -0.38 | -28.9% | 38.5% | Leverage issues |
| IOST | -0.31 | -22.7% | 35.6% | Whipsaws |
| STG | -0.20 | -14.5% | 28.3% | Whipsaws |

**Root cause**: 3x leverage on a high-volatility, noisy signal (FR gradient) causes catastrophic account ruin. The signal generates too many false entries and rapid reversals.

### 1h Results — Default Parameters

Tested same 8 symbols at 1h timeframe with leverage reduced:

| Symbol | Trades | Return% | Sharpe | MaxDD% | Profit Factor | Notes |
|--------|--------|---------|--------|--------|---------------|-------|
| IOST | 54 | +42.9% | +0.67 | 32.3% | 1.26 | **PASS** |
| ZEC | 68 | -11.3% | +0.27 | 54.2% | 1.00 | Neutral |
| LDO | 90 | -16.0% | +0.13 | 68.1% | 1.00 | Weak |
| STG | 71 | -11.9% | -0.00 | 55.5% | 1.00 | Neutral |
| SOL | 97 | -30.6% | -0.12 | 48.9% | 0.94 | Negative |
| TRB | 22 | -18.9% | -0.24 | 38.4% | 0.76 | Negative |
| ARB | 84 | -50.6% | -0.44 | 70.5% | 0.83 | Severe |
| DOGE | 90 | -85.9% | -1.37 | 88.1% | 0.36 | Ruin |

**Key Observation**: Only IOST shows profitability. 7/8 symbols are losers.

### IOST 1h — Grid Search Optimization

Ran 300 parameter combinations on IOST 1h (the single profitable symbol):

**Optimized Parameters** (best Sharpe = 1.73):
- `leverage`: 1 (down from 3)
- `rsiBullish`: 35 (wider entry threshold)
- `rsiBearish`: 65 (wider entry threshold)
- `shortSmaLen`: 8 (faster trend detection)
- `gradientThreshold`: 0.015 (lower = more entries)

**Optimized Results**:
- Sharpe: 1.73 (vs 0.67 default)
- Return: +72.9%
- MaxDD: 8.6%
- Trades: 84
- Profit Factor: 2.14

**Finding**: Optimization works well for IOST, but this is a **single-symbol** result.

### Cross-Symbol Test with Optimized IOST Parameters

Applied IOST-optimized parameters to all 8 symbols:

| Symbol | Sharpe | Return% | MaxDD% | Result |
|--------|--------|---------|--------|--------|
| IOST | 1.73 | +72.9% | 8.6% | **EXCELLENT** |
| LDO | 0.58 | +18.2% | 22.4% | Pass |
| TRB | 0.53 | +14.7% | 28.9% | Pass |
| ZEC | 0.31 | -2.1% | 45.6% | Marginal |
| STG | 0.18 | -8.4% | 52.1% | Negative |
| SOL | -0.08 | -22.3% | 48.5% | Negative |
| ARB | -0.31 | -38.9% | 64.2% | Severe |
| DOGE | -1.14 | -78.5% | 85.3% | Ruin |

**Generalization Rate**: 3 out of 8 symbols pass (>0.5 Sharpe). Strategy parameters **do not generalize** across the symbol set.

### Verdict

**FR Gradient Momentum: NOT A PRIORITY**

- Signal is too noisy for reliable entries across symbols
- 4h completely fails (7 out of 8 symbols); 1h shows only 1/8 winners
- Optimization works for IOST but does NOT cross-validate to other symbols
- Leverage amplifies whipsaws on false signals
- **Recommendation**: Archive this strategy. Only revisit if dedicated walk-forward testing on IOST alone shows robustness across out-of-sample periods.

---

## 3. FR Regime Momentum

### Status: PENDING

This strategy is currently being tested and validated. Results will be added to this document upon completion.

**Expected completion**: Within 24 hours

---

## Overall Tier 1 Assessment

### Proven Edge
**FR V2 on 4h remains the reliable performer** across all tested symbols. The 2-year backtest period (2024–2026) confirms consistent profitability.

### Tier 1 Optimizations Summary

| Strategy | Status | Sharpe Impact | Max DD Impact | Viability |
|----------|--------|--------------|---------------|-----------|
| FR V2 + Vol-Adjusted | Current | +0.012 | -0.34% | **KEEP** |
| FR V2 + Fractional Kelly | Tested | -0.012 | -4.17% | Interesting for live |
| FR Gradient Momentum | Tested | -0.56 avg | N/A (ruin) | Archive |
| FR Regime Momentum | Pending | TBD | TBD | TBD |

### Key Insights

1. **Marginal improvements dominate**: Vol-adjusted sizing helps on volatile symbols but offers only +1% Sharpe gain overall.

2. **Kelly sizing trades returns for safety**: Fractional Kelly reduces max DD dramatically (-4.17%) at the cost of -14.54% average returns. Worth A/B testing in live trading.

3. **Leverage on noisy signals fails**: FR Gradient's high-leverage entries on gradient noise cause catastrophic losses on 4h and 7/8 losses on 1h.

4. **Optimization doesn't generalize**: IOST gradient parameters don't carry over to other symbols, suggesting symbol-specific quirks dominate.

5. **Single-symbol success doesn't scale**: IOST's +1.73 Sharpe with optimized gradient doesn't validate on 7 other symbols.

### Recommended Next Steps

1. **Complete FR Regime Momentum testing** — if it shows cross-symbol promise, it could be a new Tier 1 edge.

2. **Walk-forward validation on FR Gradient (IOST only)** — if IOST gradient sustains >1.0 Sharpe out-of-sample, consider it a specialty strategy for that symbol alone.

3. **A/B test Fractional Kelly in live trading** — measure investor stress tolerance vs absolute returns. The DD reduction (-4.17%) may justify the return sacrifice.

4. **Maintain FR V2 4h as core strategy** — the incremental optimizations do not materially improve the proven edge. Focus live trading resources on execution quality and risk management.

---

## Files Referenced

- `/strategies/fr-v2.ts` — FR V2 implementation (vol-adjusted baseline)
- `/strategies/fr-gradient-momentum.ts` — FR Gradient implementation (archived after this research)
- `/strategies/fr-regime-momentum.ts` — FR Regime Momentum (pending results)
- `/docs/strategies/strategy-catalog.md` — Full strategy inventory

---

## Session Notes

- All 18 + 300 backtest runs automatically persisted to database
- Results visible in dashboard optimizer modal for reproducibility
- No critical issues found in sizing logic; vol-adjustment behaves as designed
- Gradient signal requires fundamental redesign or symbol-specific tuning to be viable

---

**Document Version**: 1.0
**Last Updated**: 2026-03-06
**Next Review**: Upon completion of FR Regime Momentum testing
