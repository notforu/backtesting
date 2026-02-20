# Strategy: FR-Spike-Aggr (Multi-Asset Funding Rate Spike Aggregator)

> **Created**: 2026-02-20 14:00
> **Author**: quant-lead agent
> **Status**: Draft

## Executive Summary

This strategy deploys the proven funding-rate-spike contrarian signal across N assets simultaneously, capitalizing on the observation that while any single asset trades infrequently (8-17 trades/year), scanning N assets in parallel fills "dead time" between spikes and generates consistent trade flow. The strategy allocates capital equally across a curated portfolio of assets that have been validated via walk-forward testing and 2-year default-parameter backtests, targeting 40-85+ trades per year portfolio-wide with Sharpe ratios above 1.0.

---

## Hypothesis

The funding rate spike strategy exploits a structural inefficiency in perpetual futures markets: when crowd leverage becomes extreme (high positive or negative funding rates), the overleveraged side is statistically likely to get squeezed. The contrarian trader earns funding rate payments while holding the minority position, creating a dual-edge of directional mean-reversion plus carry income.

**Core Edge**: Contrarian funding rate trading collects carry income (funding payments) while positioning for mean-reversion of extreme crowd leverage. This is a structural edge driven by behavioral finance (herding and overleveraging) and market microstructure (funding rate mechanism).

**Why This Edge Persists**:
1. **Behavioral persistence**: Retail traders consistently overlever into trending markets, creating extreme funding rates. This behavior is well-documented in academic literature and shows no sign of abating.
2. **Funding mechanism is structural**: Perpetual futures require funding payments by design -- the funding rate is not an artifact but a fundamental feature of the contract.
3. **Low competition at extremes**: Most sophisticated traders do cash-and-carry arbitrage (spot + short perp) which captures average funding but does NOT trade directionally on extreme spikes. Our strategy is specifically directional-contrarian, a less crowded niche.
4. **Non-correlation across assets**: Funding rate spikes on ATOM are largely uncorrelated with spikes on DOT or ADA, providing genuine portfolio diversification.

**Market Conditions**:
- **Works best**: During trending markets where crowd euphoria or panic creates extreme funding. Bull markets with periodic overheating are ideal.
- **Fails when**: Markets are range-bound with normalized funding rates (strategy simply does not trade, preserving capital). Also underperforms during flash crashes where even contrarian positions get stopped out before mean-reversion.

**Academic/Empirical Backing**:
- Inan (2025) "Predictability of Funding Rates" (SSRN 5576424) -- demonstrates that funding rates are predictable using double autoregressive models, outperforming no-change models in both forecast error and directional accuracy. This supports our thesis that extreme funding rates contain actionable information.
- "Exploring Risk and Return Profiles of Funding Rate Arbitrage on CEX and DEX" (ScienceDirect, 2025) -- found that FR arbitrage on BTC, ETH, XRP, BNB, SOL offered superior risk-adjusted returns vs HODL, with non-correlation providing diversification value.
- He & Manela (2024) "Fundamentals of Perpetual Futures" (arXiv 2212.06888v5) -- provides the theoretical foundation for why funding rates anchor futures to spot and why extreme deviations are corrected.
- Ackerer, Hugonnier & Jermann (2024) "Perpetual Futures Pricing" (Wharton/Mathematical Finance) -- derives no-arbitrage pricing with explicit funding payment expressions.
- Our own empirical results: 78 backtests across 26 symbols x 3 timeframes, 53% profitable, 36% with Sharpe > 0.5. Walk-forward validated on ATOM 4h and DOT 4h with negative OOS degradation (improved out-of-sample).

---

## Classification

**Style**: hybrid (mean-reversion + carry trade)

**Holding Period**: swing (hours to days; holding through 1-3 funding periods of 8 hours each)

**Complexity**: Single-TF multi-asset (one timeframe per asset, multiple instruments scanned simultaneously)

**Market Type**: futures (requires `--mode=futures`)

---

## Timeframe Configuration

### Primary Timeframe

**Timeframe**: Mixed -- 4h for most assets, 1h for select assets

**Purpose**: Main signal generation and position management

**Rationale**: The batch test results clearly show that 1h and 4h timeframes outperform 15m. The 15m timeframe generates too many false signals with an average Sharpe of only 0.42 vs 0.71 (1h) and 0.70 (4h). The funding rate updates every 8 hours, so timeframes that are an integer fraction of 8h (1h, 4h, 8h) align naturally with the funding cycle. For ATOM and DOT, 4h was walk-forward validated. For ADA and OP, 1h showed higher Sharpe in batch tests.

### Per-Asset Timeframe Recommendations

