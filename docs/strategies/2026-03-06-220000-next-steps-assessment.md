# Next Steps Assessment: Post-Tier 1 Research

> **Created**: 2026-03-06 22:00
> **Author**: quant-lead agent (opus)
> **Status**: Decision Document
> **Context**: Tier 1 FR optimizations produced marginal results. What now?

---

## The Brutal Truth

You have ONE strategy that works: FR V2 on 4h. It has Sharpe ~1.88 in aggregated paper trading. After a full day of Tier 1 optimization research, the results are:

- Vol-adjusted sizing: +0.012 Sharpe (noise-level improvement)
- Kelly sizing: trades returns for DD reduction (useful for live, not for edge)
- FR Gradient Momentum: FAILED (does not generalize)
- FR Regime Momentum: preliminary results bad (SOL Sharpe -1.21)

**The Tier 1 optimizations did not move the needle.** This is actually informative: it tells us FR V2 is already near its ceiling with current data inputs. Squeezing more out of the same signal (funding rate alone, single-asset, single-timeframe) has diminishing returns.

---

## Question 1: What Should We Focus On Next?

**Answer: Go live with what we have. In parallel, run Experiment 1 (V1 Top Performers Tournament) because it is zero-effort and could expand the production portfolio.**

Here is the reasoning:

### The Diminishing Returns Problem

FR V2 works because it exploits a structural mechanic (funding rate mean reversion). The signal is simple: extreme FR percentile + trend alignment + ATR filter. All three Tier 1 attempts to improve this added complexity without adding signal:

- Vol-adjusted sizing: The signal is the same; only risk management changes marginally
- Gradient: Adding noise (rate-of-change of sparse 8h data) to a clean threshold signal
- Regime momentum: Adding 5m entry timing to a 4h signal (our 1m research already proved short-timeframe execution adds noise, not precision)

**The lesson: you cannot improve a simple, working signal by making it more complex.** The edge IS the simplicity.

### What Actually Moves The Needle

There are only three things that meaningfully improve a working strategy:

1. **More capital deployed** (go live with real money)
2. **More assets** (expand the portfolio to capture more FR spike events)
3. **Genuinely new data** (OI, on-chain -- a different information source, not a different way to look at the same data)

Option 1 is Phase 4. Option 2 is Experiments 1 and 2. Option 3 is Experiment 4 (OI integration).

---

## Question 2: Tier 2 (Cross-Sectional, OI) -- Yes or No?

**FR Cross-Sectional Momentum (Experiment 3): NOT YET.**

Reason: The cross-sectional approach requires portfolio engine changes (multi-asset simultaneous access in the weight calculator). The expected improvement is uncertain. And the current `single_strongest` allocation in the aggregation engine already approximates cross-sectional selection -- it picks the asset with the strongest signal at any given time. A true cross-sectional rank would be marginally different, not fundamentally different. This is a "nice to have" not a "must have."

**OI Integration (Experiment 4): YES, but AFTER going live.**

OI is the most promising new data source because it represents genuinely new information (leverage buildup vs. the funding rate which reflects leverage cost). Gate.io research and the Oct 2025 cascade analysis both show FR + OI combined outperforms FR alone. But this is a 6-8 hour engineering project and it should not block the live trading timeline.

**Recommended Tier 2 priority:**
1. Experiment 1 (V1 Top Performers Tournament) -- 2 hours, zero infrastructure work
2. Experiment 2 (Expand to 50+ symbols) -- 4-6 hours, just data caching + scanning
3. Go live preparations (Phase 4)
4. Experiment 4 (OI integration) -- as enhancement after live deployment

---

## Question 3: Should We Go Live (Phase 4)?

**YES. This is the single most impactful action.**

Here is why:

### Paper Trading Is Not Real Validation

Paper trading tells you the system works mechanically (signals fire, orders simulate, equity tracks). You already know that. What paper trading does NOT tell you:

- Slippage reality on 4h bars (should be minimal but needs real data)
- Execution reliability (API failures, rate limits, connectivity)
- Psychological factors (will you actually hold through a 5% drawdown?)
- Fee structure accuracy (maker vs taker, rebates, tier levels)

