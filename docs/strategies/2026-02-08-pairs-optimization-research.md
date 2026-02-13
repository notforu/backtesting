# Pairs Z-Score Mean Reversion: Optimization Research & Pair Selection Guide

> **Created**: 2026-02-08 15:30
> **Author**: quant-lead agent (opus)
> **Status**: Research Document
> **Purpose**: Guide pair selection, parameter ranges, timeframes, and test periods for the pairs-zscore-scalper strategy

---

## Executive Summary

This document consolidates academic research and practitioner experience on crypto pairs trading to provide concrete recommendations for which pairs to test, what parameters to use, which timeframes are optimal, and what date ranges provide the most rigorous testing conditions. The core finding from academic literature is that **5-minute frequency crypto pairs trading significantly outperforms hourly and daily frequencies**, with one study showing 11.61% monthly returns at 5-minute vs -0.07% at daily frequency. The key to success is selecting pairs with stable cointegration (not just correlation), using appropriate z-score thresholds (lower than the commonly assumed 2.0), and managing transaction costs carefully since pairs trading involves double the usual commission burden.

---

## Part 1: Optimal Timeframes for Pairs Scalping

### Research Findings

**Strong evidence favors 5-minute and 15-minute timeframes over daily/hourly:**

1. **Palazzi (2025)** in the Journal of Futures Markets analyzed 26 liquid cryptocurrencies on Binance across 5-minute, 1-hour, and daily frequencies. The distance method returned **-0.07% monthly at daily frequency** but **11.61% monthly at 5-minute frequency**. This is the strongest evidence that intraday mean reversion exists in crypto pairs but disappears on longer horizons.

2. **Tadi & Kortchemski (2025)** in Financial Innovation (Springer) applied copula-based cointegration tests and found that 5-minute data "significantly outperform hourly data", with the best total net return at alpha_1=0.20 achieving **205.9% total return** on 5-minute data.

3. **Palazzi et al. (2024)** tested daily, 4h, 1h, 15-min, and 5-min data from the top 50 cryptocurrencies across three distinct market regimes (bullish 2020, stable 2021, bearish 2022), confirming that higher-frequency data captures mean-reverting behavior that vanishes at lower frequencies.

### Timeframe Recommendations

| Timeframe | Recommendation | Rationale |
|-----------|---------------|-----------|
| **5m** | PRIMARY - Best risk-adjusted returns | Academic consensus: strongest mean-reversion signal at this frequency |
| **15m** | SECONDARY - Good balance of signal/noise | Fewer trades, wider spreads tolerable, still captures intraday inefficiency |
| **1h** | TERTIARY - Fallback for illiquid pairs | Works for less liquid pairs where 5m data has too many zero-return bars |
| **1m** | NOT RECOMMENDED | Too noisy, slippage dominates, spread crossing costs eat profits |
| **4h/1d** | NOT RECOMMENDED for pairs scalping | Mean reversion signal disappears; trend-following dominates at these horizons |

### Recommended Configuration

- **Primary testing timeframe**: 5m
- **Validation timeframe**: 15m (to check robustness across frequencies)
- **Expected holding period on 5m**: 5-50 bars (25 minutes to ~4 hours)
- **Expected holding period on 15m**: 3-30 bars (45 minutes to ~7.5 hours)

---

## Part 2: Best Crypto Pairs for Z-Score Mean Reversion

### Pair Selection Criteria

Based on consolidated research, successful pairs trading requires:

1. **Cointegration (not just correlation)**: The spread between two assets must be stationary (mean-reverting). Tested via ADF (Augmented Dickey-Fuller) test with p-value < 0.05.
2. **Fundamental linkage**: Assets should share a structural relationship (same sector, same ecosystem, similar tokenomics) that provides a reason for long-term equilibrium.
3. **Adequate liquidity**: Both assets need sufficient volume to minimize slippage. On Binance, target > $50M daily volume for each asset on 5-minute timeframes.
4. **Similar volatility profiles**: Avoid pairing BTC with low-cap alts; the volatility mismatch creates unstable hedge ratios.
5. **Hurst exponent < 0.5**: Indicates mean-reverting behavior in the spread (lower is stronger).

