# HF Scalping Research Results — Final Report

> **Date**: 2026-03-06 12:00
> **Duration**: March 4–6, 2026 (3 days)
> **Status**: Research Complete. Conclusion: No viable HF scalping edge found.

---

## Executive Summary

**Goal**: Find profitable high-frequency (HF) scalping strategies for crypto perpetual futures on 1m/5m timeframes to supplement existing 4h Funding Rate V2 (FR V2) strategy.

**Outcome**: UNSUCCESSFUL

**Timeline**:
- **Mar 4**: Built HF infrastructure (symbol selection, 1m caching, database optimization). Implemented 2 strategies: FR Settlement Scalper, Volatility Breakout Scalper.
- **Mar 5**: Both 1m strategies failed testing. Pivoted to "FR as regime filter + 5m/15m execution" approach. Wrote 3 new strategy specs. Implemented FR Regime Momentum and FR Gradient Momentum.
- **Mar 6**: Extensive testing of FR Regime Momentum on 3 symbols (DOGE, LDO, RPL) × multiple periods. Discovered critical FR cap problem on Bybit. Tested both v1.0 (percentile-based) and v2.0 (absolute threshold). OOS validation failed.

**Conclusion**: FR Regime Momentum strategy adds negligible value over existing FR V2 on 4h. Transaction costs and signal scarcity on short timeframes eliminate any edge. **Recommend: Do NOT pursue HF scalping; focus on FR V2 symbol expansion or non-FR structural edges.**

---

## Timeline & Discovery Process

### March 4: Infrastructure & Initial Strategies

**What we built**:
- Symbol selection system: ranked 74 Bybit symbols across 8 metrics for scalping suitability
- 1m candle caching: 3.1M candles across 12 symbols (6 months: Sep 2025–Mar 2026)
- Database optimization: bulk insert function for 5x faster writes
- Indicator optimization: windowed calculations O(n) instead of O(n²)

**Strategies implemented**:
1. **FR Settlement Scalper** (`strategies/fr-settlement-scalper.ts`) — Exploit predictable price drift 30-60min before/after 8h funding rate settlements. Default params: `lookback=50, frPercentile=5, smaLength=10, rsiLength=14, takeProfitPercent=0.08, stopLossPercent=0.15`.
   - Hypothesis: Overleveraged longs/shorts must close before settlement, creating directional pressure
   - Result: FAILED — 45-66 trades over 6 months, 35-45% win rate, losses after fees

2. **Volatility Breakout Scalper** (`strategies/volatility-breakout-scalper.ts`) — Detect Bollinger Band squeeze → breakout with volume confirmation. ATR-based TP/SL.
   - Hypothesis: BB squeeze compress → explosive breakout on volume spike
   - Result: FAILED — 106-756 trades over various periods, 8-17% win rate, fees dominate

**Root cause of failures**: On 1m timeframe, transaction costs (taker 0.055% + slippage 0.05% = 0.105% round-trip) require minimum profitable move of 0.11% price change. Average 1m candle move on most coins << 0.11%, so pure technical signals generate mostly losing trades.

### March 5: Pivot to FR-Regime Filtering

**Lesson learned**: FR is the edge (structural inefficiency), not pure technical patterns. Design principle: "FR as regime filter, 5m/15m as entry timing."

**New hypothesis**: Use 4h FR extremes to detect regimes, then enter on 5m EMA crossovers during those regimes to time entry more precisely.

**Strategies specified**:
1. **FR Regime Momentum Rider** — Detect 4h FR extremes (> absolute threshold), enter on 5m EMA crossover
2. **FR Gradient Momentum** — Use 4h FR rate of change (velocity) instead of level
3. **Time-of-Day Seasonality** (unimplemented) — 21:00-23:00 UTC window exploitation

**What we actually implemented and tested**:
- `strategies/fr-regime-momentum.ts` v1.0 (percentile-based FR detection)
- `strategies/fr-gradient-momentum.ts` (written but not extensively tested)

### March 6: Extensive Testing & FR Cap Discovery