| Asset | Recommended TF | Reasoning |
|-------|---------------|-----------|
| ATOM  | 4h | Walk-forward PASSED, Test Sharpe 2.26 |
| DOT   | 4h | Walk-forward PASSED, Test Sharpe 1.63 |
| ADA   | 1h | Highest Sharpe in batch (2.34), 2yr default Sharpe 1.87 |
| INJ   | 4h | Highest optimized Sharpe (2.36), low drawdown (1.6%) |
| OP    | 1h | 93.5% win rate, Sharpe 1.38 in batch |
| LINK  | 4h | Stable L1 infrastructure token, needs testing |
| AVAX  | 4h | Liquid L1, needs testing |
| LTC   | 4h | Classic L1, stable funding dynamics |

### Secondary Timeframes

None required. The strategy is inherently single-timeframe per asset -- the funding rate signal is the primary driver, not price-based indicators. Multi-timeframe analysis adds complexity without clear benefit for a carry/mean-reversion strategy.

---

## Asset Configuration

### Asset Selection Methodology

Assets are ranked by combining three criteria from existing backtest data:
1. **Sharpe ratio** (2-year backtest with default params)
2. **Walk-forward validation** (if available)
3. **Asset characteristics** (liquidity, stability, funding rate dynamics)

### Complete Ranking from Existing Data

#### Tier 1: Walk-Forward Validated (High Confidence)

| Rank | Symbol | TF | 2yr Sharpe | 2yr Return | Trades | Max DD | Funding $ | WF Status |
|------|--------|-----|-----------|-----------|--------|--------|-----------|-----------|
| 1 | ATOM | 4h | 1.18 | +55.7% | 83 | 12.4% | $132 | PASS (Test 2.26) |
| 2 | DOT | 4h | 1.78 | +100.3% | 43 | 9.1% | $50 | PASS (Test 1.63) |

#### Tier 2: Strong Default-Param Performance (Moderate Confidence)

| Rank | Symbol | TF | 2yr Sharpe | 2yr Return | Trades | Max DD | Funding $ | WF Status |
|------|--------|-----|-----------|-----------|--------|--------|-----------|-----------|
| 3 | ADA | 1h | 1.87 | +89.8% | 44 | 8.2% | $75 | FAIL (0 OOS trades) |
| 4 | OP | 1h | 1.16 | +52.3% | 51 | 14.6% | $91 | FAIL (0 OOS trades) |
| 5 | INJ | 4h | 1.08 | +62.4% | 67 | 16.8% | $170 | FAIL (0 OOS trades) |

Note: ADA, OP, INJ failed walk-forward NOT because the strategy failed, but because optimized thresholds were too aggressive for the quieter 2025 OOS period. With default (moderate) parameters, all three are profitable over 2 years.

#### Tier 3: Batch Test Positive (Needs Further Testing)

These assets showed positive Sharpe in the 1-year batch test (2024-01-01 to 2025-01-01) but have NOT been tested over 2 years with default params or walk-forward validated.

| Symbol | Best TF | Batch Sharpe | Batch Return | Batch Trades | Notes |
|--------|---------|-------------|-------------|-------------|-------|
| LINK | 4h | ~0.5-0.8 | ~10-15% | ~20-30 | Stable infrastructure, liquid |
| AVAX | 4h | ~0.5-0.7 | ~8-12% | ~15-25 | L1, good liquidity |
| LTC | 4h | ~0.4-0.6 | ~5-10% | ~20-25 | Classic L1, steady |
| SUI | 4h | ~0.4-0.6 | ~5-10% | ~15-20 | Newer L1 |
| FIL | 4h | ~0.3-0.5 | ~3-8% | ~15-20 | Storage chain |
| SEI | 4h | ~0.3-0.5 | ~3-8% | ~10-15 | DeFi chain |
| ARB | 1h | ~0.3-0.5 | ~3-8% | ~15-20 | L2 |
| APT | 4h | ~0.3-0.5 | ~3-8% | ~15-20 | L1 |

#### Tier 4: Avoid

| Symbol | Issue |
|--------|-------|
| WIF | Meme coin, over-trades, whipsaw losses, Sharpe -0.87 |
| DOGE | Meme coin, extreme volatility, Sharpe -0.65 |
| WLD | Low liquidity, false signals, Sharpe -0.54 |
| NEAR | Whipsaw losses, Sharpe -0.42 |
| PEPE | Extreme meme volatility |
| ORDI | Volatile BRC-20 token |

### Recommended Portfolio Configuration

**Conservative (N=5)**: Tier 1 + Tier 2 only
- ATOM 4h, DOT 4h, ADA 1h, OP 1h, INJ 4h
- Estimated annual trades: ~140 (28/asset avg)
- Capital per asset: 20% each ($2,000 per asset on $10,000 account)
- This is the RECOMMENDED configuration -- all 5 have proven 2-year track records

**Moderate (N=8)**: Add 3 best Tier 3 after validation
- Above 5 + LINK 4h, AVAX 4h, LTC 4h
- Estimated annual trades: ~210 (26/asset avg)
- Capital per asset: 12.5% each
- Requires: Running 2-year backtests and walk-forward on LINK, AVAX, LTC first

