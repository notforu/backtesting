# Comprehensive Quantitative Strategy Assessment

**Date**: 2026-02-18
**Author**: quant-lead (opus)
**Status**: Strategic Assessment for Real Capital Deployment
**Scope**: All 15 strategies across crypto and prediction markets

---

## Executive Summary

After reviewing the entire strategy portfolio -- 15 implemented strategies across crypto directional trading, crypto pairs trading, and Polymarket prediction markets -- the honest assessment is:

**No strategy in the current portfolio has demonstrated sufficient statistical evidence of genuine edge to justify deploying real money with confidence.**

The best candidates are the CCI Momentum Breakout strategy on ETH/XRP (OOS Sharpe 0.62-0.81) and the EMA-MACD Trend Momentum strategy (OOS Sharpe 0.49 across multiple assets). However, both suffer from insufficient out-of-sample trade counts, untested robustness across market regimes, and the absence of live/paper trading validation. The pairs trading strategies show theoretical promise but produce returns too thin to survive realistic transaction costs at the 4-order-per-round-trip level. The Polymarket strategies operate in a market structurally unsuited to technical backtesting.

The path to deploying real money requires a fundamental shift: from generating more strategies to rigorously validating the 2-3 best ones through paper trading, rolling walk-forward windows, and Monte Carlo robustness tests.

---

## 1. Current Strategy Portfolio Assessment

### 1A. Crypto Directional Strategies (Single-Asset)

#### EMA-MACD Trend Momentum -- BEST OVERALL
- **Status**: Most promising directional strategy
- **Walk-Forward Results** (BTC/USDT, 4h, 2022-2024):
  - IS Sharpe: 0.32, OOS Sharpe: 0.49 (OOS **improved** over IS -- rare and encouraging)
  - OOS Return: +20.15%, Win Rate: 73%, 15 trades
- **Multi-Asset**: Positive OOS returns on all 4 tested assets (BTC +20%, ETH +5.4%, SOL +13.9%, XRP +3.2%)
- **What works**: Triple-filter approach (EMA crossover + MACD confirmation + ADX strength) rejects most false signals. ATR trailing stop adapts to volatility.
- **What does not work**: 15 OOS trades is below statistical significance threshold (30+). 0.49 Sharpe is below the 0.5 "promising" threshold. Untested in bear/crash regimes post-2024.
- **Edge assessment**: **C+ (Real but unproven).** The OOS improvement over IS is genuinely unusual and suggests the strategy captures structural trend-following dynamics rather than noise. But the sample size is too small for confidence.

#### CCI Momentum Breakout -- BEST FOR ALTCOINS
- **Status**: Strong on volatile altcoins, weak on BTC
- **Walk-Forward Results** (4h, 2022-2024):
  - ETH: OOS Sharpe 0.62, Return +71.7%
  - XRP: OOS Sharpe 0.81, Return +176.4%
  - BTC: OOS Sharpe 0.23 (below threshold)
  - DOGE: OOS Sharpe 0.19 (below threshold)
  - SOL: OOS Sharpe -0.08 (failed)
- **What works**: CCI's unbounded nature captures extreme momentum events better than RSI. Dual-threshold entry (breakout + zero-line) generates sufficient trades. Works exceptionally on high-volatility altcoins.
- **What does not work**: Severely asset-dependent. XRP's +176% return with -520% IS-OOS degradation ratio suggests the OOS window happened to align with a favorable regime, not necessarily genuine skill. BTC and DOGE below threshold.
- **Edge assessment**: **C (Questionable).** The ETH result is the most credible (0.62 Sharpe with reasonable degradation). The XRP result is too good to be trusted. The strategy likely captures liquidation-cascade momentum on volatile altcoins, but this is a regime-dependent phenomenon.

#### Volatility Squeeze Breakout
- **Status**: Theoretically sound, practically mediocre
- **Walk-Forward Results** (BTC/USDT, 4h, 2023-2024):
  - IS Sharpe: 0.38, OOS Sharpe: 0.19
  - OOS Return: +3.3%, 7 trades
  - OOS Degradation: 51.6%
