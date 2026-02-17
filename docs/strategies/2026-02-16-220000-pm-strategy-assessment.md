# Polymarket Strategy Assessment: Honest Analysis for Real Capital Deployment

> **Created**: 2026-02-16 22:00
> **Author**: quant-lead agent (opus)
> **Status**: Research Assessment
> **Capital at Risk**: $500-$1,000

---

## Executive Summary

After extensive research across academic papers, empirical data from 3,587+ resolved prediction markets, Polymarket-specific studies, and analysis of our own backtesting results, my honest assessment is: **deploying $500-$1,000 via automated technical strategies (mean reversion/momentum) on Polymarket CLOB data is unlikely to generate consistent profits, and the edge -- if any -- is too thin relative to the operational complexity and data limitations.**

The profitable approaches in prediction markets are fundamentally different from traditional technical analysis. The real edges are: (1) information-based domain expertise, (2) structural arbitrage (mispriced bundles, cross-platform), (3) the favorite-longshot bias, and (4) market making with liquidity rewards. Most of these cannot be captured by our backtesting system as currently designed.

---

## Part 1: Where Does Edge Actually Exist in Prediction Markets?

### 1.1 Edges That Are REAL (Empirically Documented)

#### A. Structural/Bundle Arbitrage
- **What**: When YES + NO prices sum to less than $1.00, buying both guarantees profit
- **Evidence**: Documented across PredictIt (up to 55% profit per contract in 2016), Polymarket, and Kalshi
- **Typical profit**: 2-3 cents per bundle (2-3% gross)
- **Why it persists**: Multi-outcome markets with many legs; retail traders don't monitor completeness conditions; execution requires simultaneous fills
- **Reality check**: These opportunities last seconds to minutes. Bots dominate. $40M+ extracted by automated arbitrageurs in 2024-2025. A $1,000 account cannot compete here.
- **Source**: QuantPedia "Systematic Edges in Prediction Markets", IMDEA Networks research

#### B. Favorite-Longshot Bias
- **What**: Contracts priced below $0.10 (longshots) win LESS than their price implies; contracts priced above $0.80 (favorites) win MORE than their price implies
- **Evidence**: 50+ years of academic literature across horse racing, sports betting, and prediction markets. Kalshi data (3,587 markets): contracts priced above $0.80 win 84% of the time vs expected 80%+ -- the bias goes in the OPPOSITE direction from what most assume. Investors who buy contracts under $0.10 lose over 60% of their money on average.
- **Why it persists**: Behavioral -- retail traders seek lottery-like payoffs (overweight small probabilities). Prospect theory predicts this. Framing effects (binary contract presentation amplifies it).
- **Practical strategy**: Systematically buy YES on high-probability outcomes (the "Favorite Compounder" strategy). One documented case: 5.2% yield in 72 hours on near-certain outcomes.
- **Risk**: One tail event wipes out months of gains. Black swan exposure is real.
- **Source**: NBER Working Paper 15923 (Snowberg & Wolfers), Kalshi 3,587-market analysis

#### C. Information Edge / Domain Specialization
- **What**: Traders with genuine subject-matter expertise consistently outperform
- **Evidence**: Only 30% of Kalshi traders are profitable, but the profitable ones show persistent skill (not luck). Top Polymarket wallets show systematic edge in specific verticals (politics, crypto, macro).
- **Why it persists**: Information is costly to acquire; most retail traders trade on headlines, not underlying data
- **Practical approach**: Focus on 1-2 domains you actually understand. Trade based on your private estimate of probability vs market price.
- **Source**: Reichenbach & Walther (SSRN 5910522), Ng et al. (SSRN 5331995)

