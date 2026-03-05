# Comprehensive Research Directions Assessment

> **Created**: 2026-03-05 20:00
> **Author**: quant-lead agent (opus)
> **Status**: Strategic Assessment - Decision Document
> **Context**: Assessing ALL viable research directions before choosing next focus

---

## Track Record Summary (Ground Truth)

Before assessing anything, here is what we KNOW works and does not work:

| Strategy | Timeframe | Result | Sharpe | Status |
|----------|-----------|--------|--------|--------|
| FR Spike V2 | 4h | **SUCCESS** | 2.08 | Production paper trading |
| FR Settlement Scalper | 1m | **FAILED** | Negative | Too noisy, fees kill edge |
| Volatility Breakout Scalper | 1m | **FAILED** | Negative | False breakouts, fees |
| HF Scalping (all concepts) | 1m | **CONCLUDED: No viable edge** | N/A | Abandoned |
| PM Mean Reversion | 1h | **MARGINAL** | Variable | ~$500-2K/yr ceiling, fragile |
| Pairs (Z-score, Bollinger, etc.) | Various | **MIXED** | Variable | Some show promise, not production-ready |
| FR Gradient Momentum | 5m | **UNTESTED** | Unknown | Implemented, needs testing |
| FR Regime Momentum | 5m | **UNTESTED** | Unknown | Implemented, needs testing |

**Key lesson**: Our ONLY proven edge is structural funding rate mean reversion on 4h. Everything at 1m has failed. Everything purely technical has failed. The edge comes from exploiting a structural market mechanic, not from pattern recognition.

---

## Category A: Funding Rate Strategies

### A1. FR V2 Optimization / Portfolio Expansion
**One-line**: Improve the already-working FR V2 by expanding asset universe, tuning parameters, and testing aggregation configs.

- **Edge type**: Structural (proven)
- **Confidence**: 9/10
- **Why it might work**: FR V2 already works at Sharpe 2.08. The optimization research doc identifies 5 concrete experiments: V1 top performers with V2 code (no trend filter), expanding to 50+ assets, cross-sectional momentum portfolio, OI+FR composite signal, and decorrelated multi-basket configs. These are incremental improvements to a proven strategy -- the lowest-risk research path.
- **Why it might NOT work**: We may already be near the ceiling. The current 6-asset config was selected from a 29-symbol scan. Expanding further may add noise without signal. Diminishing returns from parameter optimization.
- **Data requirements**: Already have everything. FR data cached, 4h candles cached.
- **System readiness**: Ready NOW. All infrastructure exists.
- **Development effort**: 1-2 days per experiment, ~1 week total for all 5 experiments.
- **Expected edge after costs**: Incremental improvement. Current production config: Sharpe 1.88 aggregated. Goal: push to 2.0+ with better asset selection or Sharpe 1.5+ with more diversified portfolio (lower risk). Transaction costs already accounted for in V2 (4h trades are infrequent, ~0.1% round-trip on spot-equivalent).

### A2. FR Regime Momentum Rider (5m entry, 4h FR regime filter)
**One-line**: Use 4h FR extremes as the regime filter (when to trade) and 5m price action for precise entry timing.

- **Edge type**: Structural (FR regime) + Technical (5m entry)
- **Confidence**: 6/10
- **Why it might work**: FR V2 enters imprecisely at 4h bar close. By dropping to 5m for entry after detecting a 4h FR extreme, we might get better entries (tighter stops, more of the move captured). Already implemented in `fr-regime-momentum.ts`. The core edge (FR extremes) is proven; this is an execution improvement.
- **Why it might NOT work**: Our 1m scalping failures proved that short-timeframe execution in crypto is dominated by noise. 5m is better than 1m, but it is still noisy. The "better entry" thesis assumes the mean-reversion move has a clean 5m signature -- it may not. The FR extreme signal might work BECAUSE it is coarse (4h smooths noise); adding 5m granularity might just add noise without improving entries. Also: if FR V2 is already catching the move at 4h, the marginal improvement from better entries may be small relative to the added complexity and failure modes.
- **Data requirements**: Need 5m candle data (can be fetched, not cached). FR data already cached.
- **System readiness**: Strategy already implemented. Need to cache 5m data and run backtests.
- **Development effort**: 0.5 days (strategy exists, just needs testing).
- **Expected edge after costs**: If it works, maybe 10-20% improvement over FR V2 per-trade. But the additional complexity (multi-TF, more parameters) risks overfitting. Net expected improvement: marginal. The 5m timeframe introduces taker fees on more frequent entries/exits.