**Every day in paper trading is a day not collecting real edge.** The strategy has:
- 2 years of backtest data
- Walk-forward validation on 4+ symbols (ZEC, TRB, IOST, STG)
- 6 production symbols in paper trading (LDO, DOGE, IMX, ICP, XLM, NEAR)
- Sharpe 1.88 aggregated
- MaxDD ~13-16%

This is more validation than most retail traders ever do. The remaining risk is execution, not strategy.

### Minimum Viable Live Deployment

Phase 4 does not need to be "build a full live trading system." It needs:

1. **Exchange connector** (Bybit CCXT already in the system -- the library supports order placement)
2. **Signal generator** (run FR V2 on a cron, emit entry/exit signals)
3. **Order executor** (convert signals to limit orders with slippage protection)
4. **Position tracker** (reconcile fills with expected positions)
5. **Kill switch** (max daily loss, max position size, max drawdown)

Start with TINY capital. $500-$1000. The goal is not to make money yet -- it is to validate execution and build the live infrastructure.

### The Real Risk of NOT Going Live

Every month you spend optimizing a backtest is a month where:
- The FR spike edge could be crowded out by more participants
- Market microstructure could change (Bybit fee changes, funding formula changes)
- You learn nothing about real execution quality
- Opportunity cost of capital sitting idle

---

## Question 4: Most Impactful Single Action Right Now

**Start Phase 4: Build minimum viable live trading infrastructure.**

Specifically:

1. **Today/Tomorrow**: Run Experiment 1 (V1 Top Performers Tournament). This is 2 hours of work using existing infrastructure and could identify 2-3 additional portfolio assets.

2. **This Week**: Design the live trading architecture. What does the simplest possible live system look like? A cron job that:
   - Fetches latest 4h candle + funding rate data
   - Runs FR V2 signal generation for all production symbols
   - Checks for entry/exit signals
   - Places orders via CCXT
   - Logs everything
   - Has a kill switch

3. **Next Week**: Implement and deploy with $500 on Bybit.

4. **In Parallel**: Run Experiment 2 (expand symbol universe). This runs in the background while live infrastructure is built.

---

## Question 5: The Optimal Parameters Problem

### The Problem Statement

Right now, each symbol has different optimal parameters discovered through walk-forward validation:
- ZEC: holdPeriods=2, shortPct=98, longPct=4, atrStop=2.5, atrTP=4.5
- TRB: holdPeriods=2, shortPct=98, longPct=6, atrStop=2.5, atrTP=5
- IOST: holdPeriods=4, shortPct=94, longPct=4, atrStop=3.5, atrTP=2.5
- STG: holdPeriods=4, shortPct=94, longPct=10, atrStop=1.5, atrTP=2.5
- LDO/DOGE/IMX/ICP/XLM/NEAR: using V2 defaults (not yet WF-optimized)

Where should these live?

### Recommended Architecture

**Single source of truth: a JSON config file, version-controlled, with per-symbol overrides.**

```
/workspace/config/live-trading.json
```