### Pair Categories (Ranked by Expected Stability)

#### Tier 1: Major/Major Pairs (Highest Liquidity, Most Studied)

These pairs have the deepest academic backing and highest liquidity.

**1. BTC/USDT vs ETH/USDT**
- **Category**: The "gold standard" crypto pair
- **Expected correlation**: 0.65-0.85 (historically averaged ~0.80, dropped to ~0.65 during ETF-driven divergence in 2024)
- **Why it works**: BTC and ETH are the two pillars of crypto. Despite occasional divergence (ETF launches, merge events), they share the same macro risk factors (rates, regulation, risk appetite). The spread tends to revert because arbitrageurs and portfolio rebalancers force convergence.
- **Why the edge persists**: Retail traders over-react to narrative shifts (ETH killers, BTC dominance cycles), creating temporary spread dislocations that revert within hours on 5m timeframes.
- **Risk**: Correlation breakdown during major structural events (ETF approvals, network upgrades). The BTC-ETH correlation hit its lowest in 3 years (below 0.70 on 60-day rolling) during the January 2024 BTC ETF launch.
- **Liquidity**: Excellent. Both are the most liquid pairs on Binance.
- **Academic backing**: Most commonly cited cointegrated crypto pair in literature (Gatev et al. adaptation, Tadi 2023, multiple theses).

**2. BTC/USDT vs LTC/USDT**
- **Category**: Original crypto pair
- **Expected correlation**: 0.70-0.85
- **Why it works**: LTC was created as "silver to Bitcoin's gold." Both are PoW coins with similar block reward halving cycles. The fundamental similarity in consensus mechanism and monetary policy creates a stable long-run relationship.
- **Why the edge persists**: LTC often leads or lags BTC moves by a few hours on short timeframes, creating temporary spread dislocations.
- **Risk**: LTC's declining relevance may weaken the fundamental link over time. Lower volume than ETH.
- **Liquidity**: Good. LTC maintains top-15 volume on Binance.
- **Academic backing**: Identified in multiple studies as cointegrated with BTC (Constructing cointegrated cryptocurrency portfolios, 2019).

#### Tier 2: Same-Sector Pairs (Strong Fundamental Linkage)

These pairs share the same narrative/sector, creating a fundamental reason for spread reversion.