#### D. Market Making / Liquidity Provision
- **What**: Place limit orders on both sides of the book, capture spread + Polymarket liquidity rewards + 4% annualized holding reward
- **Evidence**: Professional MMs earned $20M+ in 2024. One trader: $10K capital -> $200-800/day
- **Why it persists**: Requires infrastructure (sub-10ms latency), risk management, and capital
- **Reality check**: Post-2024 election, rewards decreased significantly. Competition intensified. Spread compressed from 4.2 cents to 2.4 cents. A $1,000 account with standard latency cannot compete with professional MMs.
- **Source**: Polymarket "Automated Market Making" blog post, PolyTrack MM guide

### 1.2 Edges That Are WEAK or ILLUSORY

#### A. Technical Mean Reversion on PM Prices (Our pm-mean-reversion)
- **What**: Bollinger Band reversion on probability time series
- **Evidence**: The PredictionMarketBench study (Feb 2026) tested BB mean reversion across prediction market data. Result: +$66.68 on $1,000 (6.7% return) -- but concentrated in a SINGLE volatile Bitcoin episode. Across 4 episodes total, it was barely positive.
- **Why it's weak**: Prediction market prices are NOT like asset prices. They are bounded [0,1] probabilities reflecting information. They don't "mean revert" in the same way -- new information permanently shifts the probability. When price moves from 0.50 to 0.70, it's not "overbought"; it's reflecting updated beliefs.
- **Our results**: pm-mean-reversion has NOT been systematically tested but is theoretically weaker than pm-information-edge because the mean reversion hypothesis conflicts with the informational nature of PM prices.
- **Source**: PredictionMarketBench (arXiv 2602.00133)

#### B. Momentum / ROC on PM Prices (Our pm-information-edge)
- **What**: Trade probability momentum (ROC) to capture "information cascades"
- **Evidence**: Our backtest results show mixed performance: +4% on Starmer, +2.7% on Iran Strike, but -8.4% on OpenAI IPO. The strategy correctly filtered out 13/19 flat markets. But only 2/5 tradeable markets were profitable.
- **Why it's weak**: Momentum in PM prices represents INFORMATION FLOW, not price dynamics. By the time an hourly candle closes showing an 8pp move, the information is already priced in. We're chasing stale information signals with 1% round-trip slippage.
- **Key problem**: 31 days of data, 2-5 trades per market = statistically meaningless. We cannot distinguish signal from noise.

#### C. Cross-Platform Arbitrage (Our pm-cross-platform-arb)
- **What**: Price differences between Polymarket and other platforms
- **Evidence**: Already failed in our tests (-3% to -8%). Academic research confirms: opportunities last seconds, not hours. Latency arbitrage requires sub-10ms execution.
- **Why it's illusory for us**: Our backtesting system operates on hourly candles. Arbitrage opportunities exist on sub-second timeframes.

### 1.3 Summary: Edge Rankings for a $1,000 Bot

| Strategy | Edge Strength | Feasibility with Our System | Expected Return |
|----------|--------------|---------------------------|-----------------|
| Bundle Arbitrage | Strong | Impossible (needs real-time CLOB) | N/A |
| Cross-Platform Arb | Strong | Impossible (needs sub-second execution) | N/A |
| Market Making | Strong | Impossible (needs live order placement) | N/A |
| Favorite Compounder | Moderate | Partially (manual market selection) | 2-5%/month |
| Domain Specialization | Moderate | Cannot automate (human judgment) | Varies |
| Correlation Pairs | Weak-Moderate | Yes (pm-correlation-pairs) | 0-2%/month |
| Momentum/ROC | Weak | Yes (pm-information-edge) | -2% to +2%/month |
| BB Mean Reversion | Very Weak | Yes (pm-mean-reversion) | Likely negative |

---

## Part 2: Which Market Characteristics Make a Market Tradeable?

### 2.1 Volume/Liquidity Thresholds

Based on research and our data:

- **Minimum daily volume**: $50,000+ for reliable execution at $500 positions
- **Minimum order book depth**: At least $1,000 within 1 cent of midpoint on each side
- **Spread**: Less than 2 cents (markets with spreads > 4 cents are too expensive for technical strategies)
- **Activity**: At least 10 unique trades per hour (our data uses point count as volume proxy -- need at least 3-5 points per hourly candle)

