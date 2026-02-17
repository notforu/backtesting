# Polymarket Strategy Critical Assessment

> **Date**: 2026-02-17
> **Author**: quant-lead (opus)
> **Status**: Strategic Assessment
> **Context**: After 129-market scan, 3 strategy tests, 20 walk-forward validations

---

## Executive Summary

**The honest verdict: pm-mean-reversion has a real but fragile edge that is likely too small and unreliable to generate meaningful returns at the current scale of our system.** The 20% walk-forward pass rate is poor but not unusual -- the problem is that the surviving markets are unpredictable in advance, the data window is too short for statistical confidence, and the realistic annual P&L ceiling on a $10K account is approximately $500-2,000 after slippage. The platform is better suited to information-driven strategies than technical ones.

We should not abandon PM entirely, but we should **pivot from pure backtesting-driven technical trading to a hybrid approach** that combines the market selector with a simple, robust execution layer and -- critically -- an information/probability estimation edge that cannot be backtested in the traditional sense.

---

## 1. Is Mean Reversion on PM a Viable Edge?

### The Case FOR (What We're Doing Right)

There is genuine academic backing for mean reversion in prediction markets. A 2019 paper in the European Journal of Operational Research (Restocchi et al., "Improving prediction market forecasts by detecting and correcting possible over-reaction to price movements") specifically documents overreaction in prediction market prices and proposes machine-trader correction mechanisms. The core finding: **human traders systematically overreact to price movements in prediction markets**, and this overreaction is correctable.

Our Bollinger Band strategy is a crude but directionally correct implementation of this insight. The 50% in-sample profitability across 129 markets is consistent with the hypothesis that roughly half of PM markets exhibit sufficient oscillation for mean reversion to work.

### The Case AGAINST (What We're Getting Wrong)

**Problem 1: We have not tested against a null hypothesis.**

This is the most damaging gap in our analysis. A 50% hit rate sounds compelling, but we need to ask: **what would a random entry/exit strategy achieve on these same 129 markets?**

In prediction markets, prices are bounded [0,1] and tend to oscillate around their mean by construction -- they represent probability estimates that get revised by noisy information. A random strategy that enters when a coin flip says "buy" and exits after N bars could plausibly achieve 30-40% profitability simply because:

- Prices are mean-bounded (they cannot trend to infinity like stocks)
- The bounded nature creates natural "reversion" even without any edge
- Our Bollinger Band strategy may simply be capturing the mechanical effect of bounded randomness, not genuine overreaction

**What a proper null hypothesis test would look like:**

1. For each of the 129 markets, run 1000 Monte Carlo simulations with random entries (random bar, random direction) and exits after the average holding period of our strategy
2. Calculate the distribution of Sharpe ratios under randomness
3. Compare our strategy's Sharpe to the 95th percentile of the random distribution
4. Only markets where our Sharpe exceeds the 95th percentile random Sharpe have genuine alpha

I estimate this test would reduce our "genuine edge" markets from 65 to perhaps 15-25. The published research suggests that Sharpe ratios above 0.6 from random trading have a p-value of only 0.002 in equity markets -- but prediction markets are bounded, which inflates random-strategy Sharpe ratios significantly.

**Problem 2: The data window is too short for statistical significance.**

Most of our markets have only 30-90 days of hourly data (~720-2160 bars). With average trade counts of 20-50, we have insufficient sample size for robust statistical inference. The minimum commonly cited for statistical significance is 30 trades, and many of our "high confidence" markets have fewer.

The walk-forward test compounds this problem: splitting 30 days of data into 70/30 gives us 21 days of training and 9 days of testing. Optimizing parameters on 21 days and testing on 9 is practically meaningless from a statistical standpoint.

**Problem 3: The edge, where it exists, is small relative to costs.**

