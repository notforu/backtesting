# FR Regime Momentum Scalper Research — Conclusion

**Date**: 2026-03-06 12:00
**Author**: quant-lead

## Summary

Completed research on `fr-regime-momentum` strategy (5m entry timing with 4h funding rate filter). Tested v1.0 (percentile-based FR detection) and v2.0 (absolute threshold). Found that FR regime filtering on 5m granularity adds negligible value over existing 4h FR V2 strategy. Extreme FR events are too rare (1-3/month) to provide statistically significant trade samples. Recommend abandoning 5m FR scalping and focusing on either broader symbol coverage for FR V2, non-FR scalping edges, or multi-asset aggregation improvements.

## Changed

- `strategies/fr-regime-momentum.ts` — v1.0 → v2.0: replaced percentile-based FR detection with absolute threshold (`frAbsThreshold` param), added cooldown mechanism to replace overly-restrictive `_regimeTraded` flag, fixed position sizing logic

## Added

- 5m candle data cached for LDO, DOGE, RPL (Jan 2024 to Mar 2026, ~175K candles each) in PostgreSQL for future research

## Fixed

- **v1.0 bug**: Missing `--exchange=bybit` CLI flag caused 0 funding rates loaded → 0 trades
- **v1.0 bug**: `_regimeTraded` flag prevented re-entry during long regime windows; replaced with cooldown mechanism
- **v1.0 design flaw**: Percentile-based FR detection broken on Bybit (FR capped at 0.0001 for 40-56% of observations, treating cap as "extreme")

## Research Results

### v1.0 (Percentile-based FR)
- **DOGE Sep25-Mar26**: Sharpe 2.66, +93.7% (overfitted — OOS Jun24-Sep25: Sharpe -3.94)
- **LDO**: Never profitable on any period
- **Root cause**: FR cap creates meaningless percentile rankings

### v2.0 (Absolute Threshold FR)
- **DOGE full period (2 years)**: Best Sharpe 0.85, +9.6%, 74 trades (threshold=0.0006)
- **DOGE IS (Jan24-Apr25)**: Sharpe 1.09, +7.2%, 34 trades (threshold=0.0008)
- **DOGE OOS (Apr25-Mar26)**: 1-2 trades only — insufficient for validation
- **RPL full period (20 months)**: Sharpe 0.52, +6.7% (best threshold=0.0001, no real FR filter)
- **LDO**: Never profitable

### FR Distribution Analysis
- **LDO**: 55.8% at cap (0.0001), extreme (>0.06%) = 0.04%
- **DOGE**: 40.7% at cap, extreme events = 5-6% (best case)
- **RPL**: 50.9% at 0.00005, 26.7% at cap

## Key Findings

1. **5m FR granularity adds no edge over 4h**: Extreme FR events occur 1-3 times/month. Mean-reversion after extreme FR happens over hours/days, not minutes. 5m EMA crosses are noisy and fail to improve entry timing.

2. **Percentile-based FR detection is broken on Bybit**: FR capped at 0.0001 makes percentile ranks unreliable. Must use absolute thresholds.

3. **5m scalping timing doesn't help**: The fundamental edge (capital inflow during extreme FR) doesn't operate at 5m frequency. Regime filter is only useful on 4h bars.

4. **Statistical significance**: After filtering for extreme FR events, remaining trade count (1-2 per month) is too low for robust validation or optimization.

## Recommendation

**Abandon 5m FR-regime scalping approach.** 4h FR V2 is the correct granularity for this edge. Next priorities:

1. Expand FR V2 to additional symbols (currently DOGE only)
2. Explore non-FR scalping edges (liquidation cascades, VWAP reversion)
3. Improve multi-asset aggregation and capital allocation

## Files Modified

- `strategies/fr-regime-momentum.ts` — v1.0 → v2.0 updates

## Files Deleted

- Temporary debug scripts removed:
  - `debug-fr-regime.ts`
  - `debug-fr-regime2.ts`
  - `debug-fr-distribution.ts`
  - `check-data.ts`

## Context

This research was part of expanding HF scalping strategy portfolio beyond liquidation-based approaches. FR regime filtering on 4h timeframe showed promise (FR V2 with +12-15% returns on DOGE). Initial hypothesis was that using FR as regime filter on 5m granularity would allow more frequent entries during extreme events. Testing revealed the hypothesis was wrong: extreme FR is too infrequent and too brief (subsample within single 4h bar) to generate reliable 5m signals. The correct approach remains 4h bar-level trading using FR as regime confirmation, not 5m scalping off FR spikes.