- **What works**: The squeeze concept (BB inside KC) is legitimate and well-documented.
- **What does not work**: Only 7 OOS trades. 51.6% degradation. 0.19 Sharpe is effectively zero after transaction costs. Squeeze events are too rare on 4h to generate statistical significance.
- **Edge assessment**: **D (Insufficient evidence).** The squeeze pattern is real but too infrequent at 4h to be a standalone strategy.

#### Donchian ATR Trend Breakout -- FAILED
- **Status**: Discarded
- **Walk-Forward Results**: OOS Sharpe negative on all 3 assets (BTC -0.24, ETH 0.05, SOL 0.005). Degradation 89-145%.
- **Verdict**: Classic Turtle System does not work on modern crypto. Breakout whipsaw in a 24/7 market with algorithmic liquidity provision kills the edge.
- **Edge assessment**: **F (No edge).**

#### Adaptive RSI Mean Reversion -- FAILED
- **Status**: Discarded
- **Walk-Forward Results**: OOS Sharpe -0.34, Return -3.91%, Degradation 595%.
- **Verdict**: Mean reversion on single crypto assets does not work when the market transitions from ranging to trending. The regime filter (ADX) is insufficient.
- **Edge assessment**: **F (No edge).**

#### GPT Long Ultimate
- **Status**: Untested with walk-forward
- **Description**: Complex fractal-based strategy with Williams Fractals, BB%RSI, KVO, and Change-of-Character entries.
- **Concern**: 14+ parameters, high complexity. No walk-forward or multi-asset validation found in documentation.
- **Edge assessment**: **Incomplete.** Likely overfit due to complexity.

#### Market Leader Divergence
- **Status**: Untested with walk-forward
- **Description**: EMA crossover + volume spike divergence detection.
- **Concern**: No walk-forward results documented. Simple concept but unvalidated.
- **Edge assessment**: **Incomplete.**

#### SMA Crossover
- **Status**: Reference/example strategy
- **Verdict**: Known to be unprofitable after costs on modern crypto. Exists for educational purposes.
- **Edge assessment**: **F (No edge).**

### 1B. Crypto Pairs Trading Strategies

#### Pairs Z-Score Scalper v2
- **Status**: Foundation strategy, partially validated
- **Results**: BTC/LTC 1h -- positive returns but marginal Sharpe.
- **Key issue**: Transaction costs are 0.4% per round trip (4 orders at 0.1% each). Strategy needs each trade to generate >0.4% profit just to break even.
- **Edge assessment**: **C- (Marginal after costs).**

#### Pairs Kalman Reversion
- **Status**: Best pairs strategy by trade volume
- **Results** (BTC/LTC, 1h, 2024):
  - Sharpe: 0.214, Return: +8.6%, Max DD: -7.2%, 106 trades, Win Rate: 57.5%
- **What works**: Kalman filter adapts hedge ratio in real-time. High trade count provides better statistical sample. EWMA z-score reacts faster than rolling window.
- **What does not work**: 0.214 Sharpe is below any reasonable deployment threshold. 8.6% annual return with 7.2% drawdown is a terrible risk/reward ratio. No walk-forward OOS validation documented.
- **Edge assessment**: **D+ (Not deployable).** The 8.6% return barely exceeds a simple buy-and-hold strategy and does not justify the complexity.

#### Pairs RSI Divergence
- **Status**: Best risk-adjusted pairs strategy
- **Results** (BTC/LTC, 1h, 2024):
  - Sharpe: 0.359, Return: +5.34%, Max DD: -1.35%, 10 trades, Win Rate: 70%
- **What works**: Triple confirmation (RSI + MACD + z-score) produces high-quality signals with 70% win rate and minimal drawdown.
- **What does not work**: Only 10 trades in a full year. Statistically meaningless. 5.34% return does not justify the infrastructure complexity.
- **Edge assessment**: **D (Interesting concept, insufficient evidence).**