### 2.2 Price Range for Trading

| Price Range | Characteristics | Strategy Fit |
|-------------|----------------|-------------|
| 0.01-0.15 | Longshots. High variance. Favorite-longshot bias makes these overpriced. | Sell (buy NO). But extreme risk of total loss on individual events. |
| 0.15-0.35 | Moderate uncertainty. Some movement possible. | Momentum (if information shock triggers repricing). |
| 0.35-0.65 | Maximum uncertainty zone. Most volatile. Highest spread usually. | All strategies get most signals here, but also most noise and whipsaw. |
| 0.65-0.85 | Moderate-high probability. Less volatile. | Mean reversion more plausible (temporary panic dips). |
| 0.85-0.99 | Near-certain outcomes. Very low volatility. | Favorite Compounder (buy and hold to resolution). Tiny returns but high win rate. |

**Key insight**: The research shows the 0.35-0.65 zone is NOT necessarily the best for profit despite maximum price movement. It's where the most noise lives. The 0.85-0.99 zone (favorites) actually offers better risk-adjusted returns via the compounding strategy, and the 0.01-0.15 zone (longshots) should generally be SOLD, not bought.

### 2.3 Resolution Timeline

- **Less than 7 days**: Not enough time for signals to develop; mostly news-driven. Good for manual event trading, bad for automated strategies.
- **7-60 days**: Sweet spot for our hourly strategies. Enough data for indicator calculation, enough time for positions to work.
- **60-180 days**: Good for pairs strategies (more data for correlation calculation). Price moves slowly, fewer signals.
- **180+ days**: Prices are biased toward 50% (per academic research). Very slow-moving. Poor for active trading.

### 2.4 Ideal Market Characteristics for Our System

A market is tradeable by our automated strategies if:
1. Resolution is 14-90 days away
2. Current price is 0.20-0.80 (not in extremes)
3. The market has shown at least 15pp of price movement in the last 14 days (minPriceRange filter)
4. Volume proxy shows at least 3 data points per hourly candle on average
5. A correlated market exists for pairs trading (correlation > 0.9)

---

## Part 3: Parameter Recommendations

### 3.1 pm-mean-reversion (Bollinger Band Strategy)

**Honest assessment**: This is the WEAKEST strategy for prediction markets. PM prices are not mean-reverting in the traditional sense. A move from 0.50 to 0.70 reflects new information, not overextension. I would NOT recommend deploying real capital on this strategy.

If you insist on testing it:

| Parameter | Recommended | Rationale |
|-----------|-------------|-----------|
| bbPeriod | 10-15 | Short lookback due to limited data (31 days = 744 bars). Long lookbacks (20+) waste too much of the already-limited data as warmup. |
| bbStdDev | 2.5-3.0 | WIDER bands. PM prices move informationally -- you need extreme deviations to have any reversion signal. At 2.0 stddev, you'll get too many false signals. |
| exitStdDev | 0.0-0.3 | Exit quickly at or near the mean. Don't wait for overshoot. |
| minBBWidth | 0.10-0.15 | WIDER filter. Only trade when there's genuine volatility, not forward-filled noise. |
| minProfitPct | 5-8 | Must exceed 2% round-trip slippage (1% per side) by a wide margin. At 4% you'll break even at best. |
| positionSizePct | 15-25 | Small. This strategy has high uncertainty. |
| cooldownBars | 8-12 | Prevent overtrading. |

**Key insight on lookback**: With only 744 hourly bars, a bbPeriod of 20 wastes the first 20 bars (2.7% of data). This is acceptable. Going to 50 wastes 6.7%. Given the data limitation, 10-20 is the practical range. The academic evidence (PredictionMarketBench) used period=20, k=2 and achieved marginal profitability only in volatile episodes.

### 3.2 pm-information-edge (Momentum/ROC Strategy)