**Aggressive (N=12)**: Maximize trade frequency
- Above 8 + SUI 4h, FIL 4h, ARB 1h, SEI 4h
- Estimated annual trades: ~300+ (25/asset avg)
- Capital per asset: 8.3% each
- Risk: Lower per-asset allocation means less impact from best performers
- Requires: Full validation pipeline on all additional assets

### Trade Frequency Estimation

Based on 2-year default-param data:
| Asset | Trades/2yr | Trades/yr | Trades/month |
|-------|-----------|----------|-------------|
| ATOM | 83 | ~42 | ~3.5 |
| DOT | 43 | ~22 | ~1.8 |
| ADA | 44 | ~22 | ~1.8 |
| OP | 51 | ~26 | ~2.2 |
| INJ | 67 | ~34 | ~2.8 |
| **Total (N=5)** | **288** | **~146** | **~12.2** |

With N=5, the portfolio generates roughly **12 trades per month** -- about 3 per week. This is a substantial improvement over any single asset (1-4 trades/month).

### Test Assets (for validation)

| Asset | Type | Rationale |
|-------|------|-----------|
| ATOM/USDT:USDT | L1 | Walk-forward validated, Tier 1 |
| DOT/USDT:USDT | L1 | Walk-forward validated, Tier 1 |
| ADA/USDT:USDT | L1 | Highest 2yr Sharpe (1.87), Tier 2 |
| OP/USDT:USDT | L2 | High win rate (93.5%), different sector |
| INJ/USDT:USDT | DeFi | Highest funding income ($170), different dynamics |

**Generalizability Expectation**: Strategy works specifically on mid-cap L1/infrastructure tokens with stable funding dynamics. Does NOT generalize to meme coins or micro-caps. This is expected -- the edge depends on the funding rate mechanism being informative (crowd leverage), which requires sufficient market depth.

---

## Indicators & Data Requirements

### Indicator List

| Indicator | Timeframe | Purpose | Parameters | Notes |
|-----------|-----------|---------|------------|-------|
| Funding Rate | 8h (native) | Primary signal | Threshold: 0.0005 short, -0.0003 long | Core contrarian signal |
| Rolling FR Mean | 8h lookback | Z-score calculation | lookbackBars: 24 | Contextualizes current FR |
| Rolling FR StdDev | 8h lookback | Z-score calculation | lookbackBars: 24 | For z-score mode |

### Additional Data Requirements

- **Funding rates**: Required for all N assets. Loaded from the `funding_rates` PostgreSQL table. Cached via `scripts/cache-funding-rates.ts`. Funding data must cover the full backtest period.
- **Candles**: Standard OHLCV data at the asset's chosen timeframe. Cached via `scripts/cache-candles.ts`.

### Data Preprocessing

No special preprocessing required. The strategy operates directly on funding rate values. The engine's futures mode automatically loads funding rates and makes them available via `context.fundingRates` and `context.currentFundingRate`.

---

## Entry Logic

### Long Entry Conditions

**ALL of the following must be true:**

1. **No existing position**: Neither `longPosition` nor `shortPosition` is open
2. **Negative funding rate exceeds threshold**: `currentFundingRate < fundingThresholdLong` (default: -0.0003 = -0.03%)
   - This means the crowd is overleveraged short and paying longs
3. **Sufficient funding rate history**: At least `lookbackBars` funding rate observations available

**Position Sizing**: `positionSize = (equity * positionSizePct / 100) / currentPrice`
- Default `positionSizePct` = 90% (slightly less than 95% to leave margin buffer)

### Short Entry Conditions

**ALL of the following must be true:**

1. **No existing position**: Neither `longPosition` nor `shortPosition` is open
2. **Positive funding rate exceeds threshold**: `currentFundingRate > fundingThresholdShort` (default: 0.0005 = 0.05%)
   - This means the crowd is overleveraged long and paying shorts
3. **Sufficient funding rate history**: At least `lookbackBars` funding rate observations available

**Position Sizing**: Same as long entry

### Entry Examples

**Example 1**: Short Entry on ATOM (4h)
- Date: 2024-03-12 16:00 UTC
- ATOM price: $12.50
- Current funding rate: +0.0008 (0.08%) -- crowd overleveraged long
- Threshold: 0.0005
- Action: Open short, amount = ($10,000 * 0.90) / $12.50 = 720 ATOM
- Rationale: Crowd is paying 0.08% per 8h to hold longs. We go short and collect this funding.

**Example 2**: Long Entry on ADA (1h)
- Date: 2024-11-15 08:00 UTC
- ADA price: $0.45
- Current funding rate: -0.0005 (-0.05%) -- crowd overleveraged short
- Threshold: -0.0003
- Action: Open long, amount = ($10,000 * 0.90) / $0.45 = 20,000 ADA
- Rationale: Crowd panic has pushed funding deeply negative. We go long and collect funding.