### A3. FR Gradient Momentum
**One-line**: Trade the rate of change of funding rate rather than its absolute level.

- **Edge type**: Statistical / Structural hybrid
- **Confidence**: 5/10
- **Why it might work**: The gradient (rate of change) of FR might predict the reversal better than the absolute level. A rapidly decelerating FR might signal the peak before the absolute level hits the extreme percentile. Already implemented in `fr-gradient-momentum.ts`.
- **Why it might NOT work**: Gradient signals are inherently noisier than threshold signals. FR data is only every 8h, so the "gradient" is computed from sparse data points. This means the gradient is itself noisy. FR V2 works precisely because it uses a simple threshold on extreme values -- adding gradient complexity may not help.
- **Data requirements**: Already have everything.
- **System readiness**: Strategy already implemented. Ready for testing.
- **Development effort**: 0.5 days (testing only).
- **Expected edge after costs**: Uncertain. If gradient provides earlier signal, could improve R:R. But noisier signal means more false entries and higher costs.

### A4. Front-Running FR Arbitrageurs (User's New Idea)
**One-line**: Position BEFORE funding rate settlement to profit from the predictable flow of spot-perp arb traders who must execute before settlement.

- **Edge type**: Structural / Microstructure
- **Confidence**: 3/10
- **Why it might work**: The thesis is logical: when FR is high positive, arb traders will short perps and buy spot to collect funding. This creates pre-settlement selling pressure on perps. If we can predict this flow and position ahead of it, we capture the price impact. This is different from FR Settlement Scalper (which tried post-settlement mean reversion) -- this is about pre-settlement flow front-running.
- **Why it might NOT work -- CRITICAL ANALYSIS**:

  1. **We already tested the settlement window and it failed.** The FR Settlement Scalper explicitly tried to trade around settlement windows on 1m. The pre-settlement drift was not detectable in our data. The user correctly notes this new idea is "before" rather than "after" settlement, but the same noise problem applies: the 30-60 minute pre-settlement window on 1m is dominated by random price action.

  2. **Arb traders do NOT create net price impact.** This is the fundamental flaw in the thesis. A funding rate arbitrageur doing spot-perp arb takes OFFSETTING positions: they short the perp AND buy spot simultaneously. The spot purchase offsets the perp short. Net market impact is approximately zero because they are hedging. The only price impact would be if arb traders are doing the trade on different venues or with different timing for each leg -- and sophisticated arb bots execute both legs simultaneously to minimize market impact.

  3. **The flow is already priced in.** Any predictable pre-settlement flow would be immediately arbitraged by other participants. If there were a reliable 0.15% drift before settlement, market makers would front-run it, eliminating the edge. This is a textbook efficient market argument -- predictable flows get priced in rapidly, especially in crypto where there are no barriers to entry for automated trading.

  4. **Empirical evidence is absent.** Despite extensive searching, I found no academic paper or empirical study documenting a systematic pre-settlement price drift in crypto perpetual futures. The Ruan & Streltsov paper documents a U-shaped activity pattern within 8h cycles, but higher activity does not equal directional drift. Multiple Amberdata and Coinbase research articles discuss funding mechanics without mentioning pre-settlement drift as a tradeable phenomenon.

  5. **Timing precision required is extreme.** To front-run arb bots, you need to be faster than them. Our system trades at bar close on 1m candles. Professional arb bots execute in milliseconds. We cannot front-run entities that are orders of magnitude faster than us.

  6. **FR Settlement Scalper failure is dispositive.** The Settlement Scalper was designed to capture EXACTLY this kind of settlement-window price anomaly. It included pre-settlement entry logic. It failed. The new idea is a subtle variant (before vs. after, arb flow vs. mean reversion) but the underlying assumption -- that settlement windows create exploitable price patterns on short timeframes -- has already been empirically refuted by our own testing.