At 1% slippage per trade (2% round trip), the strategy needs each trade to generate at least 2% profit just to break even. Our minProfitPct filter of 4% helps, but it also dramatically reduces the number of tradeable signals. The markets where the edge is large enough to overcome costs are precisely those with the most volatility -- and those are also the most likely to exhibit regime changes that break the strategy.

### Verdict on Mean Reversion

**The edge is real but economically marginal.** It works on a specific subset of markets (oscillators with genuine uncertainty, long time to resolution, sufficient liquidity), but:

- We cannot reliably identify these markets in advance (the market selector helps but 20% WF pass rate proves the difficulty)
- The data window is too short for confidence
- Transaction costs consume most of the theoretical edge
- The edge disappears exactly when we need it most (near resolution, regime changes)

**Grade: C+** -- Real phenomenon, poor implementation economics.

---

## 2. Walk-Forward Survival Rate: 20% -- Good or Terrible?

### Industry Benchmarks

Walk-forward validation does not have a universally agreed "pass rate," but the available evidence provides context:

- **Walk-Forward Efficiency (WFE) above 50-60%** is considered reasonable in traditional markets (QuantInsti research). This measures how much of the in-sample performance survives out-of-sample -- different from our binary pass/fail.
- **Industry hedge funds** typically target Sharpe ratios of 0.8-1.2 with rigorous WF validation. Our WF survivors show Sharpe 7-12, which is suspiciously high and likely reflects short test windows rather than genuine strategy quality.
- **Academic research** finds that honest WF validation of ML-based strategies reduces reported Sharpe from 1.35-2.45 to approximately 0.33 (Nicolae Filip Stanciu, Medium, Jan 2026).

### Our 20% in Context

Our 20% pass rate is **worse than typical for robust strategies but not unusual for early-stage development**. The key issues:

1. **Our test is too lenient**: We only require OOS Sharpe > 0.5 and degradation < 30% for "passing." The 4 survivors have OOS Sharpe of 7-12, which is astronomically high and almost certainly reflects:
   - Very short OOS windows (9-25 days)
   - Small sample sizes (10-34 trades)
   - Survivorship bias in which markets we selected for WF testing (top 20)

2. **Our test is also too harsh in the wrong way**: The 70/30 split on 30-90 days of data means the OOS window is 9-27 days. This is so short that a single bad day can make or break the test. This is noise-driven pass/fail, not signal-driven.

3. **The failure modes tell us more than the pass rate**:
   - 6/16 failures had 0 OOS trades (price convergence) -- this is a *market selection* failure, not a strategy failure
   - 10/16 had regime changes -- this is an *adaptation* failure
   - Neither of these is fixable by parameter optimization alone

### Verdict on Walk-Forward

**The 20% pass rate is not informative because both our test methodology and data are inadequate.** We are drawing conclusions from noise. What we should conclude instead:

- Market selection matters more than parameter optimization
- The strategy needs a dynamic regime detection mechanism
- We need longer data histories or a fundamentally different validation approach

**Grade: Incomplete** -- The test itself is not statistically meaningful.

---

## 3. Novel Strategy Ideas for PM

### 3A. Favorite-Longshot Bias Exploitation (HIGHEST CONVICTION)

**The Idea**: Systematically buy "heavy favorites" (price > 0.80) and sell "longshots" (price < 0.20) across many markets simultaneously.

**Why This is Promising**:
- The favorite-longshot bias is one of the most documented anomalies in betting markets. Academic evidence from sports betting shows that contracts priced above 50c earn small positive returns while contracts below 10c lose over 60% of invested capital (QuantPedia, multiple academic sources).
- On Polymarket specifically, retail traders systematically overpay for unlikely outcomes seeking lottery-like payoffs.
- This is a *portfolio strategy* that benefits from diversification across 50+ markets simultaneously.
- It does not require technical indicators -- just probability assessment and position sizing.

**Why It Persists**: Behavioral -- humans love longshots and hate paying 95 cents for a probable-but-boring outcome. The edge is structural, not informational.

