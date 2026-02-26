# Paper Trading Guidance: FR Spike V2 Aggregation (single_strongest)

> **Created**: 2026-02-26 14:00
> **Author**: quant-lead agent (opus)
> **Status**: Research Complete
> **Target Strategy**: funding-rate-spike-v2 aggregation, V2 Top7 single_strongest
> **Backtest Baseline**: Sharpe 1.89, Return 230.7%, MaxDD 16.4%, 141 trades

---

## Table of Contents

1. [Strategy Recap](#1-strategy-recap)
2. [Fill Simulation and Execution Realism](#2-fill-simulation-and-execution-realism)
3. [Funding Rate Handling in Paper Trading](#3-funding-rate-handling-in-paper-trading)
4. [Position Sizing: Paper vs Live](#4-position-sizing-paper-vs-live)
5. [Real-Time Monitoring and Alerts](#5-real-time-monitoring-and-alerts)
6. [Known Pitfalls and Transition Risks](#6-known-pitfalls-and-transition-risks)
7. [Deployment Architecture on VDS](#7-deployment-architecture-on-vds)
8. [Database and State Persistence](#8-database-and-state-persistence)
9. [Graduation Criteria: Paper to Live](#9-graduation-criteria-paper-to-live)
10. [Implementation Roadmap](#10-implementation-roadmap)

---

## 1. Strategy Recap

### What We Are Paper Trading

**Aggregation Configuration**: V2 Top7 single_strongest
- **Strategy**: `funding-rate-spike-v2` (contrarian funding rate trading)
- **Assets**: LDO/USDT:USDT, DOGE/USDT:USDT, IMX/USDT:USDT, GRT/USDT:USDT, ICP/USDT:USDT, XLM/USDT:USDT, NEAR/USDT:USDT
- **Timeframe**: 4h candles on all 7 assets
- **Allocation**: `single_strongest` -- concentrate 100% of capital on the asset with the strongest signal at each decision point
- **Exchange**: Bybit perpetual futures
- **Mode**: Futures (funding rates applied)

### How single_strongest Works

At each 4h bar close:
1. All 7 sub-strategies evaluate their signals independently
2. The signal with the highest weight (most extreme FR percentile deviation) wins
3. If the winning signal direction differs from the current position, rotate: close current, open new
4. If no signals fire, hold current position or stay flat

This means:
- **Maximum one position at a time** across all 7 assets
- **Position rotation** is frequent (141 trades over 2 years = approximately 1 trade every 5 days)
- **Capital concentration risk** -- entire equity is in one asset at a time

---

## 2. Fill Simulation and Execution Realism

### The Core Problem

Paper trading fills at the close price of the signal bar. Live trading fills at whatever price the order book gives you. For perpetual futures on altcoins, the gap can be meaningful.

### Slippage Model Recommendations

**For BTC/ETH majors**: Minimal concern. Bybit BTC/USDT perp spreads are typically 0.01-0.03%, and a $2K-$10K order has negligible market impact.

**For our assets (LDO, IMX, GRT, DOGE, ICP, XLM, NEAR)**: Mixed liquidity profiles.

| Asset | Bybit Perp Liquidity | Expected Slippage ($5K order) | Concern Level |
|-------|---------------------|------------------------------|---------------|
| DOGE | High (meme coin, massive retail volume) | 0.02-0.05% | LOW |
| XLM | High (established L1) | 0.02-0.05% | LOW |
| NEAR | Medium-High | 0.03-0.08% | LOW-MEDIUM |
| ICP | Medium | 0.05-0.15% | MEDIUM |
| LDO | Medium (DeFi governance token) | 0.05-0.15% | MEDIUM |
| GRT | Medium-Low | 0.05-0.20% | MEDIUM |
| IMX | Medium-Low (gaming/NFT token) | 0.08-0.25% | MEDIUM-HIGH |

**Recommended paper trading slippage settings**:
- Apply **0.10% slippage per side** (entry and exit) as a baseline
- This is conservative for DOGE/XLM but realistic for GRT/IMX
- Total round-trip cost: 0.20% slippage + 0.11% fees (Bybit taker 0.055% x 2) = **0.31% per round trip**
- The backtest already applies 0.055% taker fees, so add slippage simulation on top

**Do NOT use exchange paper trading modes** (e.g., Bybit testnet). These fill instantly at the mark price and teach you nothing about execution. Build our own simulation using real market data.

### Partial Fill Simulation

For a small personal account ($2K-$10K), partial fills are extremely unlikely on any of these assets. Even IMX perp on Bybit handles millions in daily volume. We can safely ignore partial fills for now.

**Exception**: If scaling above $50K per position, revisit this for GRT and IMX.

### Recommended Fill Logic

```
Paper fill price = signal bar close price * (1 + slippage_direction * slippage_pct)
  where slippage_direction = +1 for buys, -1 for sells
  and slippage_pct = 0.001 (0.10%)
```

For more realism, vary slippage by asset:
```
slippage_map = {
  'DOGE': 0.0003,  // 0.03%
  'XLM':  0.0003,
  'NEAR': 0.0005,
  'ICP':  0.0008,
  'LDO':  0.0008,
  'GRT':  0.0010,
  'IMX':  0.0012,
}
```

### Order Type Considerations

- **Backtests assume market orders** at bar close. Live should also use market orders for simplicity.
- Using limit orders introduces fill uncertainty and the risk of missing signals entirely -- worse than slippage for a low-frequency strategy (1 trade per 5 days).
- **Recommendation**: Use market orders for both entry and exit. Accept the slippage. The strategy's edge (Sharpe 1.89) is large enough to absorb 0.3% round-trip costs.

---

## 3. Funding Rate Handling in Paper Trading

### Bybit Funding Rate Mechanics

**Standard settlement**: Every 8 hours at 00:00, 08:00, 16:00 UTC.

**Critical timing detail**: Bybit's system requires a few seconds to process funding settlements. Opening or closing a position **within 5 seconds before or after** the funding timestamp does not guarantee inclusion/exclusion from that funding payment.

**Dynamic settlement (since October 2025)**: When a contract's funding rate hits its preset limit (approximately +/-2%), Bybit automatically switches to **hourly funding** for that contract. This affects ALL of our assets (LDO, DOGE, IMX, GRT, ICP, XLM, NEAR -- BTC/ETH are excluded from dynamic settlement). The system may revert to 2h, 4h, or 8h intervals without notice.

### Implications for Paper Trading

**Bar alignment issue**: Our strategy runs on 4h bars. Funding settles every 8h (or dynamically every 1h-4h). This means:
- A 4h bar at 00:00-04:00 UTC covers the 00:00 funding settlement
- A 4h bar at 04:00-08:00 UTC covers the 08:00 settlement
- A 4h bar at 08:00-12:00 UTC covers no standard settlement
- A 4h bar at 12:00-16:00 UTC covers the 16:00 settlement
- A 4h bar at 16:00-20:00 UTC covers no standard settlement
- A 4h bar at 20:00-00:00 UTC covers the next day's 00:00 settlement

Not every 4h bar contains a funding event. The strategy's entry/exit decisions on non-funding bars still work (the FR value used is the most recent one), but funding payments only accrue on bars that contain settlement times.

**Recommendation for paper trading**:
1. **Use real-time Bybit funding rates** via their API, not simulated/cached ones
2. Poll `GET /v5/market/tickers` for real-time funding rate and next settlement time
3. Apply funding payment at the actual settlement timestamp, not at bar close
4. Track whether dynamic hourly settlement is active for each contract

**API endpoint for funding rate**:
```
GET /v5/market/tickers?category=linear&symbol=LDOUSDT
Response includes: fundingRate, nextFundingTime
```

**Funding rate history**:
```
GET /v5/market/funding/history?category=linear&symbol=LDOUSDT&limit=200
```

### Dynamic Settlement Detection

Since our altcoins are all eligible for dynamic hourly funding:
1. Poll `nextFundingTime` from the tickers endpoint
2. If `nextFundingTime - now < 3600000` (1 hour) and the contract was previously on 8h schedule, dynamic settlement has been activated
3. Log this event -- it often coincides with extreme FR (which is when our strategy trades)
4. During dynamic settlement, funding income/cost per settlement is scaled down (hourly rate vs 8h rate)

### What This Means for Strategy Edge

The strategy's funding income ($50-170 per asset over 2 years in backtests) is a real structural advantage. In paper trading:
- Accurately track funding payments received/paid
- Compare paper funding income to what Bybit would actually pay
- If dynamic hourly settlement activates during a position, the per-settlement payment is smaller but more frequent -- net effect is similar over time

---

## 4. Position Sizing: Paper vs Live

### Paper Trading Sizing

**Use the same capital as planned for live**. If planning to deploy $5K live, paper trade with $5K. Using $100K in paper trading creates false confidence about fill quality and drawdown tolerance.

**The single_strongest allocator puts 100% of capital into one position**. With default v2 params:
- `positionSizeMethod = "volAdjusted"`
- `positionSizePct = 50` (base 50% of equity)
- `minPositionPct = 15`, `maxPositionPct = 50`
- Actual position: 15-50% of equity depending on volatility

So with $5K equity, a single position ranges from $750 to $2,500. This is well within the liquidity of all 7 assets on Bybit.

### Leverage Consideration

The backtests run at 1x effective leverage (no multiplier). For live trading on Bybit perp futures:
- **Start at 1x isolated margin** (no leverage amplification)
- The strategy already uses short positions (natural leverage via futures)
- Adding leverage amplifies both returns and drawdowns -- the 16.4% MaxDD becomes 33% at 2x
- **Do not increase leverage during paper trading**. Test at 1x, then consider 1.5-2x only after live validation.

### Fee Structure Validation

Bybit taker fee: 0.055% for most users. Confirm your actual fee tier:
- VIP 0: 0.055% taker
- VIP 1 (30d volume > $10M): 0.0400% taker
- For a small personal account, assume 0.055%

The backtest uses `feeRate = 0.00055` which matches. No adjustment needed.

---

## 5. Real-Time Monitoring and Alerts

### Metrics to Track in Real Time

**Critical (check every 4h bar)**:
| Metric | Description | Update Frequency |
|--------|-------------|-----------------|
| Current Position | Which asset, direction (long/short), entry price, entry time | Every signal bar |
| Unrealized PnL | Mark-to-market profit/loss on open position | Every bar |
| Funding Income | Cumulative funding received/paid | At each settlement |
| Portfolio Equity | Cash + unrealized PnL | Every bar |
| Drawdown | Current drawdown from peak equity | Every bar |
| Signal State | Which assets have active signals, signal weights | Every bar |

**Daily dashboard**:
| Metric | Description |
|--------|-------------|
| Total Return (cumulative) | Since paper trading start |
| Sharpe (rolling 30d) | Annualized, calculated from daily returns |
| Win Rate | Closed trades only |
| Average Win / Average Loss | R-multiple |
| Trade Count | Cumulative and rate per week |
| Funding Income (cumulative) | Total earned/paid |
| Max Drawdown (running) | Worst peak-to-trough |

**Weekly review metrics**:
| Metric | Description |
|--------|-------------|
| Realized Sharpe vs Backtest Sharpe | Degradation tracking |
| Trade frequency vs expected | 141 trades / 2 years = ~1.35/week |
| Asset concentration | How often each of the 7 assets is selected |
| Slippage tracking | Difference between signal price and fill price |

### Alert Thresholds

**Immediate alerts (Telegram/email)**:

| Alert | Threshold | Action |
|-------|-----------|--------|
| Drawdown exceeds 10% | DD > 10% from peak | Review -- approaching backtest MaxDD (16.4%) |
| Drawdown exceeds 15% | DD > 15% from peak | PAUSE -- consider stopping paper trade, investigate |
| Drawdown exceeds 20% | DD > 20% from peak | STOP -- exceed backtest worst case, something is wrong |
| No trades in 14 days | 0 signals for 2 weeks | Investigate -- bot may have crashed or market regime shifted |
| Position stuck > 48h | Single trade open > 2 days | Review -- max hold is 3 x 8h = 24h, should not exceed |
| Funding rate income anomaly | Funding payment differs from expected by > 50% | Check if dynamic settlement activated |
| API error rate > 5% | More than 1 in 20 API calls fail | Investigate connectivity |
| Strategy crash/restart | Process restart detected | Verify state recovery from DB |

**Informational alerts (daily summary)**:

| Alert | Description |
|-------|-------------|
| Daily PnL summary | Return %, open position, funding earned |
| Signal rotation | When strategy switches from one asset to another |
| Position entry/exit | Every trade executed |

### Recommended Alerting Stack (Small Personal System)

1. **Telegram Bot**: Free, reliable, works on mobile. Use `node-telegram-bot-api`.
2. **Simple log file**: Append to `/workspace/data/paper-trading-fr-v2.log`
3. **State file**: JSON state saved every cycle to `/workspace/data/paper-trading-fr-v2-state.json`
4. **Database**: Save each paper trade to PostgreSQL (reuse existing `backtests` schema or new `paper_trades` table)

### How Long Should Paper Trading Run?

**Minimum**: 4-8 weeks, covering at least 2 different market regimes.

**Target**: 30+ closed trades for statistical significance.

At ~1.35 trades/week (backtest rate), reaching 30 trades requires approximately **22 weeks (5.5 months)**. This is a long time but reflects the strategy's low-frequency nature.

**Pragmatic approach**: Run paper trading for **8-12 weeks minimum** (covering 10-16 trades). If performance tracks within 1 standard deviation of backtest expectations:
- Return per trade: within +/- 50% of backtest average
- Win rate: within +/- 15 percentage points of backtest
- Max drawdown: not exceeding backtest MaxDD by more than 25% (i.e., stay under 20.5%)
- Funding income: positive and roughly proportional to backtest

Then consider graduating to live with minimal capital.

---

## 6. Known Pitfalls and Transition Risks

### 6.1 Lookahead Bias in Backtests

**Risk**: The backtest evaluates signals at bar close and executes at the same close price. In reality, you need time to:
1. Wait for the 4h candle to close
2. Fetch the latest funding rate
3. Run signal evaluation
4. Submit the order

**Mitigation**: Add a **1-bar execution delay** in paper trading. When a signal fires at bar N close, execute at bar N+1 open (or the first available price after the bar closes). This is the most common source of backtest-to-live degradation.

**Impact estimate**: A 1-bar delay on 4h candles means up to 4h of price drift. For a low-frequency contrarian strategy, the impact should be modest (the FR extreme does not resolve in 4h). Expected degradation: 5-15% of Sharpe.

### 6.2 Bar Close vs Continuous Time

**Risk**: Backtests evaluate at discrete 4h bar closes. Markets move continuously. A stop-loss that triggers mid-bar in the backtest might trigger at a much worse price in reality (gap through stop).

**Mitigation**:
- Monitor positions between bars (every 15-30 minutes) for stop-loss management
- Use Bybit's native stop-loss orders (conditional orders) placed immediately after entry
- The ATR-based stops in v2 are wide enough (2.5x ATR) to avoid most gap-through scenarios on 4h timeframes

### 6.3 Funding Rate Data Freshness

**Risk**: In backtests, the strategy accesses historical FR data from the database. In live/paper trading, FR must be fetched in real time. If the FR data is stale (API failure, caching issue), the strategy may miss signals.

**Mitigation**:
- Fetch FR from Bybit API at every evaluation cycle
- Cache the last known FR with timestamp
- If FR data is older than 8.5 hours, raise an alert (stale data)
- Never enter a trade based on stale FR

### 6.4 Market Impact on Small-Cap Assets

**Risk**: LDO, IMX, and GRT are the least liquid of our 7 assets. During extreme funding rate events (when our strategy trades), liquidity often thins further as market makers pull quotes.

**Mitigation**:
- The `single_strongest` allocator concentrates in one asset at a time, which is good for avoiding correlation risk but bad for market impact
- With a $2K-$10K account, position sizes ($750-$2,500) are small enough that market impact is negligible
- Monitor the spread at execution time. If spread > 0.3% at time of execution, log it and consider skipping

### 6.5 Dynamic Funding Rate Settlement

**Risk**: Since October 2025, Bybit switches altcoin funding to hourly during extreme FR periods. This is precisely when our strategy enters. Implications:
- The FR payment per settlement is smaller (scaled to 1h vs 8h)
- The FR can normalize faster (hourly adjustments)
- Our `holdingPeriods = 3` parameter means hold for 3 x 8h = 24h, but hourly settlement might normalize FR within 2-4 hours
- Backtest data from 2024-2025 used 8h settlement only -- this is a structural change

**Mitigation**:
- Track whether dynamic settlement is active for the current position's asset
- If FR normalizes within 1-2h due to hourly settlement, the FR normalization exit fires earlier
- This might reduce per-trade profitability but also reduce holding risk
- Monitor and compare: do paper trades exit faster than backtest trades? Is PnL per trade lower?

### 6.6 The single_strongest Concentration Risk

**Risk**: Backtests show that single_strongest beats diversified allocation (Sharpe 1.89 vs 1.64). But backtests do not model:
- Simultaneous liquidation cascades affecting the single concentrated position
- Black swan events on one asset (delistings, hacks, regulatory action)
- Correlated drawdowns when the "strongest signal" keeps picking the same failing asset

**Mitigation**:
- Implement a **max consecutive loss** circuit breaker: if 3 consecutive trades lose, pause for 48h and alert
- Implement a **per-asset loss limit**: if any single asset accumulates -10% of starting capital in losses, exclude it for 2 weeks
- Consider graduating to `top_n (maxPos=3)` for live trading -- the Sharpe drop from 1.89 to 1.64 is worth the risk reduction

### 6.7 Strategy State Across Restarts

**Risk**: If the paper trading process crashes while holding a position, the position state must survive. Unlike the backtest (which runs in memory), paper trading must persist state.

**Mitigation**: See Section 8 (Database and State Persistence).

---

## 7. Deployment Architecture on VDS

### Minimum VDS Specifications

For a small personal trading bot:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Storage | 10 GB SSD | 20 GB SSD |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 LTS |
| Node.js | v18+ | v20 LTS |
| Network | 100 Mbps | 1 Gbps |

**Location**: Choose a VDS close to Bybit's API servers. Bybit uses AWS infrastructure primarily in Singapore and Hong Kong. Low latency is not critical for a 4h strategy, but sub-500ms API response time is desirable for reliable data fetching.

### Process Management

**Use PM2** for process supervision:

```bash
# Install PM2 globally
npm install -g pm2

# Start paper trader with PM2
pm2 start scripts/fr-v2-paper-trade.ts \
  --name "fr-v2-paper" \
  --interpreter "npx" \
  --interpreter-args "tsx" \
  --max-restarts 10 \
  --restart-delay 30000

# Enable startup script (auto-start on reboot)
pm2 startup
pm2 save

# Monitor
pm2 logs fr-v2-paper
pm2 monit
```

Key PM2 features:
- **Auto-restart on crash**: Up to 10 restarts with 30s delay between
- **Log rotation**: `pm2 install pm2-logrotate`
- **Startup persistence**: Survives VDS reboots
- **Memory limit**: Set `--max-memory-restart 500M` to prevent memory leaks from killing the server

### API Connection Handling

**CCXT WebSocket** (for real-time data):
- CCXT Pro supports WebSocket streams for Bybit
- Use for real-time ticker/funding rate data between bar evaluations
- Implement reconnection with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s

**REST API** (for order execution and history):
- Use for placing orders and fetching funding rate history
- Implement retry logic: 3 retries with 1s backoff
- Handle HTTP 429 (rate limit): back off for the duration specified in the response header

**Connection failure handling**:
```
1. If API unreachable for < 5 minutes: retry with backoff
2. If API unreachable for 5-30 minutes: alert via Telegram, continue retrying
3. If API unreachable for > 30 minutes: alert CRITICAL, enter safe mode
   Safe mode: no new entries, maintain existing positions with native Bybit stop orders
4. If API unreachable for > 2 hours: alert EMERGENCY, consider manual intervention
```

### Uptime Expectations

| VDS Quality | Expected Annual Uptime | Max Downtime/Year |
|-------------|----------------------|-------------------|
| Budget ($5-10/mo) | 99.5% | 44 hours |
| Standard ($15-30/mo) | 99.9% | 8.7 hours |
| Premium ($50+/mo) | 99.99% | 52 minutes |

For a 4h strategy, occasional downtime is not critical. Missing one 4h bar evaluation is survivable -- the strategy will simply check again on the next bar. The key risk is missing an exit signal while in a position, which is why native Bybit stop orders should always be placed as backup.

### Security

- **Never store API keys in code or environment variables visible to other processes**
- Use `.env` file with `0600` permissions, or a secrets manager
- Create a Bybit sub-account with **trade-only** permissions (no withdrawal)
- Enable IP whitelist on the API key (restrict to VDS IP)
- Set a reasonable maximum order size limit on the sub-account

---

## 8. Database and State Persistence

### State That Must Survive Restarts

| State | Description | Persistence Method |
|-------|-------------|-------------------|
| Current position | Asset, direction, entry price, entry time, amount | PostgreSQL `paper_positions` table |
| Trail stop state | `_trailActive`, `_trailStop` | PostgreSQL or JSON state file |
| Trade history | All closed paper trades with PnL | PostgreSQL `paper_trades` table |
| Equity curve | Equity snapshot at each bar | PostgreSQL `paper_equity` table |
| Funding income | Cumulative funding received/paid | PostgreSQL (in paper_trades or separate) |
| Strategy internal state | Kelly sample history, entry ATR | JSON state file |
| Last evaluated bar | Timestamp of last bar processed | JSON state file |

### Recommended Schema

```sql
-- Paper trading positions (max 1 active at a time for single_strongest)
CREATE TABLE paper_positions (
  id SERIAL PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  config_id TEXT NOT NULL,  -- aggregation config identifier
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'long' or 'short'
  entry_price DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  entry_time BIGINT NOT NULL,  -- unix ms
  entry_atr DOUBLE PRECISION,
  trail_active BOOLEAN DEFAULT FALSE,
  trail_stop DOUBLE PRECISION DEFAULT 0,
  bybit_stop_order_id TEXT,  -- native stop order on exchange
  status TEXT DEFAULT 'open',  -- 'open' or 'closed'
  close_price DOUBLE PRECISION,
  close_time BIGINT,
  pnl DOUBLE PRECISION,
  funding_income DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Paper trading closed trades log
CREATE TABLE paper_trades (
  id SERIAL PRIMARY KEY,
  position_id INT REFERENCES paper_positions(id),
  strategy_name TEXT NOT NULL,
  config_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  entry_time BIGINT NOT NULL,
  exit_time BIGINT NOT NULL,
  pnl DOUBLE PRECISION NOT NULL,
  pnl_pct DOUBLE PRECISION NOT NULL,
  funding_income DOUBLE PRECISION DEFAULT 0,
  slippage_cost DOUBLE PRECISION DEFAULT 0,
  fee_cost DOUBLE PRECISION DEFAULT 0,
  exit_reason TEXT,  -- 'stop_loss', 'take_profit', 'trail', 'fr_normal', 'time', 'rotation'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Paper equity snapshots
CREATE TABLE paper_equity (
  id SERIAL PRIMARY KEY,
  config_id TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  cash DOUBLE PRECISION NOT NULL,
  unrealized_pnl DOUBLE PRECISION NOT NULL,
  drawdown_pct DOUBLE PRECISION NOT NULL,
  peak_equity DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Backup Strategy

**For PostgreSQL on VDS**:

```bash
# Daily automated backup via cron
0 2 * * * pg_dump backtesting | gzip > /backups/backtesting-$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
find /backups/ -name "backtesting-*.sql.gz" -mtime +30 -delete

# Weekly offsite backup (to local machine or cloud)
# Use rsync or rclone to copy latest backup
```

**State file backup**:
- The JSON state file is small (< 1KB)
- Save to both disk and database on every cycle
- On restart, load from database (more reliable than filesystem)

### Recovery Procedure

On process restart:
1. Load last known state from `paper_positions` table
2. If an open position exists:
   a. Fetch current market price from Bybit API
   b. Verify the position is still valid (not manually closed)
   c. Calculate current unrealized PnL
   d. Resume monitoring from next bar
3. If no open position exists:
   a. Resume signal evaluation from next bar
4. Log the restart event and alert via Telegram

---

## 9. Graduation Criteria: Paper to Live

### Mandatory Requirements (ALL must be met)

#### 9.1 Minimum Duration and Trade Count

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Minimum duration | 8 weeks | Cover at least 2 market regimes |
| Minimum trades | 15 closed trades | Statistical minimum for basic inference |
| Market diversity | At least 3 different assets traded | Verify rotation works |
| Both directions | At least 3 longs AND 3 shorts | Verify both sides function |

#### 9.2 Performance Thresholds

| Metric | Threshold | Backtest Baseline | Notes |
|--------|-----------|-------------------|-------|
| Cumulative Return | > 0% (profitable) | +230.7% / 2yr | Any positive return is acceptable for 8-12 weeks |
| Sharpe Ratio (annualized) | > 0.5 | 1.89 | Significant degradation expected; 0.5 is minimum viable |
| Max Drawdown | < 22% | 16.4% | Allow 33% more than backtest worst case |
| Win Rate | > 35% | ~55% (estimated from 141 trades) | Lower bound for profitability with typical R-multiples |
| Average Win / Average Loss | > 1.0 | Estimated ~1.5 from backtest | Ensure positive expectancy |

#### 9.3 Operational Thresholds

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Uptime | > 95% of 4h bars evaluated | Missed < 1 bar per day on average |
| API errors | < 5% error rate | System is reliable |
| State recovery | Successfully recovered from at least 1 restart | Prove persistence works |
| Alert delivery | All alerts received within 5 minutes | Monitoring is functional |
| Slippage tracking | Simulated slippage within 2x of estimated | Fill model is realistic |

#### 9.4 Qualitative Checks

- [ ] Have you reviewed at least 10 individual trades and confirmed the entry/exit logic matches your understanding?
- [ ] Have you experienced at least one drawdown > 5% and did not intervene/override the strategy?
- [ ] Have you compared paper funding income to what Bybit would actually pay and confirmed they are within 20%?
- [ ] Have you documented any anomalies or unexpected behaviors?
- [ ] Are you comfortable with the emotional experience of watching a concentrated position in one altcoin?

### Graduation Process

**Step 1: Paper trading passes all criteria above.**

**Step 2: Deploy live with 25% of intended capital.**
- If intending to trade $5K, start live with $1,250
- Run live alongside paper trading (compare results)
- Duration: 4 weeks minimum

**Step 3: Scale to 50% capital if Step 2 is successful.**
- Duration: 4 weeks

**Step 4: Scale to 100% capital.**
- Continue monitoring at weekly cadence

**Total timeline: Paper (8-12 weeks) + Ramp (8-12 weeks) = 4-6 months to full deployment.**

This is long but appropriate for a strategy that trades ~1.35 times per week. Rushing this timeline is the most common mistake in algorithmic trading.

### Failure Conditions (Abort Paper Trading)

| Condition | Action |
|-----------|--------|
| Max drawdown exceeds 25% | Stop paper trading, review strategy |
| 5 consecutive losing trades | Pause for 1 week, review each trade |
| Zero trades in 4 weeks | Investigate -- strategy may not function in current regime |
| Sharpe < 0 after 30+ trades | Strategy has no edge in current market |
| Funding rate dynamics have structurally changed | Re-evaluate strategy hypothesis |

---

## 10. Implementation Roadmap

### Phase 1: Build Paper Trading Infrastructure (Week 1-2)

**Tasks for be-dev agent**:

1. **Create paper trading runner** (`scripts/fr-v2-paper-trade.ts`)
   - Reuse signal aggregation logic from `aggregate-engine.ts`
   - Add real-time Bybit data fetching (CCXT REST API)
   - Add slippage simulation layer
   - Add position management with database persistence
   - Add Telegram alerting integration
   - Add graceful shutdown with state save

2. **Create database migration** for paper trading tables (see Section 8 schema)

3. **Create monitoring dashboard endpoint** (optional, can use CLI `--status` mode)

### Phase 2: Validate Infrastructure (Week 2-3)

1. Run paper trader for 3-5 days on VDS
2. Verify:
   - Signals match what the backtest would generate for the same period
   - Funding rate data is fresh and accurate
   - State survives PM2 restarts
   - Alerts arrive on Telegram
   - Equity curve is being recorded

### Phase 3: Full Paper Trading Run (Week 3-14)

1. Monitor daily (5-minute review)
2. Weekly detailed review of all trades
3. Monthly comparison to rolling backtest
4. Track all metrics from Section 5

### Phase 4: Live Deployment Decision (Week 14+)

1. Apply graduation criteria from Section 9
2. If passed: deploy with 25% capital
3. If failed: analyze failure mode, consider parameter adjustments or strategy revision

### Existing Code to Reuse

| Component | Location | Reuse Level |
|-----------|----------|-------------|
| Strategy loading | `src/strategy/loader.ts` | Direct reuse |
| Signal adapter | `src/core/signal-adapter.ts` | Direct reuse |
| Aggregate engine logic | `src/core/aggregate-engine.ts` | Adapt (replace backtest loop with real-time loop) |
| Bybit data provider | `src/data/providers/bybit.ts` | Adapt (add real-time fetching methods) |
| Funding rate types | `src/core/types.ts` | Direct reuse |
| Metrics calculation | `src/analysis/metrics.ts` | Direct reuse (for rolling performance) |
| PM paper trader pattern | `scripts/pm-paper-trade.ts` (deleted, but pattern documented in changelog) | Pattern reference |

### Key Architecture Decision

The paper trader should NOT run the full aggregate engine in a loop. Instead:

```
Every 4h (on bar close):
  1. Fetch latest 4h candle for all 7 assets (CCXT REST)
  2. Fetch latest funding rate for all 7 assets (CCXT REST)
  3. Append candle + FR to rolling buffers
  4. Run each sub-strategy's signal evaluation
  5. Pick strongest signal (single_strongest logic)
  6. If signal differs from current position: execute rotation
  7. Apply slippage simulation
  8. Update position state in DB
  9. Record equity snapshot
  10. Send Telegram update

Every funding settlement (8h or dynamic):
  1. Fetch actual funding payment from Bybit API
  2. Apply to current position
  3. Record funding income

Every 15 minutes (between bars):
  1. Check stop-loss / take-profit against current price
  2. If triggered: close position, record trade
```

This avoids the complexity of running the full backtesting engine in real-time while maintaining fidelity to the strategy logic.

---

## References

### Paper Trading and Transition

1. **"Paper Trading vs. Live Trading: A Data-Backed Guide"** -- Alpaca Markets
   - URL: https://alpaca.markets/learn/paper-trading-vs-live-trading-a-data-backed-guide-on-when-to-start-trading-real-money
   - Key Finding: 57% of traders transition within 30 days, 75% within 60 days. 4 readiness indicators: platform fluency, consistent performance, defined risk framework, emotional preparedness.

2. **"How Many Trades Are Enough? Statistical Significance in Backtesting"** -- Trading Dude (Medium)
   - URL: https://medium.com/@trading.dude/how-many-trades-are-enough-a-guide-to-statistical-significance-in-backtesting-093c2eac6f05
   - Key Finding: Minimum 30 trades for basic inference, 100+ for reliable metrics. Quality across regimes matters more than quantity.

3. **"How to Backtest a Crypto Bot: Realistic Fees, Slippage, and Paper Trading"** -- Paybis Blog
   - URL: https://paybis.com/blog/how-to-backtest-crypto-bot/
   - Key Finding: Paper trading tests what backtests cannot -- API connectivity, execution speed, fee accuracy, and system stability over 30+ days.

### Bybit Funding Rate Mechanics

4. **"Introduction to Funding Rate"** -- Bybit Help Center
   - URL: https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate
   - Key Finding: Settlement at 00:00, 08:00, 16:00 UTC. 5-second exclusion zone around settlement timestamp.

5. **"Bybit Launches Dynamic Settlement Frequency System for Perpetual Contracts"** -- PR Newswire (October 2025)
   - URL: https://www.prnewswire.com/news-releases/bybit-launches-dynamic-settlement-frequency-system-for-perpetual-contracts-302598179.html
   - Key Finding: Altcoin perpetuals switch to hourly funding when FR hits upper/lower limits. BTC/ETH excluded. Live since October 30, 2025.

6. **"Funding Fee Calculation"** -- Bybit Help Center
   - URL: https://www.bybit.com/en/help-center/article/Funding-fee-calculation
   - Key Finding: Funding fee = position value x funding rate. Only applied if position is open at settlement time.

### VDS and Infrastructure

7. **"Using VPS Servers for Crypto Trading Bots in 2025"** -- bacloud
   - URL: https://www.bacloud.com/en/blog/173/using-vps-servers-for-crypto-trading-bots-in-2025.html
   - Key Finding: 99.9%+ uptime standard, redundant power/network. Choose location near exchange servers.

8. **"Algo Trading Infrastructure Guide: WebSocket, REST, VPS"** -- Trading FXVPS
   - URL: https://tradingfxvps.com/api-trading-vps-optimization-2025-websocket-rest-for-algo-strategies/
   - Key Finding: WebSocket for data, REST for execution. Request batching reduces API usage by 90%. Local caching reduces usage by 80-90%.

### Algorithmic Trading Operations

9. **"Algorithmic Trading: Build, Test & Automate in 2025"** -- Obside
   - URL: https://obside.com/trading-algorithmic-trading/algorithmic-trading-build-test-and-automate-in-2025/
   - Key Finding: Redundant servers, real-time alerts, circuit breakers, periodic strategy reviews. Start small and scale gradually.

10. **"Crypto Paper Trading"** -- Gainium
    - URL: https://gainium.io/crypto-paper-trading
    - Key Finding: Advanced simulation tools can include slippage and order fill delays for more realistic conditions.

---

## Change Log

**Version 1.0** -- 2026-02-26
- Initial paper trading guidance document
- Comprehensive coverage of fill simulation, funding rate handling, monitoring, pitfalls, deployment, persistence, and graduation criteria
- Specific recommendations for the FR Spike V2 single_strongest aggregation