#### Pairs HTF Mean Reversion
- **Status**: Good concept, limited results
- **Results** (BTC/LTC, 1h, 2024):
  - Sharpe: 0.269, Return: +5.66%, Max DD: -1.46%, 16 trades, Win Rate: 62.5%
- **What works**: Hurst-like trend detection avoids entering during spread breakouts. Multi-period regime filtering is sophisticated.
- **What does not work**: 16 trades. Below any significance threshold. No OOS validation.
- **Edge assessment**: **D (Promising idea, no validation).**

#### Pairs Bollinger Reversion
- **Status**: Too conservative, effectively dead
- **Results**: 4 trades in a full year, 0.12 Sharpe.
- **Edge assessment**: **F (No practical use).**

### 1C. Polymarket Prediction Market Strategies

#### PM Mean Reversion -- Best PM Strategy (Conditional)
- **Status**: Works on a narrow subset of markets; 20% walk-forward pass rate
- **Results**: 50% profitable across 129 markets (65/129), avg Sharpe 0.76
  - Walk-forward: 4/20 survivors (CBOE sports, Fields Medal, Petr Yan, Zcash)
- **What works**: Captures overreaction in genuinely uncertain, oscillating markets. Market selector correctly identifies candidates.
- **What does not work**: 80% WF failure rate. 1% slippage per trade (2% round trip) eats most of the edge. Data window too short (30-90 days) for statistical confidence. Market selection is the critical variable, and we cannot reliably predict which markets will continue to oscillate.
- **Edge assessment**: **C- (Real but economically marginal).**

#### PM Information Edge -- ABANDONED
- **Results**: 9% profitable (11/129 markets), avg Sharpe -1.57
- **Verdict**: Momentum does not work on event-driven prediction markets. PM prices are driven by news, not technical patterns.
- **Edge assessment**: **F (Fundamentally flawed for PM).**

#### PM Correlation Pairs -- ABANDONED
- **Results**: 8/100 pairs profitable, avg Sharpe -0.14
- **Verdict**: PM market correlations are spurious (ETH $7K vs Doja Cat). No fundamental economic linkage.
- **Edge assessment**: **F (Wrong market for pairs trading).**

#### PM Cross-Platform Arb
- **Status**: Not functional
- **Results**: Consistently losing (-3% to -8%)
- **Verdict**: Hourly backtesting cannot capture sub-second arbitrage opportunities.
- **Edge assessment**: **F (Wrong tool for the job).**

---

## 2. Honest Assessment of Edge

### Do any current strategies have genuine statistical edge after transaction costs?

**The uncomfortable answer: We do not know, and the data we have is insufficient to determine this.**

Here is why:

#### The Overfitting Problem

Every strategy in the portfolio was developed through some form of parameter optimization. The standard approach (grid search on in-sample data, then validate out-of-sample) has fundamental limitations:

1. **Selection bias**: We tested many strategies and kept the ones that looked good. Even with walk-forward validation, the act of selecting which strategies to keep introduces bias.

2. **Small sample sizes**: The best OOS results have 7-35 trades. The minimum for statistical significance is commonly cited as 30, but for trading strategies with fat-tailed distributions, 100+ is more appropriate.

3. **Single walk-forward split**: A 70/30 split gives one OOS window. If that window happens to align with a favorable regime, the strategy "passes" regardless of its true quality. Rolling walk-forward (multiple windows) has not been done.

4. **No null hypothesis testing**: We have not tested whether random entry/exit on the same data would produce similar results. In crypto's strongly trending periods, any long-biased strategy will show positive returns.

#### What the Evidence Actually Shows

| Strategy | OOS Sharpe | OOS Trades | Edge Confidence |
|----------|-----------|------------|-----------------|
| EMA-MACD (BTC) | 0.49 | 15 | Low-Medium |
| CCI (ETH) | 0.62 | ~20 | Low-Medium |
| CCI (XRP) | 0.81 | ~25 | Low (possible regime luck) |
| Pairs RSI Div (BTC/LTC) | 0.36 | 10 | Very Low |
| PM Mean Rev (select markets) | 2-12 | 10-34 | Low (short windows) |
| Everything else | <0.3 | <15 | None |