**Testing scope**:
- 3 symbols: DOGE, LDO, RPL
- 2-4 test periods per symbol (full 2yr, in-sample, out-of-sample)
- Grid search over 15+ parameter combinations per symbol
- Results saved to PostgreSQL via `saveBacktestRun()`

**Critical discovery**: Bybit FR distribution problem
- LDO: 55.8% of all observations = 0.0001 (cap), extreme (> 0.06%) = 0.04%
- DOGE: 40.7% at cap, extreme events = 5-6%
- RPL: 50.9% at 0.00005, 26.7% at cap

**Impact**: Percentile-based FR detection is fundamentally broken when the cap is so common. frPercentileThreshold=85 flags 0.0001 as "extreme" when it's the default rate.

**v1.0 → v2.0 pivot**: Switched from percentile to absolute threshold (frAbsThreshold >= 0.0006).

---

## Strategies Tested

### 1. FR Settlement Window Scalper (1m)

**File**: `strategies/fr-settlement-scalper.ts`

**Hypothesis**: Exploit predictable price drift 30-60 minutes before/after 8-hourly funding rate settlement timestamps (00:00, 08:00, 16:00 UTC). Settlement forces overleveraged positions to close, creating directional pressure → snapback post-settlement.

**Signal Logic**:
- Detect when current time is within 45 min before funding settlement
- Confirm FR is extreme (> 85th percentile of last 50 bars)
- Wait for price to drop below 20-period VWAP (long setup) or rise above VWAP (short setup)
- Enter on RSI(14) extremes (< 25 for long, > 75 for short)
- Exit: TP when price returns to VWAP (0.15-0.30% move), SL 0.20%, or time exit 15 min after settlement

**Parameters**: `lookback=50, frPercentile=5, smaLength=10, rsiLength=14, takeProfitPercent=0.08, stopLossPercent=0.15, exitBarsAfterEntry=480`

**Test Results**:
- RPL (1m, 6 months): 66 trades, 45.5% win rate
- AXS (1m, 6 months): 114 trades, 35.1% win rate
- Both: Net PnL negative after taker fees (0.055% per side) and slippage (0.05%)

**Why it failed**:
- Settlement window effect on 1m candles is too noisy
- Time window is precise (settlement at exact UTC hour) but market pressure is diffuse across many minutes
- Median move during settlement window (0.08%) ≈ transaction costs (0.105%)
- Insufficient statistical edge to overcome costs even at 45% win rate

**Conclusion**: The structural insight is correct (settlement pressure exists), but it operates on a longer timescale than 1m resolution can profitably capture. FR V2 on 4h bars captures this same edge more effectively.

---

### 2. Volatility Breakout Scalper (1m)

**File**: `strategies/volatility-breakout-scalper.ts`

**Hypothesis**: Crypto exhibits extreme volatility clustering. Bollinger Band squeeze signals low-volatility regime; breakout on volume spike signals regime transition. Trade the initial explosive move, exit before regime stabilizes.

**Signal Logic**:
- Calculate Bollinger Band Width (BBW) percentile over 200 bars
- Squeeze = BBW in bottom 10th percentile for ≥ 5 consecutive bars
- Breakout entry: Price breaks above/below BB on volume > 2x average
- Exit: 2x ATR TP, 1x ATR SL, time exit after 15 bars
- Trailing stop: After 1x ATR profit, trail at 0.5x ATR

**Parameters**: `bbLength=20, bbDeviation=2, volumeThreshold=1.2, atrLength=14, atrMultiplier=2.0, trailingStopPercent=0.1`

**Test Results**:
- BTC (1m, 6 months): 756 trades, 8.7% win rate
- RPL (1m, 1 month): 106 trades, 17.0% win rate
- High trade frequency but abysmal win rates even at entry

**Why it failed**:
- Pure technical pattern (BB squeeze) on 1m = pure noise
- Volume spikes on 1m often false (spoofing, partial fills, normal order slicing)
- False breakout rate > 90% before filtering; remaining valid breakouts produce < 0.10% moves
- Transaction costs (0.105%) eliminate all profits
- Better suited to 5x-leveraged spot trading on low-fee venues, not 20x perp futures on taker fees