**Implementation Challenge**:
- Requires portfolio-level management (our system is single-asset)
- Needs proper Kelly criterion position sizing
- Tie-up of capital in favorites that resolve slowly
- Maximum profit per contract is small (5-20c on favorites)
- Need 50-100+ concurrent positions for portfolio effect

**System Gap**: Major -- requires portfolio backtesting engine, multi-asset simultaneous management, capital allocation across markets.

**Realistic Returns**: 5-15% annualized on a diversified portfolio, Sharpe 0.5-1.0. Small but consistent.

### 3B. Resolution Convergence Trading (MEDIUM CONVICTION)

**The Idea**: When a market crosses above 0.80 (or below 0.20) with increasing volume, ride the convergence toward 0.95+ (or 0.05-).

**Why This is Promising**:
- This is the exact regime where mean reversion fails, so it's complementary.
- Markets that have genuinely resolved their uncertainty tend to converge monotonically -- there's a clear "information cascade" effect.
- Gamma dynamics near settlement create a mathematical basis: as time to resolution decreases, the probability distribution becomes bimodal (moving toward 0 or 1), and the convergence accelerates.
- Professional prediction market traders explicitly recommend reducing position size as settlement approaches, which means there's less professional capital competing in this regime.

**Why It Persists**: Most sophisticated traders are exiting positions as markets approach resolution (risk reduction). This creates a window for a convergence strategy.

**Implementation Challenge**:
- Distinguishing genuine convergence from temporary extremes
- Risk management when the market reverses from 0.85 back to 0.50 (catastrophic loss)
- Need reliable resolution date information
- Stop loss placement is critical -- a 5% stop on a 0.85 entry loses 4.25c per share, but the maximum profit is only 15c

**Realistic Returns**: Highly asymmetric -- many small wins (5-15c) offset by occasional large losses (30-50c). Overall return depends entirely on accuracy of convergence detection.

**Grade: Worth Prototyping** but high risk of failure.

### 3C. Volume Spike / Overreaction Strategy (MEDIUM CONVICTION)

**The Idea**: Monitor volume in real-time. When a market experiences a sudden volume spike (3x+ average) with a large price move (>10pp in an hour), trade the immediate reversal.

**Why This is Promising**:
- Academic evidence (Restocchi et al. 2019) specifically documents overreaction in prediction markets
- Volume spikes in PM markets typically correspond to news events, and the initial price reaction often overshoots
- Order flow imbalance research shows that short-term price variance is 65% explained by order flow, creating predictable reversion windows
- This captures a more specific, higher-conviction version of our current BB mean reversion

**Why It Persists**: Information arrives in bursts, and retail traders overreact in the first 1-4 hours before the market finds equilibrium.

**Implementation Challenge**:
- Requires real-time monitoring, not backtesting
- Need volume data at high resolution (current CLOB API gives 1-minute fidelity but capped at 740 points)
- Hard to distinguish "overreaction that will revert" from "justified repricing that won't"
- Need fast execution (minutes, not hours)

**System Gap**: Real-time execution engine, WebSocket market data feed, event detection system.

**Realistic Returns**: If selective (5-10 trades per month across all markets), potentially 2-5% per trade after costs. The challenge is being selective enough.

### 3D. Market Making (LOW CONVICTION FOR US)

**The Idea**: Provide two-sided liquidity (bids and asks) to capture the spread plus Polymarket's liquidity rewards.

**Why This is Tempting**:
- Market makers on Polymarket earned an estimated $20M+ in 2024
- Polymarket's rewards program pays bonuses for providing two-sided liquidity
- Documented case: $10K starting capital, scaling to $700-800/day at peak
- Holding rewards of 4% annualized on eligible market positions