Structure:
```json
{
  "strategy": "funding-rate-spike-v2",
  "defaultParams": {
    "holdPeriods": 3,
    "shortPct": 95,
    "longPct": 5,
    "atrStop": 2.5,
    "atrTP": 4.0,
    "percentileLookback": 90,
    "atrPeriod": 14,
    "positionSizePct": 50,
    "useTrendFilter": true,
    "atrVolFilter": 1.5,
    "positionSizeMethod": "volAdjusted"
  },
  "symbolOverrides": {
    "ZEC/USDT:USDT": {
      "holdPeriods": 2,
      "shortPct": 98,
      "longPct": 4,
      "atrTP": 4.5,
      "walkForwardValidated": true,
      "testSharpe": 2.771,
      "lastOptimized": "2026-03-05"
    },
    "TRB/USDT:USDT": {
      "holdPeriods": 2,
      "shortPct": 98,
      "longPct": 6,
      "atrTP": 5.0,
      "walkForwardValidated": true,
      "testSharpe": 1.514,
      "lastOptimized": "2026-03-05"
    },
    "IOST/USDT:USDT": {
      "holdPeriods": 4,
      "shortPct": 94,
      "longPct": 4,
      "atrStop": 3.5,
      "atrTP": 2.5,
      "walkForwardValidated": true,
      "testSharpe": 1.199,
      "lastOptimized": "2026-03-05"
    },
    "STG/USDT:USDT": {
      "holdPeriods": 4,
      "shortPct": 94,
      "longPct": 10,
      "atrStop": 1.5,
      "atrTP": 2.5,
      "walkForwardValidated": true,
      "testSharpe": 1.118,
      "lastOptimized": "2026-03-05"
    }
  },
  "portfolio": {
    "symbols": ["LDO/USDT:USDT", "DOGE/USDT:USDT", "IMX/USDT:USDT", "ICP/USDT:USDT", "XLM/USDT:USDT", "NEAR/USDT:USDT"],
    "allocation": "single_strongest",
    "maxPositions": 1,
    "initialCapital": 1000
  },
  "riskManagement": {
    "maxDailyLossPercent": 5,
    "maxDrawdownPercent": 15,
    "killSwitchEnabled": true
  },
  "meta": {
    "lastUpdated": "2026-03-06",
    "version": "1.0",
    "notes": "Initial live config. LDO/DOGE/IMX/ICP/XLM/NEAR using defaults, not yet WF-optimized."
  }
}
```

### Why This Approach

1. **Version controlled**: Every param change is tracked in git with commit messages explaining why
2. **Single file**: No ambiguity about "which params are we running?"
3. **Defaults + overrides**: New symbols use defaults; WF-validated symbols get per-symbol tuning
4. **Metadata**: Track when each symbol was last optimized and its test Sharpe
5. **Live trading reads this file**: The cron job loads this config, merges defaults with overrides, runs signals

### What About the DB?

The database stores backtest RESULTS (historical runs, grid search results, walk-forward results). The config file stores the CURRENT LIVE PARAMETERS. These are different concerns:
- DB = "what did we test and what happened?" (historical, append-only)
- Config file = "what are we running right now?" (current state, mutable)

The dashboard can display the config file contents for visibility, but the source of truth for live params is the file, not the DB.

### Migration Path

1. Create `/workspace/config/live-trading.json` with current production paper trading params
2. Add the 4 WF-validated symbols (ZEC, TRB, IOST, STG) with their optimized params
3. Run WF validation on the 6 production symbols (LDO, DOGE, IMX, ICP, XLM, NEAR) -- this is already queued
4. Update config with WF-optimized params for production symbols
5. When going live, the live trading service reads this config on startup

---

## Summary: Recommended Action Plan

| Priority | Action | Effort | Impact | When |
|----------|--------|--------|--------|------|
| 1 | **Run Experiment 1** (V1 Top Performers Tournament) | 2 hours | Expand portfolio (+2-3 assets) | Today |
| 2 | **Create live-trading.json config** | 1 hour | Single source of truth for params | Today |
| 3 | **Complete WF validation** on production symbols | Running now | Optimize production params | Today |
| 4 | **Design Phase 4 architecture** (live trading) | 4 hours | Unblock real money deployment | This week |
| 5 | **Run Experiment 2** (expand to 50+ symbols) | 4-6 hours | Find more tradeable assets | This week |
| 6 | **Build minimum viable live trader** | 2-3 days | Deploy $500-1000 real capital | Next week |
| 7 | **OI integration** (Experiment 4) | 6-8 hours | New data source for signal quality | After live |

### What NOT To Do

- Do NOT keep optimizing FR V2 parameters (diminishing returns proven)
- Do NOT pursue FR Gradient Momentum further (does not generalize)
- Do NOT build cross-sectional portfolio engine yet (current single_strongest approximates it)
- Do NOT spend more time on Tier 1 research (the answer is clear: go live)

---

## The Honest One-Liner

**Stop backtesting. Start trading. The edge is proven. The risk is in NOT deploying, not in deploying.**

---