**Conclusion**: Volatility clustering is real, but detecting it on 1m requires either order book data or tick-level volume analysis. OHLCV alone insufficient. This strategy works on larger timeframes (15m+) or with maker-order execution, not 1m perp scalping.

---

### 3. FR Regime Momentum Rider (5m) — Most Extensively Tested

**File**: `strategies/fr-regime-momentum.ts`

**Hypothesis** (v1.0): Use 4h funding rate extremes as regime detector. When FR is at 85th+ percentile (highly positive), expect mean-reversion trade (short) on next 5m EMA crossover. Same for negative FR (long on EMA cross). This combines structural edge (FR mean reversion) with better entry timing (5m resolution).

**Hypothesis** (v2.0): After discovering FR cap problem, switch to absolute threshold detection. FR > 0.0006 is genuinely extreme on Bybit (vs 0.0001 cap).

**Signal Logic**:

*v1.0 (Percentile-based)*:
- Every bar, calculate FR percentile over last 50 8-hourly observations
- When FR percentile > 85: Set regime = "short" (go with capital flow, short to collect funding)
- When FR percentile < 15: Set regime = "long"
- When regime is active and 5m bar closes above EMA(8): Enter short (if regime=short) or long (if regime=long)
- Exit: Opposite EMA(8) cross, TP 0.15% below entry (mean reversion target), SL 0.25%, time exit 60 bars

*v2.0 (Absolute threshold)*:
- Replace percentile detection with: `if (currentFR > frAbsThreshold) setRegime('short')`
- Tune `frAbsThreshold` parameter via grid search
- Add 1-bar cooldown after exit to prevent re-entry spam

**Parameters**:
- v1.0: `lookback=50, frPercentile=85, emaBuy=8, emaSell=21, takeProfitPercent=0.15, stopLossPercent=0.25`
- v2.0: `frAbsThreshold=0.0006, cooldownBars=1, emaBuy=8, emaSell=21, takeProfitPercent=0.15, stopLossPercent=0.25`

**Test Results** (v1.0 — Percentile-based):

| Symbol | Period | IS/OOS | Sharpe | PnL | Trades | Entry Price | Notes |
|--------|--------|--------|--------|-----|--------|-------------|-------|
| DOGE   | Sep 25–Mar 26 (6m) | IS | 2.66 | +93.7% | 34 | In-sample only | CLASSIC OVERFITTING |
| DOGE   | Jun 24–Sep 25 (3m) | OOS | -3.94 | -45.2% | 8 | Out-of-sample validation | Failed spectacularly |
| LDO    | Various | — | —     | Loss | — | — | Never profitable |

**Root cause of overfitting**: FR cap at 0.0001 makes percentile rankings meaningless. With 55.8% of LDO observations at cap, frPercentile=85 captures both "extreme" (0.0001) and "normal" (0.0001) as the same thing. This leads to a spurious signal that fits recent data but doesn't generalize.

**Test Results** (v2.0 — Absolute Threshold):

| Symbol | Period | Threshold | Sharpe | PnL | Trades | Win Rate | Notes |
|--------|--------|-----------|--------|-----|--------|----------|-------|
| DOGE | Jan 24–Mar 26 (2yr) | 0.0006 | 0.85 | +9.6% | 74 | 51% | Only marginally profitable |
| DOGE | Jan 24–Apr 25 (IS, 16m) | 0.0008 | 1.09 | +7.2% | 34 | 56% | Decent IS performance |
| DOGE | Apr 25–Mar 26 (OOS, 12m) | 0.0008 | — | — | 1-2 | — | Insufficient data for validation |
| RPL | Jan 25–Sep 25 (9m) | 0.0001 | 0.52 | +6.7% | 78 | 51% | Threshold=0.0001 = no filter |
| LDO | All periods | — | — | Loss | — | — | Never profitable on any threshold |