**3. SOL/USDT vs AVAX/USDT**
- **Category**: L1 smart contract platform competitors
- **Expected correlation**: 0.70-0.85
- **Why it works**: Both are high-throughput L1 blockchains competing for DeFi and NFT market share. They respond to the same macro factors (L1 sentiment, ETH comparison, DeFi TVL flows). When one gets a temporary narrative boost (new protocol launch, partnership), the spread widens but reverts as the market re-prices relative value.
- **Why the edge persists**: Retail rotation between "ETH killer" narratives creates predictable overshoot/undershoot patterns. Institutional rebalancing between L1 allocations forces spread reversion.
- **Risk**: One-sided ecosystem events (hack, major protocol failure) can break cointegration. SOL experienced this during the FTX collapse.
- **Liquidity**: Good. Both in top 15 by volume.
- **Recommended test caveat**: Exclude Nov 2022-Feb 2023 from SOL pairs (FTX contagion event destroyed SOL's correlation structure).

**4. ETH/USDT vs BNB/USDT**
- **Category**: L1 platform + exchange ecosystem token
- **Expected correlation**: 0.70-0.80
- **Why it works**: Both are large-cap L1 platforms with significant DeFi ecosystems. BNB's value is tied to Binance Smart Chain (an ETH-derivative) and Binance exchange revenue. ETH and BNB share smart-contract platform risk factors.
- **Why the edge persists**: BNB has additional exchange-specific risk (regulatory, CZ news) that creates temporary divergences, but the underlying L1 platform relationship pulls the spread back.
- **Risk**: BNB-specific regulatory events (SEC actions, Binance ban news) can cause sharp, persistent divergence.
- **Liquidity**: Excellent. Both are top-5 by volume.

#### Tier 3: Same-Ecosystem / Thematic Pairs

**5. LINK/USDT vs AAVE/USDT (or UNI/USDT)**
- **Category**: DeFi infrastructure tokens
- **Expected correlation**: 0.60-0.75
- **Why it works**: LINK (oracle infrastructure) and AAVE/UNI (DeFi protocols) are both core DeFi building blocks. They respond to the same DeFi-specific sentiment (TVL growth, yield farming narratives, regulatory news around DeFi).
- **Why the edge persists**: DeFi tokens trade on shared narrative cycles. When "DeFi summer" sentiment rotates in/out, these tokens move together but with temporary lead/lag effects.
- **Risk**: Lower correlation than Tier 1/2 pairs. Individual token-specific events (LINK integration news, AAVE hack, UNI governance drama) can dominate.
- **Liquidity**: Moderate. LINK has strong volume; AAVE/UNI volume is lower. Check for sufficient 5m liquidity.
- **Alternative**: If AAVE liquidity is insufficient on 5m, substitute with UNI/USDT.

**6. DOGE/USDT vs SHIB/USDT**
- **Category**: Meme coin pair
- **Expected correlation**: 0.65-0.80
- **Why it works**: Both are driven by the same retail/meme coin sentiment cycle. When meme coin mania hits, both pump; when it fades, both dump. The spread between them represents relative meme-coin preference.
- **Why the edge persists**: Retail traders rotate between meme coins rapidly, creating temporary spread dislocations that revert as attention normalizes. Social media-driven markets are inherently mean-reverting on short timeframes because hype cycles are self-limiting.
- **Risk**: Highly volatile individual moves driven by Elon Musk tweets (DOGE) or burn events (SHIB). These idiosyncratic shocks can permanently shift the spread.
- **Liquidity**: Good for DOGE; moderate for SHIB. Check SHIB 5m volume carefully.
- **Recommended approach**: Use wider z-score entry thresholds (2.5+) and tighter time stops (shorter maxHoldBars) to account for higher noise.

### Concrete Pair Testing List

| # | Symbol A | Symbol B | Category | Expected Corr | Timeframe | Priority |
|---|----------|----------|----------|---------------|-----------|----------|
| 1 | BTC/USDT | ETH/USDT | Major/Major | 0.65-0.85 | 5m, 15m | HIGH |
| 2 | BTC/USDT | LTC/USDT | Major/Major (PoW) | 0.70-0.85 | 5m, 15m | HIGH |
| 3 | SOL/USDT | AVAX/USDT | L1 Competitors | 0.70-0.85 | 5m, 15m | HIGH |
| 4 | ETH/USDT | BNB/USDT | L1 Platforms | 0.70-0.80 | 5m, 15m | MEDIUM |
| 5 | LINK/USDT | UNI/USDT | DeFi Infrastructure | 0.60-0.75 | 15m | MEDIUM |
| 6 | DOGE/USDT | SHIB/USDT | Meme Coins | 0.65-0.80 | 15m | LOW |

**Testing order**: Start with pairs 1-3 (highest probability of success), then validate with 4-6.

---

## Part 3: Recommended Test Periods

### Market Regime Analysis (2024-2025)

The strategy should be tested across multiple market regimes to ensure robustness:

| Period | Dates | Regime | BTC Range | Key Events |
|--------|-------|--------|-----------|------------|
| **Pre-ETF Rally** | 2023-10-01 to 2024-01-10 | Strong bull | $26K to $47K | Anticipation of spot BTC ETF |
| **ETF Launch + Halving** | 2024-01-11 to 2024-04-30 | Volatile bull | $42K to $64K | BTC ETF approved Jan 10, halving Apr 19-20 |
| **Consolidation** | 2024-05-01 to 2024-09-30 | Sideways/ranging | $55K to $72K | Post-halving digestion, ETH ETF approved |
| **Blow-off Rally** | 2024-10-01 to 2024-12-31 | Strong bull | $60K to $109K | Trump election, institutional FOMO |
| **Q1 2025 Correction** | 2025-01-01 to 2025-03-31 | Correction/bear | $109K to ~$85K | Altcoin crash (-41% ex-BTC), macro sensitivity |
| **Recovery + ATH** | 2025-04-01 to 2025-10-06 | Bull recovery | $85K to $126K | Institutional accumulation, new ATH |

### Recommended Test Configurations

#### Configuration 1: Walk-Forward (Primary)
- **Full period**: 2024-01-01 to 2025-06-30 (18 months)
- **Train ratio**: 0.70 (12.6 months train, 5.4 months test)
- **Why**: Captures ETF launch, halving, consolidation, rally, and correction regimes

#### Configuration 2: Regime-Specific Validation
Test each pair across distinct regimes to identify where the strategy works and fails:

| Test Name | From | To | Regime | Expected Behavior |
|-----------|------|----|--------|-------------------|
| Bull Market | 2024-01-01 | 2024-04-30 | Volatile bull | Mean reversion should work; spreads widen on momentum but revert |
| Sideways Market | 2024-05-01 | 2024-09-30 | Ranging | BEST conditions for mean reversion; stable spreads |
| Strong Trend | 2024-10-01 | 2024-12-31 | Strong bull | CHALLENGING; trend can dominate spread, causing correlation breakdown |
| Correction | 2025-01-01 | 2025-03-31 | Bear/correction | MIXED; altcoin correlation breakdown may hurt sector pairs |

#### Configuration 3: Minimal Quick Test
- **Period**: 2024-06-01 to 2024-12-31 (6 months)
- **Purpose**: Quick validation before full walk-forward
- **Train/test split**: 0.70

#### Data Availability Notes for 5m Timeframe
- 5m data on Binance: ~288 bars per day, ~8,640 per month
- 6-month test at 5m = ~51,840 bars (good statistical power)
- 18-month walk-forward at 5m = ~155,520 bars
- CCXT rate limiting may require batched fetching; our data caching in SQLite helps

---

## Part 4: Optimal Parameter Ranges from Research

### Z-Score Entry Threshold

**Key research finding**: The commonly used entry threshold of 2.0 may be too high for crypto pairs.

| Source | Optimal Entry | Context |
|--------|--------------|---------|
| Tadi & Kortchemski (2025) | alpha_1 = 0.20 (very low!) | Copula-based, 5-min crypto data |
| Parameter Optimization paper (2024, arxiv) | theta_in = 1.42 (std 0.3) | Optimized on S&P 500 equity pairs |
| Traditional literature | 2.0 | Standard textbook assumption |
| Backtesting practitioners | 1.5 - 2.5 | General recommendation |
| One crypto backtest | 2.5 | Best Sharpe (0.51) among tested values |

**Recommendation**: Test a wide range from 1.0 to 3.0. The academic research suggests lower thresholds (1.0-1.5) may produce better results on 5-minute crypto data due to more frequent trades and faster reversion. However, lower thresholds also increase transaction costs. The optimal value will depend on the specific pair's spread dynamics and the fee structure.

### Z-Score Exit Threshold

| Source | Optimal Exit | Context |
|--------|-------------|---------|
| Parameter Optimization paper (2024) | theta_out = 0.37 (std 0.13) | Optimized on equities |
| Traditional literature | 0.0 (mean crossing) | Standard assumption |
| Tadi (2025) | alpha_2 = 0.2 | Copula approach |
| Practitioners | 0.0 to 0.5 | Exit at or slightly above mean |

**Recommendation**: Test -0.5 to 0.5 with step 0.25. Exiting at 0.0 (exact mean) is the classic approach, but research suggests a small positive exit threshold (0.25-0.50) may capture most of the reversion while avoiding overshoot.

### Z-Score Stop Loss

| Source | Stop Z-Score | Context |
|--------|-------------|---------|
| Common practice | 3.0 - 4.0 | Standard stop at 3x-4x std dev |
| Conservative | 2.5 | Tight stop for pairs that can diverge |
| Aggressive | 5.0 | Wide stop, tolerates more spread widening |

**Recommendation**: Test 2.5 to 5.0. For 5-minute data, tighter stops (2.5-3.5) may be preferred to avoid holding losing positions through spread regime changes.

### Lookback Period (Hedge Ratio + Z-Score Rolling Window)

| Source | Lookback | Context |
|--------|----------|---------|
| Amberdata series | 60 days minimum | General recommendation |
| Crypto 5-min research | 1 day (288 bars) to 1 month | Faster adaptation for crypto |
| Traditional literature | 30-90 days | Equity pairs |
| FFT optimization (2024) | ~487 days | Cycle-based, likely too long for crypto |

**Recommendation for 5m timeframe**:
- **lookbackPeriod** (hedge ratio): 200-1000 bars (equivalent to ~17 hours to ~3.5 days on 5m). Crypto markets are faster-moving than equities; the hedge ratio should adapt within days, not months.
- **zScorePeriod** (rolling z-score window): 20-100 bars (equivalent to ~1.5 hours to ~8 hours on 5m). Shorter windows capture recent spread dynamics; longer windows provide more stable z-scores but may lag.

**Recommendation for 15m timeframe**:
- **lookbackPeriod**: 100-500 bars (~1 day to ~5 days)
- **zScorePeriod**: 15-60 bars (~3.75 hours to ~15 hours)

### Maximum Hold Bars (Time Stop)

**Recommendation for 5m**: 50-200 bars (4 hours to ~17 hours). If a trade has not reverted within a day, the cointegration relationship may have shifted.

**Recommendation for 15m**: 20-80 bars (5 hours to ~20 hours).

### Minimum Correlation Filter

**Recommendation**: 0.50 to 0.80. The filter prevents trading when the pair relationship breaks down. Higher thresholds are safer but reduce trade frequency.

### Position Size

**Recommendation**: 60-90% of capital per trade (split between both legs). Lower sizing reduces drawdown from correlation breakdown events.

---

## Part 5: Complete Parameter Grid for Optimization

### 5-Minute Timeframe Parameter Grid

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| lookbackPeriod | number | 200 | 800 | 100 | 400 | Hedge ratio lookback (bars) |
| zScorePeriod | number | 20 | 80 | 10 | 40 | Z-score rolling window (bars) |
| entryZScore | number | 1.0 | 3.0 | 0.25 | 1.75 | Entry threshold (absolute) |
| exitZScore | number | -0.25 | 0.50 | 0.25 | 0.0 | Mean reversion exit threshold |
| stopZScore | number | 2.5 | 4.5 | 0.5 | 3.5 | Stop loss threshold |
| maxHoldBars | number | 50 | 200 | 50 | 100 | Maximum holding period (bars) |
| positionSizePct | number | 60 | 90 | 10 | 80 | Capital allocation (%) |
| minCorrelation | number | 0.50 | 0.80 | 0.10 | 0.60 | Minimum correlation filter |

**Total combinations**: 7 x 7 x 9 x 4 x 5 x 4 x 4 x 4 = 564,480
**With maxCombinations=500**: Sampled subset will cover parameter space

**Recommended focused grid** (for initial screening, ~300 combos):

| Parameter | Values | Count |
|-----------|--------|-------|
| lookbackPeriod | 200, 400, 600 | 3 |
| zScorePeriod | 20, 40, 60 | 3 |
| entryZScore | 1.25, 1.75, 2.25, 2.75 | 4 |
| exitZScore | 0.0, 0.25 | 2 |
| stopZScore | 3.0, 4.0 | 2 |
| maxHoldBars | 100 (fixed) | 1 |
| positionSizePct | 80 (fixed) | 1 |
| minCorrelation | 0.60 (fixed) | 1 |

**Focused total**: 3 x 3 x 4 x 2 x 2 = 144 combinations (fast grid search)

### 15-Minute Timeframe Parameter Grid

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| lookbackPeriod | number | 100 | 400 | 50 | 200 | Hedge ratio lookback (bars) |
| zScorePeriod | number | 15 | 60 | 15 | 30 | Z-score rolling window (bars) |
| entryZScore | number | 1.0 | 3.0 | 0.25 | 1.75 | Entry threshold (absolute) |
| exitZScore | number | -0.25 | 0.50 | 0.25 | 0.0 | Mean reversion exit threshold |
| stopZScore | number | 2.5 | 4.5 | 0.5 | 3.5 | Stop loss threshold |
| maxHoldBars | number | 20 | 80 | 20 | 40 | Maximum holding period (bars) |
| positionSizePct | number | 60 | 90 | 10 | 80 | Capital allocation (%) |
| minCorrelation | number | 0.50 | 0.80 | 0.10 | 0.60 | Minimum correlation filter |

---

## Part 6: Transaction Cost Considerations

### Why Costs Matter More for Pairs Trading

Pairs trading involves **double the transactions** of directional trading:
- Opening a trade = 2 orders (long leg A, short leg B)
- Closing a trade = 2 more orders
- Total per round trip: 4 orders

At Binance maker/taker fees of 0.10%/0.10%:
- **Per round trip cost**: ~0.40% (4 x 0.10%)
- On 5m data with entryZScore=1.5, you may get 5-15 trades per day
- **Daily cost drag**: 2-6% of capital per day (significant!)

### Implications for Parameter Selection

1. **Lower entry thresholds (1.0-1.5)** generate more trades but may not cover costs on smaller spread moves
2. **Higher entry thresholds (2.0-2.5)** generate fewer trades with larger expected profit per trade, better suited to absorb costs
3. The **optimal entry threshold is a function of transaction costs**: the break-even entry z-score is roughly `4 * fee / spread_std_dev`
4. **VIP fee tiers** on Binance (0.02-0.04% maker) would significantly improve profitability

### Backtest Configuration

When running backtests:
- Set realistic slippage: 0.05% per side (0.10% round trip per leg)
- Set commission: 0.10% per trade (Binance default tier)
- Total cost model: ~0.30% per round trip (slightly less than theoretical 0.40% due to limit orders)

---

## Part 7: Risk Considerations by Pair

### Correlation Breakdown Events (Historical)

| Event | Date | Impact | Affected Pairs |
|-------|------|--------|----------------|
| FTX Collapse | Nov 2022 | SOL crashed 60%+ while BTC dropped ~25% | SOL/AVAX, any SOL pair |
| BTC ETF Approval | Jan 2024 | BTC rallied, ETH lagged; 60-day correlation dropped below 0.70 | BTC/ETH |
| ETH Merge | Sep 2022 | ETH decoupled from BTC for weeks | BTC/ETH |
| Luna/UST Crash | May 2022 | AVAX, SOL, and DeFi tokens crashed harder than BTC | All L1 and DeFi pairs |
| Binance Regulatory | Jun 2023, Nov 2023 | BNB-specific drops unrelated to other L1s | ETH/BNB |

### Risk Mitigation Strategies

1. **Correlation filter (minCorrelation)**: Do not trade when rolling correlation drops below threshold
2. **Time stops (maxHoldBars)**: Prevent holding through regime changes
3. **Z-score stop (stopZScore)**: Cut losses when spread diverges beyond expected range
4. **Position sizing**: Use 60-80% of capital, not 95%, to survive correlation breakdown events
5. **Pair diversification**: Run the strategy across multiple pairs simultaneously (when portfolio-level backtesting is available)

---

## Part 8: Testing Protocol

### Phase 1: Quick Validation (Per Pair)

For each of the 6 pairs, run a quick backtest with default parameters:

```bash
# Example for BTC/ETH pair on 5m
npx tsx src/cli/quant-backtest.ts \
  --strategy=pairs-zscore-scalper \
  --symbol=BTC/USDT \
  --symbolB=ETH/USDT \
  --from=2024-06-01 \
  --to=2024-12-31 \
  --timeframe=5m \
  --param.lookbackPeriod=400 \
  --param.zScorePeriod=40 \
  --param.entryZScore=1.75 \
  --param.exitZScore=0.0 \
  --param.stopZScore=3.5 \
  --param.maxHoldBars=100 \
  --param.minCorrelation=0.60
```

**Success criteria for Phase 1**:
- Generates > 20 trades
- Sharpe > 0.0 (positive risk-adjusted return)
- Win rate > 45%
- Max drawdown < 30%

### Phase 2: Grid Search Optimization (Top 3 Pairs)

Take the 3 best-performing pairs from Phase 1 and run grid search:

```bash
npx tsx src/cli/quant-optimize.ts \
  --strategy=pairs-zscore-scalper \
  --symbol=BTC/USDT \
  --symbolB=ETH/USDT \
  --from=2024-01-01 \
  --to=2024-12-31 \
  --timeframe=5m \
  --optimize-for=sharpeRatio \
  --max-combinations=500
```

### Phase 3: Walk-Forward Validation (Top 2 Pairs)

```bash
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=pairs-zscore-scalper \
  --symbol=BTC/USDT \
  --symbolB=ETH/USDT \
  --from=2024-01-01 \
  --to=2025-06-30 \
  --timeframe=5m \
  --train-ratio=0.70 \
  --optimize-for=sharpeRatio
```

**Success criteria for walk-forward**:
- Test Sharpe > 0.5
- OOS degradation < 30%
- Test period generates > 50 trades
- Max drawdown < 25%

### Phase 4: Regime Robustness Testing

For the best pair+params, test across each regime period separately to understand when the strategy works and fails.

### Phase 5: Timeframe Robustness

Re-test the best pair on 15m to confirm the edge is not timeframe-specific.

---

## Part 9: Expected Performance Benchmarks

### Based on Academic Literature

| Metric | 5m Frequency | 15m Frequency | Source |
|--------|-------------|---------------|--------|
| Monthly Return | 5-12% | 2-6% | Palazzi 2025, Tadi 2025 |
| Sharpe Ratio (annualized) | 1.5-3.8 | 0.8-2.0 | Tadi 2025 (Sharpe 3.77 at 5m) |
| Win Rate | 50-65% | 50-60% | General pairs trading literature |
| Max Drawdown | 10-25% | 8-20% | Estimated from reported returns |
| Profit Factor | 1.3-2.5 | 1.2-2.0 | Estimated |
| Trades per Month | 100-300 | 30-100 | Estimated from frequency |

### Realistic Expectations (After Costs)

The academic numbers are often before transaction costs or with optimistic cost assumptions. After realistic Binance costs:
- **Monthly return target**: 2-5% at 5m, 1-3% at 15m
- **Sharpe target**: 1.0-2.0 after costs
- **This is still excellent** - a Sharpe > 1.0 market-neutral strategy is institutional-grade

---

## Part 10: System Gaps and Considerations

### Current System Support

The pairs trading engine has been implemented (Phase 2 from Feb 7 build) with:
- Pairs portfolio management (long leg A, short leg B simultaneously)
- Pairs-specific strategy interface (PairsStrategy base)
- Z-Score scalper strategy already implemented
- CLI tools support for `--symbolB` parameter

### Potential Improvements

1. **Cointegration pre-test tool**: A CLI tool that runs ADF and Hurst tests on a pair before backtesting, saving time on obviously non-cointegrated pairs.
   - Complexity: Medium
   - Priority: High

2. **Dynamic hedge ratio**: The current implementation uses a rolling mean ratio. An OLS regression-based hedge ratio (Engle-Granger style) might perform better.
   - Complexity: Simple (code change in strategy)
   - Priority: Medium

3. **Copula-based signals**: Academic research (Tadi 2025) shows copula methods outperform standard z-score. This would be a more advanced extension.
   - Complexity: Complex
   - Priority: Low (for future research)

4. **Multi-pair portfolio**: Running the strategy across all 6 pairs simultaneously with portfolio-level risk management.
   - Complexity: Complex (requires portfolio engine extension)
   - Priority: Medium (for future)

---

## References

### Academic Papers

1. **Palazzi, R.B. (2025)**. "Trading Games: Beating Passive Strategies in the Bullish Crypto Market." *Journal of Futures Markets*, 45(11), 1911-1933.
   - URL: https://onlinelibrary.wiley.com/doi/full/10.1002/fut.70018
   - Key Finding: 5-minute frequency pairs trading returns 11.61% monthly vs -0.07% daily

2. **Tadi, M. & Kortchemski, I. (2025)**. "Copula-based trading of cointegrated cryptocurrency Pairs." *Financial Innovation*, 11(1).
   - URL: https://link.springer.com/article/10.1186/s40854-024-00702-7
   - Key Finding: 5-min data achieves 205.9% total return; copula method outperforms standard cointegration

3. **Gatev, E., Goetzmann, W.N. & Rouwenhorst, K.G. (2006)**. "Pairs Trading: Performance of a Relative-Value Arbitrage Rule." *Review of Financial Studies*, 19(3), 797-827.
   - Key Finding: Foundational pairs trading paper; demonstrates persistent profitability of distance method

4. **Avellaneda, M. & Lee, J.H. (2010)**. "Statistical Arbitrage in the U.S. Equities Market." *Quantitative Finance*, 10(7), 761-782.
   - Key Finding: PCA-based statistical arbitrage framework; mean reversion of residual returns

5. **Parameters Optimization of Pair Trading Algorithm (2024)**. arXiv preprint.
   - URL: https://arxiv.org/html/2412.12555v1
   - Key Finding: Optimal entry threshold = 1.42 (std 0.3), exit = 0.37 (std 0.13); lower than conventional 2.0/1.0

6. **Vidyamurthy, G. (2004)**. *Pairs Trading: Quantitative Methods and Analysis*. Wiley.
   - Key Finding: Comprehensive framework for cointegration-based pairs trading

### Industry Sources

7. **Amberdata Blog Series: Crypto Pairs Trading** (2024-2025)
   - Part 1 (Cointegration): https://blog.amberdata.io/crypto-pairs-trading-why-cointegration-beats-correlation
   - Part 2 (ADF/Hurst): https://blog.amberdata.io/crypto-pairs-trading-part-2-verifying-mean-reversion-with-adf-and-hurst-tests
   - Part 3 (Strategy Construction): https://blog.amberdata.io/constructing-your-strategy-with-logs-hedge-ratios-and-z-scores
   - Part 4 (Empirical Results): https://blog.amberdata.io/empirical-results-performance-analysis
   - Key Finding: ETC/FIL pair achieved 62% return, Sharpe 0.93 over 3 years with z-score approach

8. **QuantStart: Intraday Mean Reversion Pairs Strategy**
   - URL: https://www.quantstart.com/articles/Backtesting-An-Intraday-Mean-Reversion-Pairs-Strategy-Between-SPY-And-IWM/
   - Key Finding: Framework for intraday z-score pairs trading with rolling lookback windows

9. **BJF Trading Group: Optimizing Pairs Trading Using the Z-Index Technique**
   - URL: https://bjftradinggroup.com/optimizing-pair-trading-using-the-z-index-technique/
   - Key Finding: Dual z-score (long-term + short-term) can improve signal quality

10. **StatOasis: Understanding Z-Score in Mean Reversion**
    - URL: https://statoasis.com/post/understanding-z-score-and-its-application-in-mean-reversion-strategies
    - Key Finding: Exit threshold of 0.2 achieves highest Sharpe among tested values

### Correlation Data Sources

11. **Trading Economics Crypto Correlations**: https://tradingeconomics.com/crypto/correlations
12. **Coin Metrics Correlation Charts**: https://charts.coinmetrics.io/correlations
13. **DefiLlama Correlations**: https://defillama.com/correlation
14. **CoinHedge Correlations**: https://coinhedge.fund/correlations/

### Market Context

15. **The Block: BTC-ETH Correlation Hits Lowest Since 2021** (2024)
    - URL: https://www.theblock.co/post/273540/bitcoin-ether-correlation
    - Key Finding: 60-day rolling correlation dropped below 70% during BTC ETF launch

16. **ARK Invest: Bitcoin Cycles, Entering 2025**
    - URL: https://www.ark-invest.com/articles/analyst-research/bitcoin-cycles-entering-2025
    - Key Finding: 2024-2025 cycle context for market regime classification

---

## Change Log

**Version 1.0** - 2026-02-08
- Initial research compilation
- 6 specific pairs identified with rationale
- Parameter ranges synthesized from 10+ academic/industry sources
- Test periods mapped to market regimes
- Transaction cost analysis included

---

**END OF RESEARCH DOCUMENT**
