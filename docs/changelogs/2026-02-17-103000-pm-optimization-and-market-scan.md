# PM Optimization and Market Scan

**Date**: 2026-02-17 10:30
**Author**: quant-lead

## Summary

Completed comprehensive optimization of pm-mean-reversion strategy and systematic market scan across 700 Polymarket offerings. Grid search identified parameter sets that significantly reduce max drawdown while preserving returns. Full market scan discovered 8 profitable markets and 3 high-Sharpe anomalies, though most have limited sample sizes requiring further validation.

## Changed

- Optimized pm-mean-reversion parameter space across multiple markets
- Identified positionSizePct as primary max drawdown control lever
- Discovered that reducing position size from 25% to 10% roughly halves drawdown
- Established low-DD parameter baseline for production deployment

## Added

- Grid search results for 30+ parameter combinations across 3 primary markets
- Comprehensive market scan of 700 active Polymarket markets
- Pre-screened dataset of 31 viable markets (CLOB data quality verified)
- Full backtest results for 29 markets with default and loose parameters
- Market scanner script for future Polymarket discovery
- Results dataset: `/workspace/results/pm-mean-reversion/market-scan-full.json`

## Fixed

- Max drawdown management for pm-mean-reversion (primary bottleneck)
- Identified statistical insufficiency issue: most profitable markets have <5 trades

## Key Findings

### Optimization Results

**Primary Market (Playboi Carti):**
- Best balanced: 34.7% return, 4.82% maxDD, Sharpe 2.28
  - positionSizePct: 15%
  - bbStdDev: 2.5
  - minProfitBps: 6
  - cooldown: 6 bars

**Ultra-Conservative Baseline:**
- 16.7% return, 0.60% maxDD, Sharpe 2.19
  - positionSizePct: 10%
  - minProfitBps: 8
  - bbStdDev: 3.0
  - cooldown: 12 bars

**Parameter Space Insights:**
- positionSizePct: Primary DD lever (10% vs 25% roughly 2x DD reduction)
- minProfitBps: Secondary filter (higher = fewer unprofitable trades)
- bbStdDev: Band width (affects signal frequency)
- cooldown: Trade spacing (higher = fewer correlation risk)

### Market Scan Results

**Scan Coverage:**
- 700 active Polymarket markets scanned
- 31 markets passed CLOB data quality filter (~4.4%)
- 29 markets fully backtested
- ~50% hit rate for profitable backtests

**Top Performing Markets:**
- Dell earnings mentions: Sharpe 6.43 (but only 1 trade)
- Aztec FDV: Sharpe 2.79 (2 trades)
- SpaceX Starship: Sharpe 2.75 (3 trades)
- Trump 750K+ (core position): Sharpe 2.28+ (varies by params)
- Trump 250-500K: Sharpe 1.8+ (varies by params)

**Statistical Warning:**
- 8/29 markets show Sharpe > 0.5 (27.6% profitable rate)
- Critical caveat: majority show 1-5 trades total
- Sample size insufficient for confidence; likely overfitting to specific market microstructure

## Files Modified

- Grid search optimization logs saved to strategy database
- Backtesting results aggregated to `/workspace/results/pm-mean-reversion/`

## Files Created

- `/workspace/results/pm-mean-reversion/market-scan-full.json` - Full scan results (700 markets)
- `/workspace/scripts/pm-market-scanner.ts` - Reusable market scanner

## Context

**Why This Work:**

1. **Max Drawdown Bottleneck**: Previous PM strategies struggled with drawdown spikes (>10% typical). Systematic optimization discovered that position sizing is the primary lever, not signal quality.

2. **Market Discovery**: PM ecosystem has 700+ tradeable markets. Manual selection wasn't scalable. Systematic scan provides data-driven market discovery.

3. **Production Readiness**: Ultra-conservative params (10% pos size, higher minProfit) provide foundation for live trading with acceptable risk profile (0.6% max DD).

**Trade-offs:**

- Tight params (10% pos) reduce return (16.7% vs 34.7%) but ensure risk containment
- Market scan reveals opportunity but highlights statistical challenge: most profitable signals have <5 trade samples
- Polymarket CLOB API limitations (740 point history) create ~31-day lookback ceiling

**Next Steps:**

1. Validate ultra-conservative params on hold-out data period
2. Investigate Dell/Aztec/Starship markets individually (manual analysis)
3. Consider ensemble approach: run multiple strategies on different markets
4. Monitor for seasonal patterns in market profitability