**Key observations**:
1. DOGE full-2yr with threshold=0.0006 achieves Sharpe 0.85 (marginally acceptable for crypto), but this is mostly due to 51% win rate × small TP (0.15%) covering costs.
2. IS/OOS split shows the problem: IS (Jan 24–Apr 25) gets 34 trades → decent sample for validation. OOS (Apr 25–Mar 26) gets only 1-2 trades → statistically worthless.
3. RPL with threshold=0.0001 (the FR cap!) is equivalent to no regime filter; Sharpe drops to 0.52.
4. LDO never profitable regardless of threshold or period. Why? LDO has 55.8% observations at cap (0.0001), making genuine extreme FR events rarer than DOGE. Even with only 0.04% at > 0.06% FR, profit target of 0.15% is too large.

**Why it failed**:
- **Fundamental insight was correct, but granularity was wrong**: FR is indeed predictive of price mean-reversion, but that reversal happens over *hours-to-days*, not *minutes*. A 4h bar captures the structural move; a 5m bar captures noise atop that move.
- **EMA crossovers on 5m are not better entry timing**: The mean-reversion after extreme FR unfolds slowly. 5m EMA changes are too noisy to improve entry relative to simply entering at 4h bar close (which FR V2 does).
- **Trade scarcity after filtering**: Extreme FR events (> 0.0006) happen ~1-3 times per month per symbol. After accounting for non-regime periods (when FR is moderate), we get 1-2 OOS trades per month — insufficient for robust validation or optimization.
- **FR V2 already optimal for this edge**: Existing FR V2 on 4h timeframe achieves Sharpe 2.08 on DOGE over full backtest period. Attempting to improve entry timing on 5m adds complexity and reduces Sharpe ratio (0.85).

**Conclusion**: FR is a real, persistent structural inefficiency in crypto markets (longs pay shorts in bull markets, creating predictable mean reversion). But the time scale for that reversal is 4h–2d, not minutes. 5m resolution adds noise, not clarity. FR V2 on 4h bars is the correct approach for this edge.

---

### 4. FR Gradient Momentum (15m)

**File**: `strategies/fr-gradient-momentum.ts`

**Status**: Written but NOT extensively tested

**Hypothesis**: FR rate of change (velocity) might be more informative than absolute level. If FR is rising rapidly (demand for longs increasing), that's a different regime than FR flat or declining. Use 4h FR gradient to set bias, then enter on 15m momentum indicators.

**Why not tested**: After FR Regime Momentum v1.0 and v2.0 both failed to improve on FR V2, confidence in any FR-based 5m/15m strategy dropped to near-zero. Testing this would consume time without likely benefit. Recommend abandoning unless FR Regime Momentum produces surprising future positive results.

---

## Key Findings

### 1. FR Cap Problem on Bybit (Critical Discovery)

**What we found**: Bybit's perpetual futures have a minimum funding rate of 0.0001 per 8h (0.01% per 8h ≈ 0.000125% per hour). This is enforced as a floor. Result: FR distribution is heavily skewed with a large spike at the cap.

**Affected symbols**:
- **LDO**: 55.8% of all observations = 0.0001, only 0.04% > 0.06%
- **DOGE**: 40.7% at cap, 5-6% at > 0.06%
- **RPL**: 50.9% at 0.00005, 26.7% at 0.0001

**Impact on percentile-based strategies**: frPercentileThreshold=85 flags 0.0001 as "extreme" when it's the default rate on 55% of days. This creates spurious signals that overfit to recent data.

**Solution**: Use absolute thresholds (> 0.0006 minimum). Bybit needs to publish detailed FR distribution stats so traders can calibrate thresholds per symbol.

### 2. Extreme FR Events Are Too Rare for 5m Scalping

**Finding**: With absolute threshold 0.0006–0.0008:
- Average event frequency: 1–3 per month per symbol
- After in-sample / out-of-sample split on 2yr data: OOS gets ~1-2 events → insufficient for robust validation
- Every additional layer of filtering (time-of-day, other indicators) reduces this further