**The honest conclusion**: The EMA-MACD trend-following strategy has the best combination of positive OOS Sharpe, multi-asset consistency, and theoretical justification. But with only 15 OOS trades on the primary asset, we are one standard deviation away from "this is noise." The strategy needs at minimum 6-12 more months of forward testing before capital deployment.

#### What Professional Quants Are Doing (2025-2026)

Based on current research:

1. **Funding rate arbitrage** is the dominant strategy for crypto quant funds, generating 15-20% annualized with minimal drawdown. This is a market-neutral carry trade: long spot, short perpetual futures, collect funding payments. Professional funds managing $4B+ use this as their core strategy. **This is the biggest gap in our system.**

2. **BTC-neutral residual mean reversion** (market-neutral alpha extraction) shows Sharpe ratios around 2.3 in post-2021 data, significantly outperforming momentum. This involves neutralizing BTC beta and trading the idiosyncratic residual.

3. **CTA/trend-following** remains viable on crypto but with declining Sharpe ratios as markets mature. Academic Sharpe of 1.5+ is cited but likely pre-cost.

4. **Pairs trading on 5-minute data** shows the strongest academic results (11.61% monthly returns), but requires infrastructure for high-frequency execution that our system does not support.

5. **AI/ML ensemble approaches** are increasingly dominant at the institutional level, using features from order book imbalance, on-chain data, funding rates, and sentiment -- not just OHLCV technicals.

**The industry has moved far beyond what our system is designed to test.** Simple technical indicator strategies on 4h candles are the lowest-edge approach in the current competitive landscape.

---

## 3. Market Regime Analysis

### Are We Targeting the Right Markets?

**Crypto**: Partially. The crypto market is correct for our skill set and infrastructure. But we are targeting the wrong *approach* within crypto.

**Polymarket**: Wrong market for our tool. The previous critical assessment (2026-02-17) correctly identified that PM prices are fundamentally information-driven, not technical-pattern-driven. The bounded [0,1] price space, event-driven dynamics, and 30-day data windows make backtesting-driven strategy development nearly meaningless.

### Are We Targeting the Right Timeframes?

**4h for directional strategies**: Reasonable. This timeframe balances noise filtering against signal frequency. Academic research supports 4h for swing trading.

**1h for pairs trading**: Sub-optimal. The academic literature strongly favors 5-minute frequency for pairs trading (Palazzi 2025: 11.61% monthly at 5m vs -0.07% at daily). Mean reversion in spreads is a high-frequency phenomenon that largely disappears at hourly resolution. Our 1h pairs results (0.2-0.36 Sharpe) are consistent with this finding -- the edge is being diluted by the slow timeframe.

**1h for PM strategies**: The only viable option given data constraints, but fundamentally insufficient for technical strategies on prediction markets.

### What Regime Are We In?

As of early 2026, crypto is in a mature bull market with BTC near all-time highs. Key characteristics:

- **Trend-following** has performed well in 2024-2025 (strong directional moves)
- **Mean reversion** has underperformed (trending markets suppress mean reversion)
- **Volatility** has been moderate-to-high (good for momentum and breakout strategies)
- **Correlation structure** is evolving (BTC-ETH decorrelation during ETF events)

**Implication**: Our best-performing strategies (trend-following EMA-MACD, CCI momentum) are regime-appropriate. They are designed for trending markets. But we have no strategy for the inevitable regime shift to ranging/bear conditions. This is a critical portfolio gap.

---

## 4. What Is Missing

### 4A. Strategy Types Not Explored