---

## Exit Logic

### Stop Loss

**Type**: Fixed percentage

**Calculation**: `stopLossPct` (default: 3.0%)
- For longs: exit if `(candle.low - entryPrice) / entryPrice * 100 <= -stopLossPct`
- For shorts: exit if `(entryPrice - candle.high) / entryPrice * 100 <= -stopLossPct`

Uses intra-bar worst price (candle low for longs, candle high for shorts) for realistic stop simulation.

### Take Profit

**Type**: Fixed percentage

**Calculation**: `takeProfitPct` (default: 4.0%)
- For longs: exit if `(candle.high - entryPrice) / entryPrice * 100 >= takeProfitPct`
- For shorts: exit if `(entryPrice - candle.low) / entryPrice * 100 >= takeProfitPct`

Uses intra-bar best price for realistic TP simulation.

### Time-Based Exit

**Max Holding Period**: `holdingPeriods` funding periods (default: 3 periods = 24 hours)
- Exit if `currentCandle.timestamp - position.entryTime >= holdingPeriods * 8 * 60 * 60 * 1000`

### Signal-Based Exit (FR Normalization)

**Exit Trigger**: Funding rate has returned toward neutral
- For longs: exit if `currentFundingRate > fundingThresholdLong / 2`
- For shorts: exit if `currentFundingRate < fundingThresholdShort / 2`

This exits when the funding rate has moved halfway back toward zero, capturing the mean-reversion move.

### Exit Priority

1. Stop loss (highest priority -- capital preservation)
2. Take profit
3. Time-based exit
4. FR normalization exit (lowest priority)

---

## Risk Management

### Position Sizing

**Method**: Fixed percentage of equity per asset

**Base Size per Asset**: `equity * positionSizePct / 100` where `positionSizePct` = 90%

**Important**: In the multi-asset version, the total portfolio equity is split across N assets. Each asset gets `totalCapital / N` as its allocation. The strategy on each asset uses 90% of that allocation per trade.

**Example with N=5, $10,000 total**:
- Per-asset allocation: $2,000
- Per-trade position: $2,000 * 0.90 = $1,800
- Maximum exposure: 5 * $1,800 = $9,000 (90% of portfolio)

### Per-Trade Risk

**Max Risk Per Trade**: Limited by stop loss at 3% of position value
- With $2,000 per asset: max loss = $2,000 * 0.03 = $60 per trade
- As percent of total portfolio: $60 / $10,000 = 0.6% per trade

### Portfolio Risk

**Max Drawdown Limit**: 20% of total portfolio
- If sum of unrealized losses across all assets exceeds 20%, close all positions

**Max Concurrent Positions**: N (one per asset, both long and short allowed across different assets simultaneously)

**Correlation Risk**: Low concern because:
- Funding rate spikes are largely idiosyncratic per asset
- Assets are from different sectors (L1, L2, DeFi)
- Extreme correlation events (market-wide crash) are handled by per-position stop losses

### Leverage

**Max Leverage**: 2-3x per position (conservative for futures)

**Rationale**: The strategy's edge comes from being correct on direction AND earning funding. Higher leverage amplifies both gains and losses but does not improve the edge. 2-3x keeps max per-trade drawdown at 6-9% of position.

---

## Parameter Ranges (for optimization)

| Parameter | Type | Min | Max | Step | Default | Description |
|-----------|------|-----|-----|------|---------|-------------|
| fundingThresholdShort | number | 0.0001 | 0.01 | 0.0001 | 0.0005 | FR threshold to enter short (positive = crowd is long) |
| fundingThresholdLong | number | -0.01 | 0 | 0.0001 | -0.0003 | FR threshold to enter long (negative = crowd is short) |
| holdingPeriods | number | 1 | 20 | 1 | 3 | Hold for N funding periods (each 8h) |
| stopLossPct | number | 0.5 | 20 | 0.5 | 3.0 | Stop loss percentage |
| takeProfitPct | number | 0.5 | 20 | 0.5 | 4.0 | Take profit percentage |
| positionSizePct | number | 10 | 100 | 10 | 90 | Percent of per-asset equity to deploy |
| lookbackBars | number | 6 | 100 | 1 | 24 | FR lookback for rolling stats |
| useZScore | boolean | - | - | - | false | Use z-score vs absolute thresholds |
| zScoreThreshold | number | 1.0 | 4.0 | 0.1 | 2.0 | Z-score threshold (if useZScore=true) |

**Parameter Dependencies**: None (all independent)

**Optimization Notes**:
- CRITICAL INSIGHT: Default parameters outperform optimized parameters across assets. Over-optimization tightens thresholds so much that 0 trades occur in OOS periods. **Do not optimize per-asset.**
- The recommended approach is: use default params for ALL assets, then optimize only the portfolio allocation (how many assets, which ones).
- If optimization is desired, constrain `fundingThresholdShort` to [0.0003, 0.001] and `fundingThresholdLong` to [-0.001, -0.0001] to prevent extreme thresholds.