- **Data requirements**: 1m candles + FR data (have both).
- **System readiness**: Could implement quickly, but the FR Settlement Scalper already covers this conceptual territory.
- **Development effort**: 1 day.
- **Expected edge after costs**: **Near zero or negative.** The thesis has fundamental logical flaws (arb traders create zero net impact) and our empirical evidence (Settlement Scalper failure) already disproves the underlying assumption. Transaction costs on 1m would further erode any residual signal. **I strongly recommend NOT pursuing this.**

### A5. FR Post-Settlement Momentum (from FR Regime Strategy Pack)
**One-line**: After an 8h settlement with extreme FR, trade the "relief move" as position pressure dissipates post-settlement.

- **Edge type**: Structural
- **Confidence**: 5/10
- **Why it might work**: After settlement with extreme FR, the positioning pressure that caused the FR extreme dissipates. This could create a predictable post-settlement move. This is what FR Settlement Scalper tried on 1m and failed -- but the FR Regime pack version uses 5m with a 4h FR regime filter, which is a meaningfully different approach.
- **Why it might NOT work**: FR Settlement Scalper already tested this hypothesis on 1m and found no exploitable signal. Moving to 5m with a regime filter may help, but the underlying post-settlement move may simply not exist in a clean, tradeable form. The "relief move" thesis assumes positions are closed after settlement, but arb positions are typically held through multiple settlements.
- **Data requirements**: 5m + FR data.
- **System readiness**: Could test using existing infrastructure.
- **Development effort**: 1 day.
- **Expected edge after costs**: Uncertain. Better than 1m version due to lower noise, but still testing a hypothesis that failed on a nearby timeframe.

---

## Category B: Pure Technical / Scalping Strategies

### B1. Volatility Regime Transition (BB Squeeze Breakout)
**One-line**: Detect BB squeeze on 1m, trade the breakout with volume confirmation.

- **Edge type**: Technical / Microstructure
- **Confidence**: 2/10
- **Why it might work**: Volatility clustering is well-documented in crypto. Squeeze breakouts can be explosive.
- **Why it might NOT work**: **We already tested this and it FAILED.** The Volatility Breakout Scalper was this exact concept. False breakouts dominate on 1m. Fees eat all profits. The HF scalping investigation concluded "no viable edge found" on 1m after testing multiple variants. There is no reason to believe trying again will produce a different result.
- **Expected edge after costs**: **Negative. Do not pursue.**

### B2. Volume-Weighted Momentum Burst (1m)
**One-line**: Detect 5x volume spikes on 1m with directional price, ride momentum for 3-10 minutes.

- **Edge type**: Microstructure
- **Confidence**: 2/10
- **Why it might work**: Informed trades create temporary momentum.
- **Why it might NOT work**: Same problems as all 1m strategies. Our HF investigation already covered this category. Without order book data, we cannot distinguish informed flow from noise/manipulation. On liquid pairs like BTC/USDT, volume spikes are rarely informative. Fees on 1m round-trips are prohibitive.
- **Expected edge after costs**: **Negative. Do not pursue.**

### B3. Multi-TF Momentum Alignment (1m with constructed 5m/15m/1h)
**One-line**: Only scalp when 1m, 5m, 15m, and 1h momentum all align.

- **Edge type**: Technical
- **Confidence**: 2/10
- **Why it might work**: Multi-TF alignment increases signal quality.
- **Why it might NOT work**: Alignment is a filter that reduces trade count, but the base signal (1m momentum) has no edge. Filtering noise does not create signal. Our 1m testing proves the base timeframe is unprofitable. Additionally, full alignment occurs infrequently and often at the END of moves, not the beginning.
- **Expected edge after costs**: **Negative. Do not pursue.**

### B4. Time-of-Day Seasonality (21:00-23:00 UTC)
**One-line**: Buy at 21:00 UTC, sell at 23:00 UTC, exploiting documented Asian session opening seasonality.