#### Funding Rate Arbitrage (HIGHEST PRIORITY)
- **What**: Long spot BTC/ETH, short perpetual futures on same asset. Collect funding payments (typically positive, averaging 0.015% per 8 hours = ~19% annualized).
- **Why this matters**: This is the single most profitable systematic strategy in crypto as of 2025-2026. Professional funds managing billions use it as their core strategy. Average returns of 15-20% annualized with minimal drawdown and near-zero directional risk.
- **Why it persists**: Structural -- speculators in perp markets are net long, creating persistent positive funding. The edge is a carry trade, not a technical pattern.
- **System gap**: Requires futures/perpetuals data integration (funding rates, perp prices), simultaneous spot+futures position management, and a different backtesting paradigm (carry vs directional).
- **Capital requirement**: $5K-$50K is feasible. Major exchanges (Binance, Bybit) support this at retail level.
- **Estimated complexity**: Medium-High (new data provider for funding rates, new position management paradigm, but conceptually simple).

#### BTC-Neutral Residual Alpha (HIGH PRIORITY)
- **What**: Neutralize BTC beta from altcoin returns, then apply mean reversion to the residual. Recent research shows Sharpe ~2.3 post-2021.
- **Why this matters**: Captures idiosyncratic altcoin alpha while removing systematic crypto market risk. A 50/50 blend of momentum and BTC-neutral residual achieved Sharpe 1.71 with 56% annualized return.
- **System gap**: Requires multi-asset simultaneous backtesting (neutralize BTC beta in real-time), dynamic beta estimation (rolling regression), and portfolio-level position sizing.
- **Estimated complexity**: High (portfolio engine needed).

#### Multi-Timeframe Trend Following with Regime Filter (MEDIUM PRIORITY)
- **What**: Daily timeframe for trend direction + 4h for entry timing. Only trade when daily trend is confirmed (e.g., price above 200-day EMA) and 4h signals alignment.
- **Why this matters**: Single-timeframe trend following suffers from whipsaws. Adding a higher-TF filter can significantly improve Sharpe by rejecting counter-trend signals.
- **System gap**: Currently single-TF per backtest. The init() workaround fetches static daily data, which does not update as the backtest progresses. Need proper multi-TF engine support.
- **Estimated complexity**: Medium (engine modification to support rolling multi-TF data).

#### Volatility Regime Switching (MEDIUM PRIORITY)
- **What**: Automatically switch between trend-following (in trending regimes) and mean-reversion (in ranging regimes) based on volatility indicators.
- **Why this matters**: The reason most strategies fail in walk-forward is regime change. A regime-switching meta-strategy addresses this directly.
- **System gap**: Needs a meta-strategy framework that can compose multiple sub-strategies. Currently strategies are monolithic.
- **Estimated complexity**: Medium (framework change, but each sub-strategy already exists).

#### Cross-Exchange Spread Trading (LOW PRIORITY)
- **What**: Same asset trading at slightly different prices on different exchanges. Buy cheap, sell expensive.
- **Why this matters**: Structural edge from fragmented liquidity. Well-documented profits.
- **System gap**: Requires multi-exchange data, real-time execution, and latency-sensitive infrastructure. Our backtesting system is not designed for this.
- **Estimated complexity**: Very High (essentially a different product).

### 4B. Infrastructure Gaps

| Gap | Impact | Complexity |
|-----|--------|-----------|
| Funding rate data integration | Unlocks best strategy class | Medium |
| Perpetual futures backtesting | Required for funding arb | Medium-High |
| Rolling multi-window walk-forward | Dramatically improves validation | Medium |
| Monte Carlo null hypothesis testing | Prevents self-deception about edge | Low-Medium |
| 5-minute data backtesting for pairs | Matches academic optimum for pairs | Low (data exists via CCXT) |
| Portfolio-level backtesting engine | Enables multi-asset strategies | High |
| Paper trading mode | Required before real deployment | High |
| Live execution engine | Required for real money | Very High |

---

## 5. Concrete Next Steps (Prioritized)

### TIER 1: Validation Before Any Deployment (Weeks 1-2)

**1. Rolling Walk-Forward on Top 2 Strategies**
- Run EMA-MACD and CCI Momentum through 3+ rolling walk-forward windows (not just one 70/30 split)
- Use: train 6mo, test 3mo, roll forward by 3mo, repeat
- Test period: 2022-01-01 to 2025-12-31 (8 windows)
- Success criteria: Positive OOS Sharpe in at least 5/8 windows
- This is the **single most important step** before considering real money