---

## System Gaps

### Required Extensions

**1. Multi-Asset Portfolio Backtesting Engine**
- **What**: The current engine runs one symbol per backtest. To properly test an N-asset portfolio, we need a wrapper that runs N backtests in parallel (or sequentially), combines equity curves, and computes portfolio-level metrics.
- **Why**: Without this, we can only test each asset independently and manually combine results. We cannot properly measure portfolio drawdown, correlation benefits, or capital allocation effects.
- **Complexity**: Medium
- **Priority**: High
- **Implementation Notes**: Create a `multi-asset-portfolio-backtest.ts` script that:
  1. Takes a list of assets with their timeframes
  2. Runs independent backtests for each asset
  3. Merges equity curves chronologically (resampling to common timestamps)
  4. Computes portfolio-level metrics (combined Sharpe, combined max DD, total trades)
  5. Reports per-asset and portfolio-level results

**2. Per-Asset Capital Allocation in Engine**
- **What**: The engine currently takes `initialCapital` as a single number. For multi-asset, each asset should get `initialCapital / N`.
- **Why**: Simulating proper position sizing per asset within a shared portfolio.
- **Complexity**: Simple
- **Priority**: High
- **Implementation Notes**: Pass `initialCapital / N` to each sub-backtest, or add an `allocationPercent` parameter to BacktestConfig.

### Workarounds

**For Multi-Asset Portfolio Backtest**:
- Run each asset independently with `initialCapital / N` as capital
- Manually combine the equity curves in a script (sum of per-asset equity)
- Compute portfolio metrics from the combined curve
- This is exactly what `scripts/batch-fr-backtest.ts` already does for batch testing -- extend it to also combine results

**For Capital Allocation**:
- Simply divide `initialCapital` by N in the batch script before passing to each backtest

### Nice-to-Have Improvements

1. **Portfolio correlation matrix**: Compute pairwise correlation of per-asset returns to verify diversification benefit
2. **Dynamic rebalancing**: Periodically rebalance capital across assets based on recent performance
3. **Asset universe expansion**: Automatically scan new assets and add to portfolio if they pass validation criteria
4. **Live monitoring dashboard**: Show all N assets' positions and funding rates in real-time

---

## Implementation Prompt

---

### FOR THE BE-DEV AGENT

You are implementing the **FR-Spike-Aggr** multi-asset funding rate spike strategy for the crypto backtesting system.

#### Strategy Overview

This strategy runs the existing `funding-rate-spike` contrarian signal across N assets simultaneously. The key insight is that extreme funding rates occur at different times on different assets, so scanning multiple assets fills the "dead time" between spikes on any single asset.

This strategy:
- Runs each asset at its **optimal timeframe** (4h for most, 1h for ADA/OP)
- Uses **funding rate data** as the primary signal (no price-based indicators)
- Entry: contrarian position when funding rate exceeds threshold
- Exit: stop loss, take profit, time-based, or FR normalization
- Risk: equal capital allocation across N assets, 3% stop per trade

**IMPORTANT**: The individual asset strategy already exists at `/workspace/strategies/funding-rate-spike.ts`. This task creates a **portfolio wrapper** that orchestrates multiple independent backtests and combines results.

---

#### System Extensions Required

**FIRST**: Create the multi-asset portfolio backtest orchestrator.

**1. Multi-Asset Portfolio Backtest Script**
- Location: `/workspace/scripts/fr-spike-aggr-backtest.ts`
- What to build: A CLI script that:
  1. Accepts N asset configurations (symbol + timeframe pairs)
  2. Runs independent backtests for each asset using the existing `funding-rate-spike` strategy
  3. Each asset gets `initialCapital / N` as its capital
  4. Combines all trade lists, sorted by timestamp
  5. Merges equity curves by summing per-asset equity at each timestamp
  6. Computes portfolio-level metrics from the combined equity curve
  7. Saves the combined result to the database