- **Edge type**: Calendar / Behavioral
- **Confidence**: 4/10
- **Why it might work**: QuantPedia research documents ~33% annualized returns for a simple buy-21:00-sell-23:00 strategy with lower volatility than buy-and-hold. The timezone effect is structural (driven by session overlaps). The turn-of-the-candle effect (PMC 2023) shows 0.58 bps/min concentrated at 15-min boundaries.
- **Why it might NOT work**: The research is primarily from 2019-2022. Market microstructure has evolved significantly since then (more algorithmic trading, more 24/7 participation). Calendar anomalies are the most vulnerable to crowding -- once documented, they get arbitraged away. The edge per trade is tiny (~0.15-0.30%), making it vulnerable to fees. Requires 30-50x leverage to generate meaningful returns, which is extremely risky for a marginal edge. Weekend effects and macro events override seasonality.
- **Data requirements**: 1m or 1h candles with timestamp parsing. Have this.
- **System readiness**: Ready now.
- **Development effort**: 0.5-1 day.
- **Expected edge after costs**: Small but possibly positive on 1h timeframe (not 1m). Estimated 5-15% annualized after costs WITHOUT leverage. With 20x leverage: 100-300% but with proportional drawdown risk. **Worth a quick test on 1h, but do not invest heavily.**

---

## Category C: Structural / Microstructure Strategies

### C1. Liquidation Cascade Bounce
**One-line**: Detect liquidation cascades via rapid consecutive bearish bars + volume surge, then buy the bounce.

- **Edge type**: Structural
- **Confidence**: 4/10
- **Why it might work**: Liquidation cascades are mechanical (forced market sells) and overshoot equilibrium. The October 2025 cascade erased $19B in OI in 36 hours. Post-cascade bounces are well-documented. The edge source (forced selling is price-insensitive) is structurally sound.
- **Why it might NOT work**: Without open interest or liquidation data, cascade detection from OHLCV alone is imprecise -- a sharp 3-bar drop could be a cascade or a trend continuation. Some cascades ARE genuine trend breaks, not bounces (catching a falling knife). Our system cannot distinguish between these without additional data. On 1m, this is just another version of the 1m strategies that all failed. On 4h, genuine cascades are rare (maybe 2-5 per year per asset), giving insufficient trade count.
- **Data requirements**: Ideally need open interest + liquidation data (do not have). OHLCV-only proxy is imprecise.
- **System readiness**: OHLCV-only version could be tested now. OI version needs data integration.
- **Development effort**: 1 day for OHLCV proxy, 3-5 days for OI integration.
- **Expected edge after costs**: Highly uncertain. The concept is sound but detection without proper data is the bottleneck. On 15m-1h timeframe (not 1m), might work for major cascades. But trade count will be very low, making statistical validation difficult.

### C2. Open Interest Divergence Strategy
**One-line**: Trade when OI is rising/falling but price is moving in the opposite direction (divergence signals).

- **Edge type**: Structural
- **Confidence**: 5/10
- **Why it might work**: Rising OI + falling price = new shorts opening = potential short squeeze setup. Falling OI + rising price = long profit-taking = potential top. OI divergences from price are a well-known futures analysis tool. The FR V2 optimization research (Experiment 4) already identified OI+FR composite signal as a promising enhancement.
- **Why it might NOT work**: OI data is not currently in our system. The signal is slow-moving (works on 4h/1d, not 1m). Adding OI to FR V2 as a filter may help, but as a standalone strategy it may not have enough edge.
- **Data requirements**: Need OI data from Bybit/Binance API. NOT currently cached.
- **System readiness**: Needs data integration work.
- **Development effort**: 3-5 days (data pipeline + strategy).
- **Expected edge after costs**: As a FR V2 enhancement: potentially significant. As standalone: uncertain. Best pursued as Experiment 4 from the FR V2 optimization research.

---

## Category D: Pairs / Correlation Strategies

### D1. Crypto Pairs Trading (Cointegration-Based)
**One-line**: Trade cointegrated crypto pairs (e.g., BTC-ETH) when their spread deviates significantly from equilibrium.