**Honest assessment**: Better than mean reversion for PM markets because it aligns with the informational nature of price moves. But the edge is thin, and our results (2 of 5 tradeable markets profitable) are not confidence-inspiring.

| Parameter | Recommended | Rationale |
|-----------|-------------|-----------|
| momentumPeriod | 15-25 | Current default (20) is reasonable. Shorter (10-15) captures faster news cycles but more noise. Longer (30+) is too slow for 31-day windows. |
| entryThreshold | 0.06-0.10 | Current 0.08 is good. Below 0.06, too much noise. Above 0.10, too few trades (already low at 0.08). |
| exitThreshold | 0.03-0.05 | Current 0.04 is fine. This is the reversal detection. |
| minPriceRange | 0.12-0.18 | THIS IS THE MOST IMPORTANT PARAMETER. It's the trend filter. At 0.15, it correctly blocked 68% of flat markets. Keep it high. |
| minProfitPct | 6-10 | Must exceed round-trip costs (2%) by wide margin. Current 8 is conservative but good. |
| positionSizePct | 20-35 | Conservative. This is directional risk. |
| cooldownBars | 8-16 | Prevent overtrading in choppy markets. |

### 3.3 Is Momentum Real in PM Prices or Just Noise?

**Answer: It's PARTIALLY real, but not in the way traditional momentum works.**

The evidence:
1. **Academic**: The BSIC/Bocconi study found mean reversion patterns in crypto prediction markets, but primarily in SPECIFIC volatile episodes, not systematically. The SSRN papers on price discovery show that large trades predict subsequent returns -- but on sub-hour timeframes, not hourly.
2. **Structural**: When breaking news shifts a probability (e.g., a political event), there IS a cascade effect as retail traders slowly process information. This creates short-term momentum. But it's EVENT-DRIVEN, not time-series momentum.
3. **Our data**: pm-information-edge works on event-driven markets (Starmer leadership, Iran strike) but fails on markets with low information flow (OpenAI IPO, Sinners Best Picture).

**Conclusion**: Momentum is real only in markets with active information flow. It's not a general property of PM prices. The strategy needs a MARKET SELECTION FILTER, not just parameter optimization.

---

## Part 4: Honest Expected Return Profile

### With $1,000, 31 days data, 1% slippage, 5% max DD

**pm-information-edge (momentum):**
- Expected return: -2% to +4% over 31 days (BEFORE considering market selection)
- With good market selection: 0% to +5%
- Probability of profit: ~45-55% (barely above coin flip)
- Expected trades: 0-5 per market (many markets get filtered out)
- Realistic monthly dollar return: -$20 to +$50
- Risk of hitting 5% DD limit: ~30%

**pm-correlation-pairs:**
- Expected return: 0% to +2% over 31 days
- With good pair selection: +0.5% to +2%
- Probability of profit: ~55-65% (better due to market-neutral hedging)
- Expected trades: 0-4 per pair
- Realistic monthly dollar return: $0 to +$20
- Drawdown risk: Very low (0.1-0.5% typical)
- Problem: Very few qualifying pairs exist (minCorrelation=0.9 filters most)

**pm-mean-reversion (BB):**
- Expected return: -3% to +2% over 31 days
- Probability of profit: ~35-45% (below coin flip)
- Realistic monthly dollar return: -$30 to +$20
- This strategy conflicts with PM price mechanics -- I expect negative returns over time

### Annual Projection (Extremely Rough)

Assuming you rotate across markets monthly:
- **Best case** (favorable market selection, momentum strategy): +3%/month * 12 = +36% annualized ($360 on $1,000)
- **Realistic case**: +0.5%/month * 12 = +6% annualized ($60 on $1,000)
- **Likely case with data limitations**: Break even after slippage, or small loss
- **Worst case**: -5% per month during adverse period, drawdown triggers stop

**Brutal honesty**: You're deploying ~$1,000 with ~31 days of backtesting data per market, no walk-forward validation possible, and 1% round-trip slippage eating into every trade. The statistical significance of any backtest result is near zero with 2-5 trades. You should treat this as EXPERIMENTAL capital that you're comfortable losing entirely.