**Why I'm Low Conviction For Us**:
- The backtesting system is fundamentally wrong for market making -- you need real-time order management, not bar-by-bar simulation
- Open-source market making bots (e.g., poly-maker on GitHub) explicitly warn they are "not profitable" in today's market after liquidity rewards decreased
- Market making requires sophisticated inventory management, gamma hedging, and quote adjustment -- completely different architecture
- We would be competing with professional HFT firms and dedicated market makers
- The edge has been significantly arbed away post-2024 election

**Verdict**: Completely wrong tool for our system. Would require building an entirely new real-time trading platform.

### 3E. Cross-Market Arbitrage (LOW CONVICTION)

**The Idea**: Find logically related markets where prices are inconsistent. For example, if "Trump wins presidency" is at 60c and "Republican wins presidency" is at 55c, there's a logical mispricing.

**Why I'm Low Conviction**:
- This is a well-documented and heavily competed strategy
- Bots have reportedly extracted $40M+ from Polymarket through arbitrage
- The opportunities exist for seconds to minutes -- our hourly backtesting system cannot capture them
- Requires real-time execution and sophisticated NLP to detect market relationships
- The arbitrage community is sophisticated (using embedding models like Linq-Embed-Mistral to find semantic relationships between markets)

**System Gap**: Massive -- needs NLP, real-time execution, semantic market matching.

**Verdict**: Theoretically profitable but completely outside our system's capabilities.

---

## 4. Realistic P&L Expectation

### Current Strategy: pm-mean-reversion

**Assumptions**:
- Capital: $10,000
- Tradeable markets at any time: 5-10 (based on market selector)
- Position size: 25% of capital per market = $2,500 max per position
- Average trade frequency: 2-3 per market per week across active markets
- Win rate after costs: 55-65% (optimistic, based on WF survivors)
- Average win: 4-6% of position
- Average loss: 2-3% of position (stopped out)
- Slippage: 1% per side (2% round trip)

**Monthly P&L Estimate** (optimistic scenario with good market selection):
- Active markets: 5
- Trades per month: 40-60 total
- Net expectation per trade after costs: +0.5-1.0% (generous)
- Monthly P&L: $200-600 on $10K capital
- Monthly return: 2-6%

**Annual P&L** (accounting for drawdowns, dry spells, and market availability):
- Good months (3-4/year): $400-600
- Average months (4-5/year): $100-300
- Bad months (3-4/year): -$200 to -$500
- **Realistic annual net: $500-2,000 (5-20% on $10K)**

**Key Caveat**: This assumes perfect market selection (which we cannot do reliably), no catastrophic drawdowns (which the 80% WF failure rate suggests are likely), and consistent market availability (which varies seasonally).

### With Portfolio Approach (Favorite-Longshot + Mean Reversion)

If we built a proper portfolio system and ran both strategies:
- Favorite-longshot portfolio across 50+ markets: 5-15% annualized
- Mean reversion on 5-10 selected oscillators: 5-20% annualized
- Combined (diversification benefit): 10-25% annualized
- On $10K: $1,000-2,500 annually

### Scale Limitations

- Polymarket liquidity concentrates in a few large markets
- Most mean-reversion-suitable markets have $5K-50K total liquidity
- Position sizes above $500-1,000 would move the market
- Maximum realistic deployment: $20-50K across all PM strategies
- Maximum realistic annual P&L: $2,000-10,000

**Bottom line: This is a side project, not a trading business.** The returns are real but small in absolute dollar terms.

---

## 5. Should We Pivot?

### What's Working

1. **Market selector** -- genuinely useful tool for identifying oscillating markets
2. **Mean reversion hypothesis** -- correct in direction, backed by academic evidence
3. **Backtesting infrastructure** -- solid for crypto strategies where data is abundant
4. **PM data integration** -- working CLOB API integration is a foundation

### What's Not Working

1. **Backtesting as primary validation** -- 30 days of data is insufficient for statistical confidence
2. **Technical-only approach** -- PM markets are driven by information, not technical patterns
3. **Single-market strategies** -- PM edge requires diversification across many markets
4. **Optimization-heavy workflow** -- overfitting is the primary risk, and our grid search exacerbates it