- **Edge type**: Statistical
- **Confidence**: 5/10
- **Why it might work**: Recent academic research (Frontiers, 2026) shows deep learning-based cointegration pairs trading on crypto can achieve 43.4% portfolio return in a 6-month window for BTC-ETH. Cointegration provides a stronger statistical foundation than correlation. Multiple strategies already implemented in our system (Z-score, Bollinger, RSI divergence, Kalman, HTF mean reversion).
- **Why it might NOT work**: Our existing pairs strategies have shown MIXED results. Cointegration in crypto is unstable -- pairs that were cointegrated in 2024 may not be in 2025. The optimization doc for pairs showed inconsistent walk-forward results. Market regime changes break cointegration relationships. Transaction costs on two-legged trades are double. Our system architecture (single-symbol per backtest) makes true pairs trading awkward.
- **Data requirements**: Multi-symbol data. Have this via CCXT.
- **System readiness**: Multiple strategies implemented. Testing infrastructure exists.
- **Development effort**: 0 days (strategies exist). Testing: 1-2 days.
- **Expected edge after costs**: Moderate but fragile. The 12% monthly return claim from academic papers is likely overstated (does not account for realistic execution, slippage, and cointegration breakdown). Realistic expectation: 0-30% annual with significant periods of drawdown. **Worth revisiting with fresh data but not a primary focus.**

---

## Category E: Polymarket Strategies

### E1. PM Mean Reversion (Existing)
**One-line**: Bollinger Band mean reversion on prediction market prices.

- **Edge type**: Behavioral (overreaction)
- **Confidence**: 3/10
- **Why it might work**: Academic evidence for overreaction in prediction markets exists. Our 50% in-sample hit rate across 129 markets suggests some signal.
- **Why it might NOT work**: Thoroughly assessed in the PM Critical Assessment doc. 20% walk-forward pass rate is poor. Edge is ~$500-2K/year on $10K. Cannot reliably select profitable markets in advance. Transaction costs (1% slippage per side) consume most theoretical edge. Data windows too short for statistical significance. Bounded price dynamics may inflate apparent profitability.
- **Expected edge after costs**: **$500-2K/year at best. Not worth further investment as a technical strategy.**

### E2. PM Information Edge / Cross-Platform Arb
**One-line**: Exploit information advantages or cross-platform price discrepancies on prediction markets.

- **Edge type**: Informational
- **Confidence**: 2/10
- **Why it might work**: In theory, having better probability estimates than the market would generate alpha.
- **Why it might NOT work**: Requires domain expertise in specific markets. Cannot be backtested in traditional sense. Average arb opportunity duration has dropped to 2.7 seconds (from 12.3s in 2024). 73% of arb profits captured by sub-100ms bots. Only 0.51% of Polymarket wallets achieve profits exceeding $1,000. We are not competitive in this space.
- **Expected edge after costs**: **Near zero for automated strategies. Not viable without domain expertise and sub-second execution.**

---

## Category F: Other Ideas Not Yet Considered

### F1. On-Chain Metrics as FR V2 Regime Filter
**One-line**: Add MVRV Z-score, SOPR, or NVT as a macro regime filter on top of FR V2.

- **Edge type**: Structural / Fundamental
- **Confidence**: 5/10
- **Why it might work**: On-chain metrics like MVRV Z-score provide a macro view of market valuation (overvalued/undervalued). When MVRV is extremely high (>3), the market is overvalued and contrarian short signals from FR V2 would have higher conviction. When MVRV is low (<1), long signals have higher conviction. SOPR below 1 means coins are moving at a loss (capitulation = buy signal). This adds a fundamentals layer to FR V2 that could improve win rate.
- **Why it might NOT work**: On-chain metrics are slow-moving (daily or weekly resolution). They would rarely filter out FR V2 signals because FR V2 already filters for extremes. The marginal improvement might be tiny. Requires external API integration (Glassnode, Santiment). Data quality and availability vary.
- **Data requirements**: Need on-chain data API. NOT currently available.
- **System readiness**: Needs data pipeline work.
- **Development effort**: 3-5 days (API integration + strategy modification).
- **Expected edge after costs**: Small incremental improvement to FR V2 win rate. Maybe 5-10% improvement in Sharpe if the macro filter correctly avoids regime-breaking trades. **Interesting but lower priority than simpler FR V2 optimizations.**

### F2. Cross-Exchange FR Arbitrage
**One-line**: Exploit funding rate differences between Binance, Bybit, and Hyperliquid for the same asset.