---

## Part 5: What I Would Do Differently

### 5.1 Strategies That Are Missing from Our System

#### A. Favorite Compounder (HIGH PRIORITY)
**What**: Buy YES on high-probability outcomes (>0.90) with clear resolution dates within 30 days. Hold to resolution.

**Why it works**:
- Kalshi data shows contracts >$0.80 win 84% of the time (vs 80% expected)
- The favorite-longshot bias means you're getting slightly better odds than the price suggests
- No technical analysis needed -- just market selection
- Round-trip "slippage" is just the buy spread (no exit trade -- the contract resolves)
- Example: Buy YES at $0.93, receive $1.00 at resolution = 7.5% return in days/weeks

**Implementation**:
- Scan for markets with: price > 0.90, resolution in 7-30 days, volume > $50K/day
- Buy YES shares (or buy NO when NO is the high-probability side)
- Hold to resolution
- Position size: max $200 per market, spread across 5+ markets for diversification

**Expected return**: 3-7% per cycle (2-4 weeks). Annualized 20-50%.

**Risk**: Black swan events. One loss can erase 10+ wins. Mitigate by: (a) diversifying across 5-10 markets, (b) only trading truly near-certain outcomes, (c) never concentrating more than 20% in one market.

**Why it's not in our system**: It's not a "trading" strategy with entries/exits based on indicators. It's a market selection + hold-to-resolution strategy. Our backtesting engine simulates continuous trading, not buy-and-hold-to-resolution.

#### B. Longshot Seller
**What**: Sell overpriced longshots (buy NO on outcomes priced at $0.01-$0.10).

**Evidence**: Kalshi data shows investors who buy contracts under $0.10 lose over 60% of their money. This means SELLING these contracts is profitable on average.

**Implementation**: Buy NO on markets where YES is priced 0.01-0.10 and you believe the outcome is genuinely unlikely.

**Risk**: Catastrophic single-event loss. If the longshot hits, you lose $0.90+ per $1 position. Need extreme diversification.

#### C. Settlement Rules Edge
**What**: Read the actual resolution criteria (not just the headline) and trade when market price reflects headline narrative but not the specific rules.

**Example**: "Will X happen before Y date?" -- if the resolution criteria specify a very narrow definition of "happen", but traders are pricing based on loose interpretation, the NO side may be underpriced.

**Not automatable**: This requires human judgment and rule-reading.

#### D. Term-Structure Spread
**What**: Same event, different deadlines. E.g., "Will Starmer resign by June 2026" vs "by December 2026". The June contract should always be <= the December contract. When the spread inverts or gets too wide, trade the convergence.

**This IS what pm-correlation-pairs does**: And it's our best strategy (Sharpe 3.2). The problem is finding qualifying pairs.

### 5.2 System Improvements Needed

#### CRITICAL: Market Scanner + Selection
Our biggest gap is not the strategies -- it's MARKET SELECTION. The system should:
1. Scan all active Polymarket markets daily
2. Score each market on tradeability criteria (volume, price range, time to resolution, volatility)
3. For pairs, automatically identify correlated markets
4. Filter to a shortlist for strategy deployment

#### CRITICAL: Resolution-Aware Backtesting
Current system treats PM prices like continuous asset prices. It should understand:
- Binary outcome at resolution (price goes to 0 or 1)
- No need to "exit" -- contracts resolve automatically
- This enables the Favorite Compounder strategy

#### IMPORTANT: Real-Time Order Book Data
For market making and structural arb, we'd need:
- Live CLOB order book snapshots
- Bid-ask spread tracking
- Depth analysis
- This is a MAJOR system extension (live trading, not backtesting)

#### NICE-TO-HAVE: Cross-Platform Data
For cross-platform arb:
- Kalshi API integration
- PredictIt data (where available)
- Price comparison and spread tracking

### 5.3 The Simplest Approach You Should Actually Consider

