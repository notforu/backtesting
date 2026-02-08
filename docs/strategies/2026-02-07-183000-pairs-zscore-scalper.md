# Pairs Z-Score Mean Reversion Scalper

**Strategy Type:** Pairs Trading (Mean Reversion)
**Created:** 2026-02-07
**Status:** Implemented

## Overview

A statistical arbitrage strategy that trades mean reversion in the spread between two correlated crypto assets. The strategy computes a cointegrated spread using rolling hedge ratios and enters positions when the z-score exceeds entry thresholds, betting on reversion to the mean.

## Core Logic

### Spread Calculation
```
spread = log(priceA) - hedgeRatio * log(priceB)
```

Where:
- `hedgeRatio = mean(closesA) / mean(closesB)` over lookback window
- Log prices reduce heteroskedasticity and multiplicative effects

### Z-Score Signal
```
z = (spread - rollingMean(spread)) / rollingStd(spread)
```

Computed over a rolling window of `zScorePeriod` bars.

### Entry Rules

1. **Short spread** (short A, long B) when:
   - z > entryZScore (spread too wide)
   - correlation > minCorrelation
   - No existing position

2. **Long spread** (long A, short B) when:
   - z < -entryZScore (spread too narrow)
   - correlation > minCorrelation
   - No existing position

### Exit Rules

Exit position when ANY of:
1. **Mean reversion**: z crosses back to exitZScore threshold
2. **Stop loss**: z exceeds stopZScore (spread diverges further)
3. **Time stop**: maxHoldBars exceeded (prevents holding dead positions)

### Position Sizing

- Dollar-neutral: equal notional value on both legs
- Each leg sized as `positionSizePct * equity / 2`
- Ensures market-neutral exposure to directional moves

## Parameters

| Parameter | Default | Min | Max | Step | Description |
|-----------|---------|-----|-----|------|-------------|
| lookbackPeriod | 60 | 20 | 120 | 10 | Hedge ratio lookback window |
| zScorePeriod | 20 | 10 | 40 | 5 | Z-score rolling window |
| entryZScore | 2.0 | 1.0 | 3.0 | 0.25 | Entry threshold (absolute) |
| exitZScore | 0.0 | -0.5 | 0.5 | 0.25 | Mean reversion exit |
| stopZScore | 3.5 | 2.5 | 5.0 | 0.5 | Stop loss threshold |
| maxHoldBars | 100 | 20 | 200 | 20 | Time-based exit |
| positionSizePct | 80 | 50 | 95 | 5 | % of capital per trade |
| minCorrelation | 0.7 | 0.5 | 0.9 | 0.1 | Minimum correlation filter |

## Recommended Pairs

### High Correlation Pairs (Test These First)

1. **BTC/USDT - ETH/USDT**
   - Strong fundamental correlation (ETH often tracks BTC)
   - High liquidity on all major exchanges
   - Suggested lookback: 60-80 bars

2. **SOL/USDT - AVAX/USDT**
   - L1 platform tokens, similar narratives
   - Both ecosystem-driven valuations
   - Suggested lookback: 40-60 bars

3. **BNB/USDT - FTT/USDT** (pre-collapse only)
   - Exchange tokens
   - Similar business models

4. **MATIC/USDT - AVAX/USDT**
   - Scaling solutions
   - Often move together on L1/L2 news

### Pair Selection Criteria

- Rolling 60-day correlation > 0.75
- Similar volatility profiles (avoid pairing BTC with low-cap alts)
- Adequate liquidity (> $10M daily volume on both)
- Fundamental relationship (same sector, similar narratives)

## Risk Considerations

1. **Correlation breakdown**: Major divergence events (hacks, regulations)
2. **Cointegration drift**: Hedge ratio may shift over time
3. **Liquidity risk**: Slippage on both legs compounds
4. **Leverage risk**: Dollar-neutral doesn't mean zero risk

## Optimization Strategy

### Phase 1: Pair Validation
- Test correlation over rolling windows
- Verify cointegration using ADF test (external tool)
- Check spread stationarity

### Phase 2: Parameter Search
- Grid search over zScorePeriod [10, 20, 30, 40]
- Grid search over entryZScore [1.5, 2.0, 2.5, 3.0]
- Fix lookbackPeriod = 60 initially

### Phase 3: Risk Controls
- Optimize stopZScore to minimize tail losses
- Tune maxHoldBars to avoid dead money
- Test positionSizePct for drawdown control

### Phase 4: Walk-Forward
- 6-month rolling windows
- Re-optimize hedge ratio every 3 months
- Monitor correlation drift

## Expected Performance

- **Win rate**: 55-65% (mean reversion edge)
- **Profit factor**: 1.3-1.8
- **Max drawdown**: 15-25% (correlation breakdown risk)
- **Sharpe ratio**: 1.0-2.0 (market-neutral)
- **Trades per month**: 5-15 (depends on volatility regime)

## Implementation Notes

- All indicators computed inline (no external dependencies)
- Rolling windows use simple array slicing
- Hedge ratio recalculated every bar for adaptability
- Z-score uses population std (not sample std) for consistency
- Correlation filter prevents trading during regime changes

## References

- Vidyamurthy, G. (2004). *Pairs Trading: Quantitative Methods and Analysis*
- Gatev, E., Goetzmann, W. N., & Rouwenhorst, K. G. (2006). "Pairs Trading: Performance of a Relative-Value Arbitrage Rule"
- Avellaneda, M., & Lee, J. H. (2010). "Statistical Arbitrage in the U.S. Equities Market"