- **Edge type**: Structural
- **Confidence**: 4/10
- **Why it might work**: Different exchanges have different funding rates for the same asset. Binance settles every 8h, Hyperliquid every 1h. These timing differences create exploitable discrepancies. Gate.com research shows FR arb yields double-digit annualized during bullish phases (0.05-0.2% per 8h).
- **Why it might NOT work**: Our backtesting system is single-exchange. Cross-exchange arb requires capital on multiple exchanges, fast execution, and careful management of depeg risk. This is operationally complex and outside our system's architecture. Professional FR arb funds already dominate this space.
- **Data requirements**: Multi-exchange FR data. Not currently available.
- **System readiness**: NOT ready. Would need major architectural changes.
- **Development effort**: 2-3 weeks minimum.
- **Expected edge after costs**: Positive in theory but operationally complex. **Not suitable for our backtesting-focused platform.**

### F3. FR Cross-Sectional Momentum Portfolio
**One-line**: Rank all assets by FR magnitude and go long the bottom quintile (most negative FR) and short the top quintile (most positive FR).

- **Edge type**: Structural / Statistical
- **Confidence**: 6/10
- **Why it might work**: This is Experiment 3 from the FR V2 optimization research. Instead of trading each asset independently when its FR is extreme, rank all assets by FR and trade the most extreme ones. This is a classic cross-sectional momentum (or contrarian) approach adapted to funding rates. Academic carry trade literature shows this approach works in FX (Lustig et al., 2011) and has been adapted to crypto (BIS Working Paper 1087, Sharpe 6.45).
- **Why it might NOT work**: Requires multi-asset portfolio management which our system does not fully support (single-symbol per backtest). Cross-sectional ranking requires simultaneous access to all assets' FR data. The aggregation config in production already approximates this via `single_strongest`, but a true cross-sectional approach would be more sophisticated.
- **Data requirements**: FR data for 20-50+ assets simultaneously. Partially available.
- **System readiness**: Partially ready via aggregation configs. True cross-sectional requires portfolio engine improvements.
- **Development effort**: 2-5 days (depending on portfolio engine scope).
- **Expected edge after costs**: Potentially significant. Cross-sectional approaches tend to be more robust than single-asset strategies because they diversify across many assets. **This is the most promising "new" FR strategy variant.**

### F4. Volatility-Adjusted FR V2 (ATR Scaling)
**One-line**: Scale FR V2 position sizes inversely with current volatility to normalize risk per trade.

- **Edge type**: Risk management improvement
- **Confidence**: 7/10
- **Why it might work**: FR V2 already has ATR-based exits but fixed position sizing. During high-vol periods, the same position size carries more risk. By scaling positions inversely with ATR (smaller in high vol, larger in low vol), we normalize the dollar-risk per trade. This is standard quantitative risk management and should improve Sharpe by reducing volatility of returns.
- **Why it might NOT work**: FR V2 may already capture this partially through the ATR volatility filter (which blocks entries during extreme vol). The additional complexity of dynamic sizing may not meaningfully improve results if the vol filter is already effective.
- **Data requirements**: Already have everything.
- **System readiness**: Ready now. FR V2 already has vol-adjusted sizing as an option.
- **Development effort**: 0.5 days (parameter tuning).
- **Expected edge after costs**: Small but reliable improvement. Maybe 5-15% Sharpe improvement through better risk normalization.

---

## Ranked Summary Table: Top 10 Research Directions

| Rank | Strategy | Category | Confidence | Edge Type | System Ready? | Effort | Expected Edge | Priority |
|------|----------|----------|------------|-----------|---------------|--------|---------------|----------|
| **1** | **FR V2 Optimization / Expansion** | A1 | **9/10** | Structural | YES | 1 week | Incremental on Sharpe 2.08 | **DO FIRST** |
| **2** | **FR V2 Vol-Adjusted Sizing** | F4 | **7/10** | Risk mgmt | YES | 0.5 days | +5-15% Sharpe | **DO FIRST** |
| **3** | **FR Cross-Sectional Momentum** | F3 | **6/10** | Structural | Partial | 2-5 days | Potentially large | **HIGH** |
| **4** | **FR Regime Momentum Rider** | A2 | **6/10** | Structural+Tech | YES | 0.5 days | Marginal improvement | **MEDIUM** |
| **5** | **FR Gradient Momentum** | A3 | **5/10** | Statistical | YES | 0.5 days | Uncertain | **MEDIUM** |
| **6** | **OI Divergence (FR V2 enhancement)** | C2 | **5/10** | Structural | NO (need OI data) | 3-5 days | Moderate | **MEDIUM** |
| **7** | **On-Chain Metrics Filter** | F1 | **5/10** | Fundamental | NO (need API) | 3-5 days | Small | **LOW** |
| **8** | **Time-of-Day Seasonality** | B4 | **4/10** | Calendar | YES | 1 day | Small-moderate | **LOW** |
| **9** | **Pairs (Cointegration Refresh)** | D1 | **5/10** | Statistical | YES | 1-2 days | Moderate but fragile | **LOW** |
| **10** | **Liquidation Cascade Bounce** | C1 | **4/10** | Structural | Partial | 1-5 days | Uncertain | **LOW** |