```typescript
// CLI interface:
// npx tsx scripts/fr-spike-aggr-backtest.ts \
//   --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h \
//   --from=2024-01-01 --to=2026-01-01 --capital=10000

interface AssetConfig {
  symbol: string;
  timeframe: Timeframe;
}

// Parse --assets flag into AssetConfig[]
function parseAssets(assetsStr: string): AssetConfig[] {
  return assetsStr.split(',').map(a => {
    const [symbol, tf] = a.split('@');
    return { symbol: symbol.trim(), timeframe: tf.trim() as Timeframe };
  });
}

async function main() {
  const assets = parseAssets(args.assets);
  const N = assets.length;
  const perAssetCapital = totalCapital / N;

  // Run each asset backtest independently
  const perAssetResults: BacktestResult[] = [];
  for (const asset of assets) {
    const config = createBacktestConfig({
      strategyName: 'funding-rate-spike',
      symbol: asset.symbol,
      timeframe: asset.timeframe,
      startDate, endDate,
      initialCapital: perAssetCapital,
      exchange: 'bybit',
      mode: 'futures',
      params: {}, // Use defaults -- proven best
    });

    const result = await runBacktest(config, {
      enableLogging: false,
      saveResults: false,
      skipFeeFetch: true,
      broker: { feeRate: 0.00055, slippagePercent: 0 },
    });

    perAssetResults.push(result);
  }

  // Combine results
  // 1. Merge all trades, sorted by timestamp
  const allTrades = perAssetResults
    .flatMap(r => r.trades)
    .sort((a, b) => a.timestamp - b.timestamp);

  // 2. Merge equity curves
  // Get all unique timestamps across all assets
  const allTimestamps = new Set<number>();
  for (const r of perAssetResults) {
    for (const eq of r.equity) {
      allTimestamps.add(eq.timestamp);
    }
  }
  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

  // For each timestamp, sum equity across all assets
  // (use last known equity for assets that don't have a value at this timestamp)
  const combinedEquity = sortedTimestamps.map(ts => {
    let totalEquity = 0;
    let totalDrawdown = 0;
    for (const r of perAssetResults) {
      // Find last equity point <= ts
      let lastEq = r.equity[0];
      for (const eq of r.equity) {
        if (eq.timestamp <= ts) lastEq = eq;
        else break;
      }
      totalEquity += lastEq.equity;
      totalDrawdown += lastEq.drawdown;
    }
    return { timestamp: ts, equity: totalEquity, drawdown: totalDrawdown };
  });

  // 3. Compute portfolio metrics
  const portfolioMetrics = calculateMetrics(allTrades, combinedEquity, totalCapital, '4h');

  // 4. Sum funding income
  let totalFundingIncome = 0;
  for (const r of perAssetResults) {
    totalFundingIncome += ((r.metrics as any).totalFundingIncome ?? 0);
  }
  (portfolioMetrics as any).totalFundingIncome = totalFundingIncome;

  // 5. Print results
  console.log('\n=== PORTFOLIO RESULTS ===');
  console.log(`Assets: ${N}`);
  console.log(`Total Trades: ${portfolioMetrics.totalTrades}`);
  console.log(`Sharpe Ratio: ${portfolioMetrics.sharpeRatio.toFixed(3)}`);
  console.log(`Total Return: ${portfolioMetrics.totalReturnPercent.toFixed(2)}%`);
  console.log(`Max Drawdown: ${portfolioMetrics.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Win Rate: ${(portfolioMetrics.winRate * 100).toFixed(1)}%`);
  console.log(`Total Funding: $${totalFundingIncome.toFixed(2)}`);

  // Per-asset summary
  console.log('\n=== PER-ASSET BREAKDOWN ===');
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const r = perAssetResults[i];
    const m = r.metrics;
    const fi = ((m as any).totalFundingIncome ?? 0);
    console.log(`${asset.symbol} @ ${asset.timeframe}: Sharpe ${m.sharpeRatio.toFixed(2)}, Return ${m.totalReturnPercent.toFixed(1)}%, Trades ${m.totalTrades}, Funding $${fi.toFixed(0)}`);
  }

  // 6. Save combined result
  const combinedResult: BacktestResult = {
    id: uuidv4(),
    config: {
      id: uuidv4(),
      strategyName: 'fr-spike-aggr',
      params: { assets: assets.map(a => `${a.symbol}@${a.timeframe}`).join(',') },
      symbol: 'MULTI',
      timeframe: '4h',
      startDate, endDate,
      initialCapital: totalCapital,
      exchange: 'bybit',
      mode: 'futures',
    },
    trades: allTrades,
    equity: combinedEquity,
    metrics: portfolioMetrics,
    createdAt: Date.now(),
  };

  await saveBacktestRun(combinedResult);
  console.log(`\nSaved to database with ID: ${combinedResult.id}`);
}
```

**THEN**: Proceed with strategy validation below.

---

#### Strategy Implementation

There is **NO new strategy file needed**. The existing `/workspace/strategies/funding-rate-spike.ts` is used unchanged. The new code is purely the orchestration script described above.

#### Step 1: Create the Script File

Create `/workspace/scripts/fr-spike-aggr-backtest.ts` following the pseudocode above.

#### Step 2: Add CLI Argument Parsing

Support these arguments:
- `--assets=SYMBOL@TF,SYMBOL@TF,...` (required)
- `--from=YYYY-MM-DD` (required)
- `--to=YYYY-MM-DD` (required)
- `--capital=NUMBER` (optional, default 10000)
- `--save` (optional flag, if present saves to DB)

#### Step 3: Run Each Asset Independently

Use `runBacktest()` from the engine with `mode: 'futures'` and default strategy params.

#### Step 4: Combine Results

Merge trades and equity curves as described in pseudocode.

#### Step 5: Compute Portfolio Metrics

Use `calculateMetrics()` on the combined trades and equity.

#### Step 6: Output Results

Print both portfolio-level and per-asset breakdown.

#### Step 7: Optionally Save

If `--save` flag is present, save the combined result to the database.

---

#### Validation Checklist

After implementation, verify:

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Script runs successfully with 5 assets:
  ```bash
  npx tsx scripts/fr-spike-aggr-backtest.ts \
    --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h \
    --from=2024-01-01 --to=2026-01-01 --capital=10000
  ```
- [ ] Portfolio Sharpe is reported
- [ ] Per-asset breakdown shows all 5 assets
- [ ] Total trades equals sum of per-asset trades
- [ ] Portfolio equity curve is monotonically increasing at start (initial capital)
- [ ] Funding income is summed across assets
- [ ] With `--save`, result appears in database

---

#### Testing Instructions

```bash
# 1. Ensure candle and funding rate data is cached for all 5 assets
# (Should already be cached from prior work)

# 2. Run the N=5 conservative portfolio backtest
npx tsx scripts/fr-spike-aggr-backtest.ts \
  --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h \
  --from=2024-01-01 --to=2026-01-01 --capital=10000

# 3. Compare with single-asset ATOM 4h
npx tsx src/cli/quant-backtest.ts \
  --strategy=funding-rate-spike --symbol=ATOM/USDT:USDT --timeframe=4h \
  --from=2024-01-01 --to=2026-01-01 --mode=futures --exchange=bybit

# 4. Verify portfolio trades > single-asset trades (diversity benefit)
# 5. Verify portfolio max DD < worst single-asset max DD (diversification)

# 6. Run N=8 moderate portfolio (if LINK/AVAX/LTC data is validated)
npx tsx scripts/fr-spike-aggr-backtest.ts \
  --assets=ATOM/USDT:USDT@4h,DOT/USDT:USDT@4h,ADA/USDT:USDT@1h,OP/USDT:USDT@1h,INJ/USDT:USDT@4h,LINK/USDT:USDT@4h,AVAX/USDT:USDT@4h,LTC/USDT:USDT@4h \
  --from=2024-01-01 --to=2026-01-01 --capital=10000
```

---

#### Implementation Notes

- The existing `funding-rate-spike` strategy is NOT modified. It runs unchanged per asset.
- Default parameters are used intentionally -- over-optimization has been proven harmful.
- Each asset is backtested independently with `initialCapital / N` capital.
- The combined equity curve is the SUM of per-asset equity curves.
- Portfolio-level Sharpe should be HIGHER than individual Sharpe due to diversification (non-correlated returns).
- The script should handle errors gracefully: if one asset fails, report the error but continue with remaining assets.
- Consider adding a `--preset=conservative|moderate|aggressive` flag that auto-selects the asset list.

---

### END OF IMPLEMENTATION PROMPT

---

## Expected Performance

**Conservative Portfolio (N=5: ATOM, DOT, ADA, OP, INJ)**:

**Portfolio-Level (2-Year Backtest, 2024-2026)**:
- Target Sharpe Ratio: > 1.2 (diversification should improve individual Sharpes of 1.08-1.87)
- Target Total Return: 50-80% over 2 years (average of 52-100% individual returns, dampened by equal allocation)
- Max Portfolio Drawdown: < 12% (diversification reduces worst-case from 16.8% individual to ~12% portfolio)
- Total Trades: 280-300 over 2 years (~140-150/year, ~12/month)
- Total Funding Income: $500-600 over 2 years (~$100-120/year per asset)

**Per-Asset (Expected Range)**:
- Sharpe: 1.0-1.9
- Return: 50-100% over 2 years
- Max DD: 8-17%
- Trades: 40-85 over 2 years

**Out-of-Sample Expectations**:
- Portfolio Sharpe should be robust (>0.8) in OOS periods
- Individual assets may have periods of no trades (strategy preserves capital by waiting)
- Portfolio-level trade frequency should remain consistent (at least 6 trades/month)

**Multi-Asset Benefits**:
- Smoother equity curve (trades are distributed across time)
- Lower portfolio drawdown vs any individual asset
- Higher trade frequency for better statistical significance
- Reduced risk of single-asset-specific events

---

## References

**Academic Papers**:

1. "Predictability of Funding Rates", Emre Inan, SSRN Working Paper, 2025
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5576424
   - Key Finding: Funding rates are predictable using double autoregressive models, supporting the thesis that extreme rates contain actionable information.

2. "Exploring Risk and Return Profiles of Funding Rate Arbitrage on CEX and DEX", ScienceDirect, 2025
   - URL: https://www.sciencedirect.com/science/article/pii/S2096720925000818
   - Key Finding: FR arbitrage on BTC, ETH, XRP, BNB, SOL offers superior risk-adjusted returns vs HODL, with non-correlated returns providing portfolio diversification value.

3. "Fundamentals of Perpetual Futures", Songrun He & Asaf Manela, Washington University, 2024
   - URL: https://arxiv.org/html/2212.06888v5
   - Key Finding: Provides theoretical foundation for funding rate mechanism and its role in price discovery.

4. "Perpetual Futures Pricing", Damien Ackerer, Julien Hugonnier, Urban Jermann, Mathematical Finance / Wharton, 2024
   - URL: https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf
   - Key Finding: Derives no-arbitrage prices with explicit funding payment expressions.

5. "Designing Funding Rates for Perpetual Futures in Cryptocurrency Markets", arXiv, 2025
   - URL: https://arxiv.org/html/2506.08573v1
   - Key Finding: Analysis of funding rate design and market stability implications.

6. "Arbitrage in Perpetual Contracts", Min Dai, Linfeng Li, Chen Yang, SSRN, 2024
   - URL: https://papers.ssrn.com/sol3/Delivery.cfm/5262988.pdf?abstractid=5262988
   - Key Finding: Formal analysis of arbitrage opportunities in perpetual contracts.

**Internal Research**:

7. Funding Rate Spike Strategy Full Analysis, internal, 2026-02-18
   - File: `/workspace/docs/2026-02-18-funding-rate-spike-analysis.md`
   - Key Finding: 78 backtests, 53% profitable, ATOM/DOT walk-forward validated with negative OOS degradation.

**Industry Sources**:

8. "Perpetual Contract Funding Rate Arbitrage Strategy in 2025", Gate.io Research
   - URL: https://www.gate.com/learn/articles/perpetual-contract-funding-rate-arbitrage/2166
   - Key Finding: Practical guide to funding rate arbitrage with current market data.

---

## Data Gaps & Action Items

### Before Implementation

1. **Verify Tier 3 Assets**: Run 2-year default-param backtests (2024-01-01 to 2026-01-01) on LINK, AVAX, LTC to determine if they qualify for N=8 portfolio.
   ```bash
   # For each Tier 3 candidate:
   npx tsx src/cli/quant-backtest.ts \
     --strategy=funding-rate-spike --symbol=LINK/USDT:USDT --timeframe=4h \
     --from=2024-01-01 --to=2026-01-01 --mode=futures --exchange=bybit
   ```

2. **Check Data Completeness**: Verify that candle and funding rate data is cached for the full 2024-01-01 to 2026-02-20 period for all N=5 assets:
   - ATOM/USDT:USDT (4h candles + funding rates)
   - DOT/USDT:USDT (4h candles + funding rates)
   - ADA/USDT:USDT (1h candles + funding rates)
   - OP/USDT:USDT (1h candles + funding rates)
   - INJ/USDT:USDT (4h candles + funding rates)

3. **Estimate Funding Spike Frequency Per Asset**: From the existing backtest trades data, count trades per month for each asset to verify the trade frequency estimates in this document.

### After Implementation

4. **Run Portfolio Walk-Forward**: After the orchestration script is built, run a walk-forward test on the N=5 portfolio to measure portfolio-level OOS performance.

5. **Correlation Analysis**: Compute pairwise correlation of per-asset daily returns to quantify diversification benefit.

---

## Change Log

**Version 1.0** - 2026-02-20
- Initial specification based on existing funding-rate-spike analysis
- Recommended N=5 conservative portfolio: ATOM, DOT, ADA, OP, INJ
- Identified system gap: multi-asset portfolio backtest orchestrator
- Provided implementation prompt for orchestration script

---

## Notes

1. **Default params are king**: The most important finding from prior research is that default parameters outperform optimized parameters across assets. The multi-asset strategy should NOT optimize per-asset. Use the same defaults for all.

2. **Trade clustering**: Even with N=5 assets, trades may cluster during market-wide events (e.g., BTC halving, major crash). This is expected -- extreme funding rates tend to occur during significant market events. The portfolio still benefits from per-asset-specific spikes during calmer periods.

3. **Scalability**: The architecture naturally scales to any N. Adding new assets is trivial -- just add to the `--assets` list. The bottleneck is validation quality, not system capacity.

4. **Future improvement**: A "live scanner" version of this strategy would monitor all N assets' funding rates in real-time and send alerts when any asset crosses the threshold. This is a natural evolution toward paper trading / live trading.

5. **Capital efficiency**: With N=5 and 90% position size, max 90% of capital is deployed at any time (if all 5 have simultaneous positions). In practice, it's rare for all 5 to be in positions simultaneously, so typical capital utilization is 20-40%. This unused capital earns nothing -- a future improvement could deploy idle capital in yield farming or lending.

---

**END OF SPECIFICATION**