### Recommended Pivot: Hybrid Signal Generation System

Instead of pure backtesting, I recommend evolving toward a **three-layer system**:

**Layer 1: Market Selection (KEEP, already built)**
- Use the market selector to identify oscillating markets daily
- Filter for liquidity, time to resolution, and oscillation score
- This is our strongest component

**Layer 2: Simple, Robust Execution Rules (SIMPLIFY)**
- Strip mean reversion down to the absolute minimum viable strategy
- Fixed parameters (no optimization) -- use bb_period=20, bb_stddev=2.0, exit at mean
- The edge is in market selection, not parameter tuning
- Add a hard stop loss (5% of position value) and time stop (48 hours max)
- No grid search, no walk-forward -- just a simple mechanical system

**Layer 3: Forward-Looking Signal Layer (BUILD NEW)**
- Real-time volume spike detection (overreaction entry)
- News/event integration (avoid entering before known events)
- Portfolio-level position management (max 10 concurrent positions, Kelly sizing)
- This is where the actual edge lives -- not in backtesting

### Concrete Recommendations

**Short Term (This Week)**:
1. Run the null hypothesis test (Monte Carlo random entry benchmark) -- this will tell us definitively whether the BB strategy adds value over random
2. Paper trade the top 3-5 market selector picks with simplified, fixed parameters
3. Track actual slippage on limit vs market orders

**Medium Term (Next 2-4 Weeks)**:
1. Build a real-time volume spike detector for PM markets
2. Implement portfolio-level position management
3. Prototype the favorite-longshot bias strategy (buy all favorites > 0.85, hold to resolution)

**Long Term (1-3 Months)**:
1. If paper trading validates the edge, deploy $1-5K of real capital
2. Build the resolution convergence strategy as a complement to mean reversion
3. Consider building a proper real-time execution layer if PM returns justify the investment

### What NOT To Do

1. **Do not spend more time on parameter optimization** -- diminishing returns, overfitting risk
2. **Do not build a market making bot** -- wrong tool, wrong skill set, wrong market timing
3. **Do not try cross-market NLP arbitrage** -- the competition is too sophisticated
4. **Do not scale capital before validating with real money** -- paper trading first
5. **Do not assume backtesting results transfer to live trading** -- PM markets are too short-lived and event-driven

---

## 6. Uncomfortable Truths

1. **Our backtesting system is designed for crypto, not prediction markets.** Crypto has years of continuous data, consistent market structure, and patterns that repeat across assets. PM has 30 days of data, event-driven dynamics, and each market is structurally unique. The tool is being applied to the wrong problem.

2. **The 50% profitability rate is probably not better than random on bounded [0,1] prices.** Until we run the null hypothesis test, we cannot claim an edge with intellectual honesty.

3. **The walk-forward test is giving us false confidence in both directions.** The 4 "survivors" may be lucky, and the 16 "failures" may include strategies that would work on different OOS windows. With 9-27 day OOS windows, we are measuring noise.

4. **The real edge in prediction markets is informational, not technical.** The most successful PM traders ($2.5M+ profit) explicitly describe their edge as "independent analysis" and "researching what others don't" -- not as Bollinger Band mean reversion. We are trying to extract a technical edge from a fundamentally information-driven market.

5. **At realistic scale ($10-50K), the annual dollar returns ($1-5K) may not justify the engineering effort.** We have invested significant development time building PM integration, data providers, market scanners, and strategy optimizers. The ROI on that engineering effort is questionable unless PM capital scales significantly.

6. **The market selector is our best work -- but it's answering the wrong question.** It tells us which markets oscillate. It doesn't tell us which markets will *continue* to oscillate, which is what we actually need.

---

## 7. Summary and Final Recommendation

