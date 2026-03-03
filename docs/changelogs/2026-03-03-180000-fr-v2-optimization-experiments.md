# FR Spike V2 Optimization Experiments

**Date**: 2026-03-03 18:00
**Author**: quant-lead

## Summary

Two major experiments were conducted to identify improved FR Spike V2 configurations beyond the current production deployment (Sharpe 1.88, Return 224%, MaxDD 13.3%). Results revealed that V2's trend filter is protective rather than suppressive, and an expanded symbol universe yielded a new superior configuration (Sharpe 2.08, MaxDD 8.3%).

## Experiment 1: V1 Tops vs V2 Tops Tournament

### Hypothesis
V1's historically top-performing assets (ADA, DOT, ATOM, ETC, MANA) are being suppressed by V2's trend filter.

### Result: REJECTED
Disabling the trend filter caused catastrophic performance degradation:

| Config | Sharpe | Return | MaxDD |
|--------|--------|--------|-------|
| V1 Tops+MANA NoTF 4h SS | -0.14 | -34% | 62% |
| V1 Tops+MANA NoTF 1h SS | 0.13 | -14% | 68% |
| V1 Tops MixedTF NoTF SS | -0.03 | -27% | 67% |
| V1+V2 Hybrid MixedTF SS | 0.17 | +10% | 51% |
| Top10 Mixed TF4h SS | 0.44 | +23% | 54% |
| Top10 Mixed TF4h TopN3 | 0.60 | +46% | 63% |

### Key Insight
The trend filter is **protecting** these assets, not suppressing their edge. Without it, drawdowns exceed 60%. This indicates V2's multi-filter approach (trend + momentum + reversion) is essential for capital preservation.

## Experiment 2: Expanded Symbol Universe Scan

### Methodology
Conducted V2 batch scan across 74 Bybit futures symbols at both 1h and 4h timeframes using new `scan-fr-v2.ts` script.

### New High-Performing Discoveries (Sharpe > 0.5, not in production)

| Symbol | TF | Sharpe | Return | MaxDD | Funding Income | Notes |
|--------|----|----|--------|-------|---|---|
| RPL | 1h | 1.28 | 37.3% | 11.5% | - | Low volatility |
| ENS | 1h | 1.09 | 30.3% | 11.5% | - | Low volatility |
| ARB | 4h | 1.02 | 16.8% | 4.8% | - | **Excellent DD** |
| TIA | 4h | 0.74 | 20.4% | ~20% | $240 | **Highest funding income** |
| APT | 4h | 0.71 | 16.5% | 8.0% | - | - |
| COMP | 4h | 0.70 | 9.5% | 6.2% | - | **Low volatility** |
| JTO | 4h | 0.59 | 12.9% | - | - | - |
| BCH | 4h | 0.56 | 7.7% | - | - | - |

### Expanded Universe Aggregation Tournament

Six new configurations were created combining expanded symbols:

| Config | Sharpe | Return | MaxDD | Trades | Notes |
|--------|--------|--------|-------|--------|-------|
| **V2 LowDD Focus SS** | **2.08** | **291.6%** | **8.3%** | 154 | **WINNER** |
| V2 Full16 Best-TF TopN3 | 1.36 | 1359.9% | 35.9% | 517 | High return, high DD |
| V2 Full16 Best-TF SS | 1.32 | 1419.2% | 37.4% | 381 | High return, high DD |
| V2 Extended Top10 Mixed SS | 1.28 | 825.5% | 14.9% | 260 | Balanced |
| V2 Extended Top10 Mixed TopN3 | 1.26 | 776.3% | 28.7% | 338 | - |
| V2 Extended Top10 Mixed TopN5 | 1.23 | 719.3% | 28.7% | 351 | - |

## WINNER: V2 LowDD Focus Single Strongest

### Performance Metrics
- **Sharpe Ratio**: 2.08 (vs 1.88 production) — **+11% improvement**
- **Total Return**: 291.6% (vs 224% production) — **+30% improvement**
- **Max Drawdown**: 8.3% (vs 13.3% production) — **38% lower risk**
- **Trade Count**: 154
- **Configuration**: Single Strongest, 4h timeframe

### Asset Composition
LDO, DOGE, ARB, ICP, COMP, TRX, XLM

**Key Change from Production**: Drops GRT/XLM/NEAR/IMX (underperformers), adds ARB/COMP/TRX. Focus shifts toward low-volatility, low-drawdown assets where the funding rate edge is most reliable.

## Files Modified/Created
- `scripts/explore-fr-v2-aggregations.ts` — Extended from 26 to 32 configs (6 new experiments added)
- `scripts/scan-fr-v2.ts` — New V2 batch scan script (fork of V1 scanner)
- `data/fr-v2-scan-results.json` — Complete scan results across 74 symbols × 2 timeframes

## Technical Notes

### Aggregation Config Storage
- Configs stored in `backtesting_aggregations` table with `config` JSONB field
- V2 LowDD Focus config ID needs to be recorded for walk-forward testing
- Single Strongest ranking applied via `rankingMethod: 'single_strongest'`

### Trade Execution
- All configs use 4h timeframe for consistency
- TopN variants use different ranking methods (TopN3, TopN5) for portfolio diversification

## Next Steps

1. **Walk-Forward Test V2 LowDD Focus SS** for out-of-sample robustness (70/30 split on 2yr+ history)
2. **Investigate TIA 4h** — exceptional funding income ($240 over backtest period) warrants deeper analysis
3. **Consider Deployment** — If WF tests pass, update paper trading default config
4. **Monitor Funding Rates** — ARB, COMP, TRX showing strong and stable funding income

## Context

This optimization phase was triggered after production deployment of FR Spike V2 (Sharpe 1.88). The goal was to identify whether the current asset selection was optimal or if V1's top performers could be brought into V2's multi-filter framework. Results conclusively showed V2's filters are protective, and expanding the symbol universe revealed significantly better low-drawdown configurations suitable for risk-averse deployment.