**2. Monte Carlo Null Hypothesis Test**
- For each "successful" strategy, generate 1000 random entry/exit strategies with the same average holding period
- Compare real strategy Sharpe distribution against random distribution
- Only strategies exceeding the 95th percentile of random Sharpe have confirmed alpha
- This can be built as a CLI tool: `npm run quant:monte-carlo`

**3. Transaction Cost Sensitivity Analysis**
- Re-run top strategies at 0.5%, 1.0%, 1.5%, and 2.0% slippage
- Find the "break-even slippage" -- the cost level where Sharpe goes to zero
- If break-even slippage is below 0.3% (realistic Binance taker fee + slippage), the strategy has no real edge

### TIER 2: New Strategy Development (Weeks 3-6)

**4. Funding Rate Arbitrage Strategy**
- Integrate funding rate historical data from Binance Futures API
- Build a spot-perp carry trade backtesting module
- Expected effort: 2-3 dev days for data provider, 1-2 days for strategy
- This has the highest probability of genuine, deployable edge

**5. 5-Minute Pairs Trading Test**
- Re-run pairs-zscore-scalper and pairs-kalman on 5m data for BTC/ETH and BTC/LTC
- The academic evidence strongly suggests 5m is the right frequency for pairs
- If Sharpe improves from 0.2 to 1.0+ (as literature suggests), this becomes deployable
- Constraint: Need to cache 5m data (large dataset, ~50K bars per month)

**6. BTC-Neutral Residual Mean Reversion**
- Implement simple version: regress altcoin returns on BTC returns, trade the residual
- Test on ETH, SOL, AVAX, LINK
- Requires portfolio-level position management (long alt, short BTC-equivalent)

### TIER 3: Infrastructure for Deployment (Weeks 7-12)

**7. Paper Trading Module**
- Connect to exchange WebSocket feeds
- Execute strategy signals in real-time without actual orders
- Track fills, slippage, latency
- Minimum 30 days of paper trading before real capital

**8. Multi-Timeframe Engine**
- Support concurrent 1d + 4h + 1h data in a single backtest
- Enable strategies to query higher-TF indicators on each bar
- Unlocks the daily-trend + 4h-entry pattern

**9. Regime-Switching Meta-Strategy**
- Framework to run multiple strategies and allocate based on detected regime
- Simple version: use 30-day realized volatility percentile to switch between trend and mean-reversion modes

### TIER 4: Production Readiness (Months 3-6)

**10. Live Execution Engine**
- CCXT-based order execution with rate limiting, retry logic, position sync
- Risk management: max position size, daily loss limit, kill switch
- Monitoring dashboard with P&L, drawdown, and trade alerts

---

## 6. Risk of Deployment: What Would Need to Be True

### Before deploying ANY strategy with real money, ALL of the following must be satisfied:

#### Statistical Requirements
- [ ] **Rolling walk-forward Sharpe > 0.5** across at least 5 independent OOS windows
- [ ] **Monte Carlo p-value < 0.05** (strategy beats random at 95% confidence)
- [ ] **OOS trade count > 50** total across all windows
- [ ] **Transaction cost break-even > 0.5%** per trade (generous margin above actual costs)
- [ ] **Multi-asset validation**: Profitable on at least 3 of 5 tested assets
- [ ] **Max drawdown < 20%** in worst OOS window

#### Operational Requirements
- [ ] **30 days minimum paper trading** with real market data and execution simulation
- [ ] **Paper trading results within 20% of backtest** (confirms backtest realism)
- [ ] **Live execution tested** with minimal capital ($100-500) for 7+ days
- [ ] **Kill switch tested** and confirmed functional
- [ ] **Monitoring and alerting** operational

#### Capital and Risk Management
- [ ] **Starting capital**: Maximum 5% of total investable assets (never risk what you cannot lose)
- [ ] **Per-trade risk**: Maximum 2% of strategy capital
- [ ] **Daily loss limit**: Maximum 5% of strategy capital
- [ ] **Maximum drawdown trigger**: Stop all trading at 15% drawdown, require manual review
- [ ] **Position sizing**: Volatility-adjusted (reduce size in high-vol regimes)