| Question | Answer |
|----------|--------|
| Is mean reversion on PM viable? | Directionally yes, economically marginal |
| Is 20% WF pass rate acceptable? | Not informative -- test methodology is flawed |
| Should we continue PM development? | Yes, but pivot approach |
| Best novel strategy idea? | Favorite-longshot bias (portfolio approach) |
| Realistic annual return on $10K? | $500-2,000 (5-20%) |
| Should we build a market making bot? | No -- wrong tool entirely |
| Biggest risk? | We're fooling ourselves with backtesting noise |

**The single most important next step: Run the Monte Carlo null hypothesis test.** If random entries on bounded [0,1] PM prices produce similar Sharpe ratios to our BB strategy, we need to fundamentally rethink the approach. If our strategy significantly outperforms random, we have a confirmed edge worth refining.

---

## References

**Academic Papers**:
1. Restocchi, V., McGroarty, F., Sherris, M. (2019). "Improving prediction market forecasts by detecting and correcting possible over-reaction to price movements." European Journal of Operational Research, 272(1), 389-405.
   - URL: https://www.sciencedirect.com/science/article/abs/pii/S0377221718305575
   - Key Finding: Human traders in prediction markets systematically overreact to price movements

2. Hong, H., Stein, J.C. (1999). "A Unified Theory of Underreaction, Momentum Trading, and Overreaction." Journal of Finance.
   - URL: http://www.columbia.edu/~hh2679/jf-mom.pdf
   - Key Finding: Noise trader overreaction creates mean reversion over longer horizons

3. Poterba, J., Summers, L. (1988). "Mean reversion in stock prices: Evidence and Implications." Journal of Financial Economics.
   - URL: https://www.sciencedirect.com/science/article/abs/pii/0304405X88900219
   - Key Finding: Stock returns display significant negative serial correlation over 3-7 years

**Industry Research**:
1. QuantPedia. "Systematic Edges in Prediction Markets."
   - URL: https://quantpedia.com/systematic-edges-in-prediction-markets/
   - Key Finding: Favorite-longshot bias is a documented systematic edge; longshots lose 60%+

2. Bawa, N. "The Mathematical Execution Behind Prediction Market Alpha."
   - URL: https://navnoorbawa.substack.com/p/the-mathematical-execution-behind
   - Key Finding: Realistic systematic PM returns are 15-25% annually with Sharpe 2.0-2.8 at institutional grade; fractional Kelly sizing is essential

3. PANews. "Deep Dive into 290,000 Market Data Points: Revealing 6 Truths About Polymarket Liquidity."
   - URL: https://www.panewslab.com/en/articles/d886495b-90ba-40bc-90a8-49419a956701
   - Key Finding: 63% of active short-term markets have zero 24h volume; liquidity is highly concentrated

4. Stanciu, N.F. (2026). "Walk-Forward Analysis: A Production-Ready Comparison of Three Validation Approaches."
   - URL: https://medium.com/@NFS303/walk-forward-analysis-a-production-ready-comparison-of-three-validation-approaches-69cd25fc9fc7
   - Key Finding: Honest WF validation reduces reported ML strategy Sharpe from 1.35-2.45 to ~0.33

**Polymarket Specific**:
1. Polymarket. "Automated Market Making on Polymarket."
   - URL: https://news.polymarket.com/p/automated-market-making-on-polymarket

2. QuantVPS. "Polymarket HFT: How Traders Use AI to Identify Arbitrage and Mispricing."
   - URL: https://www.quantvps.com/blog/polymarket-hft-traders-use-ai-arbitrage-mispricing

3. PolyTrack. "Polymarket Market Making Guide 2025."
   - URL: https://www.polytrackhq.app/blog/polymarket-market-making-guide
   - Key Finding: Market makers earned $20M+ in 2024 but profitability declined significantly post-election

---

## Change Log

**Version 1.0** - 2026-02-17
- Initial critical assessment based on 129-market scan results
- Walk-forward analysis of top 20 markets
- Novel strategy evaluation
- P&L projection and pivot recommendations