**Manual Favorite Compounder + Automated Monitoring**:

1. Use a script to scan Polymarket for markets where YES > 0.90 and resolution is within 30 days
2. Manually review the shortlist (5-10 markets) for genuine near-certainty
3. Buy $100-$200 of YES per market across 5-7 qualifying markets
4. Hold to resolution
5. Expected yield: ~5-7% per 2-4 week cycle (before any losses)
6. Reinvest and repeat

This requires NO sophisticated backtesting, NO technical indicators, and NO fighting against 1% slippage on round-trip trades. The "edge" comes from the favorite-longshot bias and careful market selection.

**This is what I would do with $1,000 of real money on Polymarket.**

---

## Part 6: Recommendations for Current Strategies

### Strategy Priority Ranking

1. **pm-correlation-pairs** (KEEP, but limited by pair availability)
   - Sharpe 3.2 is genuinely impressive
   - Near-zero drawdown is ideal for small accounts
   - Main risk: Too few qualifying pairs. The minCorrelation=0.9 filter is correct but restrictive.
   - Action: Continuously scan for new qualifying pairs

2. **pm-information-edge** (KEEP, but lower confidence)
   - Only deploy on markets with ACTIVE information flow (political events, macro)
   - The minPriceRange=0.15 filter is essential -- keep it
   - Reduce position size to 20% (not 30%)
   - Action: Add market selection criteria to strategy documentation

3. **pm-mean-reversion** (DEPRECATE or REDESIGN)
   - Conflicts with PM price mechanics
   - Only profitable in volatile episodes (which are unpredictable)
   - If keeping: redesign as "panic dip buyer" -- only buy when probability drops sharply AND the underlying fundamentals haven't changed
   - Action: Do not deploy with real money in current form

4. **NEW: Favorite Compounder** (BUILD)
   - Simplest strategy with best empirical backing
   - Does not require our backtesting engine -- could be a standalone script
   - Action: Create a market scanner + simple buy-and-hold strategy

### Parameter Ranges for Grid Search

#### pm-information-edge (if testing further)

| Parameter | Min | Max | Step | Priority |
|-----------|-----|-----|------|----------|
| momentumPeriod | 10 | 30 | 5 | Medium |
| entryThreshold | 0.05 | 0.12 | 0.01 | High |
| exitThreshold | 0.02 | 0.06 | 0.01 | Medium |
| minPriceRange | 0.10 | 0.20 | 0.02 | **Highest** |
| minProfitPct | 5 | 10 | 1 | High |
| positionSizePct | 15 | 35 | 5 | Low |
| cooldownBars | 6 | 16 | 2 | Medium |

#### pm-mean-reversion (if testing further)

| Parameter | Min | Max | Step | Priority |
|-----------|-----|-----|------|----------|
| bbPeriod | 8 | 20 | 4 | High |
| bbStdDev | 2.0 | 3.5 | 0.5 | **Highest** |
| exitStdDev | 0.0 | 0.5 | 0.1 | Medium |
| minBBWidth | 0.08 | 0.20 | 0.04 | High |
| minProfitPct | 4 | 10 | 2 | High |
| positionSizePct | 10 | 30 | 5 | Low |

---

## Part 7: Statistical Reality Check

### Why Our Backtest Results Are Not Reliable

1. **Sample size**: 2-5 trades per market. The minimum for statistical significance is ~30 trades. We're nowhere close.
2. **No walk-forward**: All testing done on the same 31-day window. There is no out-of-sample validation.
3. **Selection bias**: We chose markets that seemed interesting. This is not random sampling.
4. **Survivorship bias**: Only active markets tested. Resolved markets (where strategies might have failed) have no data.
5. **Forward-fill artifacts**: Many hourly candles are forward-filled (volume=0). The strategy skips these, but it means actual tradeable bars are fewer than the 744 theoretical maximum.
6. **Slippage model**: 1% flat is an approximation. Real slippage varies with order size, time of day, and market liquidity. For some markets at some times, it could be 3-5%.