#### Psychological Preparation
- [ ] Accept that backtesting Sharpe will degrade 30-50% in live trading
- [ ] Accept that the first 3 months may be breakeven or slightly negative
- [ ] Have a written plan for: what to do if drawdown hits 10%, 15%, 20%
- [ ] Commit to running the strategy mechanically for 90 days before making parameter changes

### How Much Capital to Start With

Given the current state of the system:

| Scenario | Recommended Starting Capital | Rationale |
|----------|------------------------------|-----------|
| After completing Tier 1 validation only | $0 (do not deploy) | Insufficient evidence |
| After Tier 1 + Tier 2 (funding arb) + 30 days paper | $1,000-$2,000 | Experimental capital |
| After Tier 1-3 complete with successful paper trading | $5,000-$10,000 | Validated deployment |
| After 6+ months of profitable live trading | Scale to $25,000-$50,000 | Proven track record |

---

## 7. Summary of Honest Grades

| Strategy | Category | OOS Sharpe | Edge Grade | Deploy? |
|----------|----------|-----------|------------|---------|
| EMA-MACD Trend Momentum | Crypto Directional | 0.49 | C+ | Not yet |
| CCI Momentum (ETH) | Crypto Directional | 0.62 | C | Not yet |
| CCI Momentum (XRP) | Crypto Directional | 0.81 | C- | Not yet (regime luck) |
| Volatility Squeeze | Crypto Directional | 0.19 | D | No |
| Donchian Breakout | Crypto Directional | -0.24 | F | No (abandoned) |
| Adaptive RSI Reversion | Crypto Directional | -0.34 | F | No (abandoned) |
| GPT Long Ultimate | Crypto Directional | N/A | Incomplete | No (unvalidated) |
| Market Leader Divergence | Crypto Directional | N/A | Incomplete | No (unvalidated) |
| SMA Crossover | Crypto Directional | N/A | F | No (reference only) |
| Pairs Kalman | Crypto Pairs | 0.21* | D+ | No |
| Pairs RSI Divergence | Crypto Pairs | 0.36* | D | No |
| Pairs HTF Reversion | Crypto Pairs | 0.27* | D | No |
| PM Mean Reversion | Prediction Markets | 2-12** | C- | No (marginal) |
| PM Information Edge | Prediction Markets | -1.57 | F | No (abandoned) |
| PM Correlation Pairs | Prediction Markets | -0.14 | F | No (abandoned) |

*In-sample only; no OOS walk-forward documented for pairs strategies
**Short OOS windows on tiny number of surviving markets; not statistically meaningful

---

## 8. The Bottom Line

### What We Have Built Well
1. **Backtesting infrastructure**: Solid TypeScript platform with CCXT integration, SQLite caching, and a clean strategy interface
2. **Walk-forward validation pipeline**: Proper OOS testing that correctly identified failing strategies
3. **Polymarket data integration**: Working CLOB API provider with windowed data fetching
4. **Market selector for PM**: Correctly identifies oscillating markets (best PM contribution)
5. **Strategy variety**: Explored trend, momentum, mean reversion, breakout, volatility, and pairs approaches

### What We Have Not Built
1. **Funding rate arbitrage**: The single most profitable systematic crypto strategy, completely absent
2. **Paper/live trading**: No ability to validate in real-time
3. **Multi-timeframe engine**: Strategies limited to single-TF workarounds
4. **Portfolio management**: No multi-asset simultaneous trading
5. **Monte Carlo robustness testing**: No null hypothesis validation
6. **5-minute pairs data**: Academic optimum for pairs trading untested

### The Hard Truth

The project has invested significant engineering time building strategies that target the lowest-edge segment of the crypto trading landscape: simple technical indicator signals on 4h candles. Meanwhile, the highest-edge strategies available to retail traders -- funding rate arbitrage (19% annualized), high-frequency pairs trading (11% monthly at 5m), and BTC-neutral residual alpha (Sharpe 2.3) -- remain unimplemented because they require infrastructure capabilities the system does not have.