---

## What NOT To Pursue (and Why)

| Strategy | Why Not |
|----------|---------|
| **FR Arb Front-Running (User's idea)** | Arb traders create zero net price impact (hedged positions). Pre-settlement drift undetectable in our data (Settlement Scalper already tested this). We cannot out-speed millisecond arb bots. No empirical evidence supports the thesis. Confidence: 3/10. |
| **Any 1m scalping strategy** | Three separate strategies all failed on 1m. HF investigation formally concluded "no viable edge." Fees + noise dominate at this resolution. This is a dead end. |
| **Volatility Breakout Scalper variants** | Already failed. Pure technicals on 1m produce false breakouts. Adding filters does not fix the fundamental problem (no edge in the base signal). |
| **PM Technical Strategies** | Ceiling of $500-2K/year. 20% walk-forward pass rate. Cannot select profitable markets in advance. Marginal at best. |
| **Cross-Exchange FR Arb** | Outside our system architecture. Requires multi-exchange capital, sub-second execution, operational complexity beyond our platform. |

---

## The Honest Bottom Line

**Our portfolio of viable research has ONE proven edge: funding rate mean reversion.** Everything else is either unproven, failed, or marginal. This is not necessarily bad -- many successful quant funds are built on a single well-exploited edge.

The optimal path forward is:

### Tier 1: Exploit the Proven Edge Harder (Week 1-2)
1. Run the 5 FR V2 optimization experiments from the research doc
2. Test vol-adjusted sizing on FR V2
3. Test the already-implemented FR Regime Momentum and FR Gradient Momentum

### Tier 2: Expand the Edge (Week 3-4)
4. Build FR cross-sectional momentum portfolio (needs portfolio engine work)
5. Integrate OI data and test OI+FR composite signal
6. Quick test of time-of-day seasonality on 1h (low effort, worth a look)

### Tier 3: Diversify (Month 2+)
7. Revisit pairs trading with fresh 2025-2026 data
8. Investigate on-chain metrics as macro filter
9. Test liquidation cascade bounce with OI data (if OI pipeline built in Tier 2)

### Do Not Pursue
- FR Arb Front-Running (flawed thesis)
- Any 1m strategies (proven dead end)
- PM technical strategies (marginal economics)

---

## Detailed Analysis of the User's FR Arb Front-Running Idea

This deserves a deeper examination because the user specifically asked about it.

### The Thesis (Steel-Manned)

1. When FR is 0.10% (high positive), it costs $100 per $100K per 8h to hold a long
2. Arb traders will short the perp and buy spot to collect this $100
3. Their perp short creates selling pressure, pushing the perp price down before settlement
4. We can front-run this selling pressure by going short before the arb traders execute

### Why This Thesis Fails (Detailed)

**Problem 1: No net directional pressure.** When an arb trader shorts the perp, they simultaneously buy spot. If both trades occur on the same venue or through connected order books, the net market impact is zero. The spot buy offsets the perp sell. Even if the trades are on different venues, the aggregate crypto market sees equal buying and selling pressure.

**Problem 2: Arb positions are already on before settlement.** The thesis assumes arb traders ENTER positions right before settlement. In reality, sophisticated FR arb traders maintain their positions across MULTIPLE settlement periods. They do not open and close every 8 hours -- that would incur excessive transaction costs. The carry trade research from BIS (Working Paper 1087) confirms that FR arb is a long-term strategy, not a settlement-by-settlement trade. So there is no "rush of arb positioning" before each settlement.

**Problem 3: The flow that DOES exist is too small to trade.** Some retail arb traders do enter positions shortly before settlement (within 5-15 minutes). But the volume of this flow is tiny relative to overall market volume on liquid perps like BTC/USDT. The price impact is immeasurable.

**Problem 4: We already empirically tested this hypothesis.** The FR Settlement Scalper was designed to capture settlement-window price anomalies. It included logic to detect pre-settlement price drift when FR was extreme. It found no consistent, exploitable pattern. The new framing ("front-running arb traders" vs. "settlement mean reversion") does not change the underlying data -- if there were a pre-settlement drift, our Settlement Scalper would have detected it.

**Problem 5: Even if the flow existed, we cannot front-run it.** Professional arb bots execute in milliseconds. Our system processes 1m candles. By the time we detect the flow and enter, the opportunity (if any) has already been captured.

**Conclusion**: The FR Arb Front-Running idea is intellectually interesting but empirically and theoretically unsound. The FR Settlement Scalper already served as the empirical test, and it failed. The additional theoretical analysis (arb traders create no net impact, positions are already on, flow is too small) further undermines the thesis. **Confidence: 3/10. Do not pursue.**

---

## References

### Academic Papers
- [Perpetual Futures Pricing](https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf) - Ackerer, Hugonnier, Jermann (Wharton)
- [Predictability of Funding Rates](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5576424) - Emre Inan (SSRN 5576424)
- [Designing Funding Rates for Perpetual Futures](https://arxiv.org/html/2506.08573v1) - Dai et al. (2025)
- [Exploring Risk and Return Profiles of FR Arbitrage](https://www.sciencedirect.com/science/article/pii/S2096720925000818) - ScienceDirect (2025)
- [Anatomy of Oct 2025 Crypto Liquidation Cascade](https://papers.ssrn.com/sol3/Delivery.cfm/5611392.pdf?abstractid=5611392&mirid=1) - Zeeshan Ali (SSRN 5611392)
- [Quantitative Alpha in Crypto Markets](https://papers.ssrn.com/sol3/Delivery.cfm/5225612.pdf?abstractid=5225612&mirid=1) - Systematic Review (SSRN 5225612)
- [Deep Learning-Based Pairs Trading: Crypto](https://www.frontiersin.org/journals/applied-mathematics-and-statistics/articles/10.3389/fams.2026.1749337/full) - Frontiers (2026)
- [BIS Working Paper 1087: Crypto Carry](https://www.bis.org/publ/work1087.pdf) - BIS (2023)
- [Turn-of-the-Candle Effect in Bitcoin](https://pmc.ncbi.nlm.nih.gov/articles/PMC10015199/) - PMC (2023)
- [Copula-Based Trading of Cointegrated Crypto Pairs](https://arxiv.org/pdf/2305.06961) - Tadi (2023)

### Industry Sources
- [Are There Seasonal Intraday Anomalies in Bitcoin?](https://quantpedia.com/are-there-seasonal-intraday-or-overnight-anomalies-in-bitcoin/) - QuantPedia
- [Liquidations in Crypto: Anticipating Volatile Moves](https://blog.amberdata.io/liquidations-in-crypto-how-to-anticipate-volatile-market-moves) - Amberdata
- [How $3.21B Vanished in 60 Seconds](https://blog.amberdata.io/how-3.21b-vanished-in-60-seconds-october-2025-crypto-crash-explained-through-7-charts) - Amberdata
- [Funding Rates Impact on Perpetual Swaps](https://blog.amberdata.io/funding-rates-how-they-impact-perpetual-swap-positions) - Amberdata
- [MVRV Ratio](https://academy.glassnode.com/market/mvrv/mvrv-ratio) - Glassnode
- [Perpetual Futures Explained](https://www.bitsaboutmoney.com/archive/perpetual-futures-explained/) - Bits About Money
- [Polymarket Strategies](https://cryptonews.com/cryptocurrency/polymarket-strategies/) - CryptoNews (2026)
- [Beyond Simple Arbitrage: 4 Polymarket Strategies](https://medium.com/illumination/beyond-simple-arbitrage-4-polymarket-strategies-bots-actually-profit-from-in-2026-ddacc92c5b4f) - Medium (2026)