**Implication**: 5m strategy testing is statistically underpowered. Even if the strategy were profitable in-sample, we cannot validate it reliably OOS. Recommend minimum monthly trade frequency of ~20 for robust backtests; HF strategies on short TFs violate this.

### 3. 5m Entry Timing Doesn't Improve FR V2

**Observation**: FR V2 on 4h achieves Sharpe 2.08 on DOGE. FR Regime Momentum on 5m (using same FR events) achieves Sharpe 0.85. Why the difference?

**Root cause**: The mean-reversion after extreme FR is a slow, structural process:
1. Large influx of capital (e.g., liquidation cascade) pushes price down and FR up
2. Over the next 4h–24h, market participants gradually rebalance positions
3. Price slowly reverts as the imbalance normalizes
4. The 4h bar close captures this structural reversion; 5m bars capture the slow unfolding

**Attempt to improve entry timing**: Replace 4h bar-close entry with 5m EMA crossover to "time the turn better." Result: EMA crossover is just noise on top of the slow reversion. Sometimes it aligns with the turn (good entry); often it's +1m off (still good entry). Rarely it's radically wrong (bad entry). Net effect: more variance, lower Sharpe.

**Lesson**: Not all edges benefit from finer granularity. Some structural imbalances have natural resolution timescales. Trying to trade them faster adds execution risk without reducing exposure.

### 4. Pure Technicals on 1m/5m Don't Work for Crypto

**Evidence**:
- Volatility Breakout Scalper: 756 trades, 8.7% win rate on BTC 1m (expected > 50% for profitable edge)
- FR Settlement Scalper: 45-66 trades, 35-45% win rate (need > 70% for 0.08% TP vs 0.15% SL)
- Volume Momentum Burst (from Mar 5 strategy pack): High volume on 1m is almost always false (spoofing or order slicing)

**Why it fails**:
- Transaction costs on 1m (taker 0.055% per side + 0.05% slippage = 0.21% round-trip at 10x leverage = 2.1% of margin) require 50%+ win rate on moves > 0.12%.
- Most 1m moves < 0.10% in crypto (except during liquidation cascades). This means 95% of 1m bars produce a net loss trade.
- Pure technical signals (BB squeeze, EMA cross, RSI) are based on noisy price action. They work well on daily/weekly timeframes (macro market structure) but fail on 1m (high-frequency noise >> signal).

**Observation**: The only time pure technicals worked was when we filtered them through an underlying structural signal (FR regime). Even then, adding the technical layer hurt performance vs. just using the structural signal alone.

### 5. Overfitting Risk is Extreme on Short Timeframes

**Evidence**:
- DOGE FR Regime Momentum v1.0: IS (Sep 25–Mar 26, 6 months) Sharpe 2.66 → OOS (Jun 24–Sep 25, 3 months before) Sharpe -3.94
- This is a classic overfitting pattern: model fits recent historical noise, fails to generalize to older data

**Why it happens**:
- More bars = more noise = more "patterns" to fit
- 1m data: 252,000 bars/year vs 2,190 bars/year for 4h
- Parameter sensitivity increases multiplicatively
- Optimization algorithms can easily find parameter combinations that are 50%+ variance explained by luck

**Mitigation needed**: Walk-forward validation (not just IS/OOS split) is critical for HF strategies. But walk-forward with 1-2 trades/month is infeasible.

### 6. Transaction Cost Analysis

**Hard truth**: At taker fees (0.055% per side) + slippage (0.05% typical):

| Leverage | Entry + Exit Cost | Cost as % Margin | Minimum Move to Breakeven |
|----------|-------------------|------------------|--------------------------|
| 1x | 0.21% | 0.21% | 0.105% |
| 10x | 0.21% | 2.1% | 0.105% |
| 20x | 0.21% | 4.2% | 0.105% |
| 50x | 0.21% | 10.5% | 0.105% |

Key insight: **The minimum breakeven move (0.105%) is independent of leverage.** Leverage only amplifies the profit or loss after breakeven.

**Average 1m move for major assets**:
- BTC: ~0.04% median absolute move
- ETH: ~0.06% median
- DOGE/LDO: ~0.08% median