**The most impactful thing to build next is not another strategy. It is the infrastructure to support the strategies that actually have edge: funding rate data, perpetual futures backtesting, 5-minute data caching, and a paper trading module.**

The strategies we have are not bad starting points. EMA-MACD and CCI Momentum are reasonable trend-following implementations that may have genuine, if modest, edge. But they need far more rigorous validation before real money touches them, and the expected returns (Sharpe 0.3-0.6 after realistic costs) may not justify the effort unless combined with higher-edge strategies in a portfolio.

---

## References

### Academic Papers
- [Palazzi (2025) - Trading Games: 5-minute crypto pairs returns 11.61% monthly](https://onlinelibrary.wiley.com/doi/full/10.1002/fut.70018)
- [Tadi & Kortchemski (2025) - Copula-based cointegrated crypto pairs, Sharpe 3.77 at 5m](https://link.springer.com/article/10.1186/s40854-024-00702-7)
- [Restocchi et al. (2019) - Overreaction in prediction markets](https://www.sciencedirect.com/science/article/abs/pii/S0377221718305575)
- [Snowberg & Wolfers - Favorite-Longshot Bias](https://www.nber.org/system/files/working_papers/w15923/w15923.pdf)
- [NSGA-II Pairs Trading (2025) - Multi-objective optimization for crypto pairs](https://www.tandfonline.com/doi/full/10.1080/00036846.2025.2512152)
- [Parameters Optimization of Pair Trading (2024) - Optimal entry threshold 1.42](https://arxiv.org/html/2412.12555v1)
- [Walk-Forward Analysis Framework (2025) - Interpretable hypothesis-driven validation](https://arxiv.org/html/2512.12924v1)

### Industry Sources
- [1Token Crypto Quant Strategy Index VII (Oct 2025) - Funding arb and long-short strategy benchmarks](https://blog.1token.tech/crypto-quant-strategy-index-vii-oct-2025/)
- [1Token Funding Fee Arbitrage Strategy Guide](https://blog.1token.tech/crypto-fund-101-funding-fee-arbitrage-strategy/)
- [Funding Rate Arbitrage Risk/Return Profiles (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2096720925000818)
- [Gate.io Funding Rate Arbitrage Strategy 2025](https://www.gate.com/learn/articles/perpetual-contract-funding-rate-arbitrage/2166)
- [A Quant's Guide to Funding Rate Arbitrage](https://medium.com/@stepchoi_28254/the-quants-guide-to-crypto-s-true-carry-mastering-funding-rate-arbitrage-3d3065107367)
- [Systematic Crypto Trading: Momentum, Mean Reversion & Volatility Filtering](https://medium.com/@briplotnik/systematic-crypto-trading-strategies-momentum-mean-reversion-volatility-filtering-8d7da06d60ed)
- [Amberdata Crypto Pairs Trading Series](https://blog.amberdata.io/crypto-pairs-trading-why-cointegration-beats-correlation)
- [Avoiding Overfitting in Trading Rules](http://adventuresofgreg.com/blog/2025/12/18/avoid-overfitting-testing-trading-rules/)
- [QuantInsti Walk-Forward Optimization Guide](https://blog.quantinsti.com/walk-forward-optimization-introduction/)
- [Pendle Cross-Exchange Funding Rate Arbitrage via Boros](https://medium.com/boros-fi/cross-exchange-funding-rate-arbitrage-a-fixed-yield-strategy-through-boros-c9e828b61215)
- [QuantPedia - Systematic Edges in Prediction Markets](https://quantpedia.com/systematic-edges-in-prediction-markets/)
- [QuantVPS Top 20 Trading Bot Strategies for 2026](https://www.quantvps.com/blog/trading-bot-strategies)

---

## Change Log

**Version 1.0** - 2026-02-18
- Comprehensive review of all 15 strategies
- Honest edge assessment with grades
- Market regime analysis
- Missing strategy types identified
- Prioritized next steps with timeline
- Deployment risk criteria defined