### What Would Make This More Reliable

- **10x more data**: 300+ days of hourly data per market (not available from CLOB API)
- **Cross-market testing**: Test on 50+ markets, not 5-10
- **Walk-forward validation**: At minimum 70/30 train/test split
- **Out-of-sample assets**: Test on markets you didn't look at during design
- **Paper trading first**: Run live (with real-time data) for 30 days before deploying capital

---

## References

**Academic Papers**:
1. Snowberg & Wolfers, "Explaining the Favorite-Long Shot Bias" (NBER Working Paper 15923)
   - URL: https://www.nber.org/system/files/working_papers/w15923/w15923.pdf
   - Key Finding: Misperceptions of probability (prospect theory) drive the bias, not risk-love

2. Ng, Peng, Tao, Zhou, "Price Discovery and Trading in Modern Prediction Markets" (SSRN 5331995)
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5331995
   - Key Finding: Polymarket leads Kalshi in price discovery; large trade order imbalance predicts returns

3. Reichenbach & Walther, "Exploring Decentralized Prediction Markets: Accuracy, Skill, and Bias on Polymarket" (SSRN 5910522)
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522
   - Key Finding: Only 30% of traders profitable; skilled traders show persistent profits

4. "PredictionMarketBench: A SWE-bench-Style Framework for Backtesting Trading Agents" (arXiv 2602.00133)
   - URL: https://arxiv.org/html/2602.00133
   - Key Finding: Bollinger Bands mean reversion +6.7% on $1,000 but only in volatile episodes; LLM agent lost money

5. BSIC Bocconi, "Backtesting Trading Strategies on Prediction Markets' Cryptocurrency Contracts"
   - URL: https://bsic.it/well-can-we-predict-backtesting-trading-strategies-on-prediction-markets-cryptocurrency-contracts/
   - Key Finding: Mean reversion Sharpe ~1.8 in theory but impractical due to liquidity constraints

**Industry Research**:
1. QuantPedia, "Systematic Edges in Prediction Markets"
   - URL: https://quantpedia.com/systematic-edges-in-prediction-markets/
   - Summary: Inter/intra-exchange arbitrage and longshot bias are the main documented edges

2. StockAlarm, "Prediction Market Analysis: What 3,587 Markets Reveal"
   - URL: https://pro.stockalarm.io/blog/prediction-market-analysis
   - Summary: 92.4% overall accuracy; spreads compressed 43%; politics dominates volume

3. DataWallet, "Top 10 Polymarket Trading Strategies"
   - URL: https://www.datawallet.com/crypto/top-polymarket-trading-strategies
   - Summary: Only 16.8% of wallets profitable; favorite compounder and bundle arb most documented

4. Polymarket Documentation, "Automated Market Making"
   - URL: https://news.polymarket.com/p/automated-market-making-on-polymarket
   - Summary: MM profits from spread + rewards; requires infrastructure and capital

5. AInvest, "Exploiting Volatility in Crypto Prediction Markets"
   - URL: https://www.ainvest.com/news/exploiting-volatility-crypto-prediction-markets-structural-arbitrage-bot-beating-strategies-polymarket-2601/
   - Summary: $40M+ in documented arb profits; combinatorial arbitrage yields 6.65% margins

6. Finance Magnates, "Polymarket Introduces Dynamic Fees"
   - URL: https://www.financemagnates.com/cryptocurrency/polymarket-introduces-dynamic-fees-to-curb-latency-arbitrage-in-short-term-crypto-markets/
   - Summary: Taker fees on 15-min crypto markets; ~3.15% at 50-cent contracts; most other markets remain fee-free

---

## Change Log

**Version 1.0** - 2026-02-16
- Initial comprehensive assessment
- Research across 15+ sources (academic and industry)
- Honest evaluation of all four existing PM strategies
- Recommendation to build Favorite Compounder strategy
- Parameter guidance for existing strategies