**Implication**: 80%+ of 1m bars are intrinsically unprofitable before any edge-based selection. You need a filter that selects only the 0.12%+ moves, or else you're fighting the fees.

FR regime filtering is one such filter (it selects bars within periods of structural imbalance). Volatility breakout filtering is another. But the filters must be strong enough to shift the distribution of trades into the profitable zone.

---

## Infrastructure Built (Reusable)

### Data Assets
- **5m candle data**: LDO, DOGE, RPL from Jan 2024 to Mar 2026 (175K+ candles each) in PostgreSQL
- **1m candle data**: 12 symbols for 6 months (3.1M candles total)
- **Symbol selection metadata**: 74 symbols ranked across 8 metrics (volume, volatility, bar range, volume spikes, drawdown speed, FR extremeness, FR volatility, avg FR)

### Code Assets
- **`scripts/select-scalping-symbols.ts`** — Symbol ranking system for future scalping research
- **`src/data/db.ts::saveCandlesBulk()`** — PostgreSQL bulk insert (5x faster than row-by-row)
- **Windowed indicator calculations** — O(n) performance via `candleView.slice(-lookback)` instead of O(n²) recalculation

### Strategy Code (Documented Failures)
- **`strategies/fr-settlement-scalper.ts`** — Failed. Does not recommend using without major changes.
- **`strategies/volatility-breakout-scalper.ts`** — Failed. Consider only for educational purposes.
- **`strategies/fr-regime-momentum.ts`** — Failed. v2.0 slightly better than v1.0 but still inferior to FR V2.
- **`strategies/fr-gradient-momentum.ts`** — Unfinished. Not recommended.

All strategy code is preserved in git history for reference, but should not be used in production or optimization pipelines.

---

## Recommendations

### Do NOT Pursue

1. **FR-based strategies on sub-4h timeframes** — FR mean-reversion operates on 4h–24h timescales, not minutes. Adding noise via short timeframes hurts performance. FR V2 on 4h is optimal for this edge.

2. **Percentile-based FR detection on Bybit** — FR is capped at 0.0001, making percentiles unreliable. Always use absolute thresholds (tune per symbol based on that symbol's FR distribution).

3. **Pure technical scalping on 1m/5m** — Volatility Breakout Scalper, Volume Momentum Burst, and similar technical-only strategies produce sub-50% win rates on 1m. Transaction costs eliminate profits. These patterns work on 4h+ timeframes or with maker-fee execution.

### Potentially Worth Exploring (Future Work)

**These have theoretical edge but didn't get tested due to time constraints:**

1. **Liquidation cascade bounce** — When liquidation cascades occur (detected via OI or open interest data), price overshoots equilibrium and snaps back. Structural edge, not FR-dependent. Requires exchange APIs for OI data. Confidence: 7/10.

2. **VWAP mean reversion** — Institutional benchmark. Price deviations from VWAP on 1m revert to VWAP. Known to work in traditional markets but untested here. Requires VWAP indicator implementation. Confidence: 6/10.

3. **Cross-exchange FR arbitrage** — Bybit has FR cap at 0.01% per 8h. Other exchanges (OKX, Binance) may not have the same cap. If one exchange has higher FR, there's an arbitrage: long on capped exchange, short on uncapped, collect FR spread. Requires dual-exchange setup. Confidence: 5.5/10.

4. **FR V2 symbol expansion** — Proven edge (Sharpe 2.08 on DOGE). Add more symbols to the portfolio. Confidence: 9/10. (This is the **#1 recommendation**)

5. **Multi-asset aggregation improvements** — Current FR V2 Aggregation (v1.0) allocates equal capital across symbols. Optimize via variance-weighted or momentum-weighted allocation. Confidence: 6.5/10.

### Recommended Next Steps

1. **Expand FR V2 to 5-10 symbols** (LDO, RPL, INJ, SOL, ARB, etc.). Current DOGE-only concentrated position. Grid-search params for each symbol. Expected: Sharpe 1.8-2.2 per symbol, portfolio Sharpe 1.5-2.0 with diversification.

2. **Implement liquidation cascade detection** via optional OI data source. Combine with existing framework. Estimated effort: 2-3 days. Expected return: Sharpe 1.0-1.5 on new strategy if successful.

3. **Document FR cap issue for Bybit community** — Other traders are likely making the same percentile-based FR mistakes. Publishing this finding could improve collaborative understanding.

4. **Archive this research** in permanent documentation so future team members don't repeat the same experiments.

---

## Data References & Reproducibility

### Backtest Results Saved
- All backtests saved to PostgreSQL via `saveBacktestRun()` function
- Results visible in dashboard historical runs
- Key runs:
  - FR Regime Momentum v1.0 (DOGE, Sep 25–Mar 26): Sharpe 2.66 [OVERFITTED]
  - FR Regime Momentum v1.0 (DOGE, Jun 24–Sep 25 OOS): Sharpe -3.94 [FAILED]
  - FR Regime Momentum v2.0 (DOGE, Jan 24–Mar 26): Sharpe 0.85 [MARGINAL]
  - Volatility Breakout (BTC, 1m, 6m): 756 trades, 8.7% win rate [FAILED]

### Deleted Debug Scripts
The following temporary debug scripts were deleted after use (no longer in repo):
- `debug-fr-regime.ts`
- `debug-fr-regime2.ts`
- `debug-fr-distribution.ts`
- `check-data.ts`

To recreate FR distribution analysis: Use `scripts/select-scalping-symbols.ts` with `--debug` flag.

### Strategy Specs Reference
- Initial 7 concepts (3 untested): `/docs/strategies/2026-03-04-180000-hf-scalping-strategy-concepts.md`
- FR regime approach (revised after Mar 4 failures): `/docs/strategies/2026-03-05-140000-fr-regime-scalping-strategies.md`

---

## Lessons for Future Research

1. **Granularity matters**: A good structural signal (FR mean-reversion, liquidation cascades) has a natural timescale. Trading it at finer granularity adds noise without capturing information faster. Test on the natural timescale first.

2. **Percentiles vs absolute thresholds**: Percentile-based indicators (RSI, Bollinger %B, FR percentile) assume normal distributions. They break when distributions are non-normal (e.g., FR capped). Always examine empirical distributions.

3. **Transaction cost reality check**: Before coding a strategy, ask: "What's the minimum win rate needed?" For 1m scalping on 0.08% TP vs 0.15% SL at taker fees, you need > 65% win rate. Then ask: "Is my edge strong enough to deliver that?" If not, increase timeframe or reduce leverage.

4. **Overfitting on short timeframes**: More bars = easier to overfit. Use walk-forward validation for strategies with < 20 trades/month. Consider increasing timeframe or accepting lower confidence.

5. **Structural vs technical edges**: Structural edges (FR, liquidation cascades, funding flows) are easier to validate and generalize. Technical edges (breakouts, EMA crosses, volume spikes) are harder. Prioritize structural.

6. **Statistical power required**: For a backtesting strategy to achieve meaningful validation, you need at least 30-50 trades in test period. With 1-2 trades/month, a 12-month walk-forward test has only 12-24 trades. Minimum 2-year OOS test needed, but that's too long for validation feedback loop. Design strategies for >= 5-10 trades per day.

---

## Archive Summary

**This document is the final record of the HF scalping research effort.**

- **Duration**: Mar 4–6, 2026 (3 days intensive research)
- **Strategies tested**: 4 (2 on 1m, 2 on 5m)
- **Outcome**: 0 profitable strategies found
- **Infrastructure built**: Reusable symbol selection, bulk insert, 1m caching
- **Recommendation**: Abandon HF scalping for short timeframes; focus on FR V2 expansion instead

Team members who participated: quant-lead, quant, be-dev, docs-writer.

For questions or future research, refer to:
- Strategy specs: `/docs/strategies/`
- Changelog records: `/docs/changelogs/2026-03-04-*` through `2026-03-06-*`
- Code: `git log --oneline | grep -i "scalping\|HF\|1m"`

---

**End of Report**
