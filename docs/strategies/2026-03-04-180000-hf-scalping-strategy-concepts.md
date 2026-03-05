# High-Frequency Scalping Strategy Concepts for Crypto Futures

> **Created**: 2026-03-04 18:00
> **Author**: quant-lead agent (opus)
> **Status**: Research Complete - Ready for Implementation Review

---

## Executive Summary

This document presents 7 high-frequency scalping strategy concepts for crypto perpetual futures, ranked by confidence in viability. Each strategy exploits a specific, documented market inefficiency in crypto markets. All strategies are designed for 1-minute candle data with leverage (10-50x) and account for realistic transaction costs (maker 0.02%, taker 0.055% per side, 0.05% slippage).

**Critical constraint**: At 50x leverage with taker fees, each round-trip costs approximately 5.5% of margin ((0.055% + 0.05%) * 2 sides * 50x leverage). This means we need price moves of at least 0.11% (5.5 bps per side) just to break even. This eliminates most "noise scalping" approaches and pushes us toward strategies that capture larger, structurally-driven moves on short timeframes.

**Key insight from our FR V2 success**: The best strategies exploit structural market inefficiencies (like funding rate mean reversion) rather than technical pattern recognition. For HF scalping, we need to find analogous structural edges that manifest on shorter timeframes.

---

## Strategy 1: Funding Rate Settlement Window Scalper

**Confidence: HIGH (8/10)**

### One-Line Description
Exploit the predictable price drift that occurs in the 30-60 minutes before and after the 8-hourly funding rate settlement timestamps (00:00, 08:00, 16:00 UTC).

### The Edge

**Market inefficiency**: When funding rates are extreme (highly positive or negative), traders with leveraged positions face a binary choice before each 8-hour settlement: pay the funding fee or close their position. This creates predictable pre-settlement price pressure and post-settlement snapback.

**Why it works**:
1. When funding is extremely positive (longs pay shorts), overleveraged longs rush to close before settlement, creating selling pressure in the 30-60 min window before settlement
2. After settlement, the selling pressure evaporates and price snaps back
3. When funding is extremely negative, the reverse happens with shorts
4. This is NOT the same as our FR V2 strategy - FR V2 trades contrarian on extreme funding over days; this strategy scalps the micro-price-action around each 8-hour settlement

**Empirical backing**:
- CEPR/BIS research documents that higher funding rates "significantly predict liquidations of short futures positions" with a 10% carry increase predicting 22% higher sell liquidations (Schmeling et al. 2023)
- Bybit calculates funding rates using time-weighted-average-price over minute rates, with "the closer to the funding fee settlement time, the greater the coefficient of the premium index" - this means price impact concentrates near settlement
- The crypto carry trade has historically delivered Sharpe ratios of 6.45-12.8 (various studies), suggesting the funding mechanism creates persistent market distortions

**Why it persists**: Structural feature of perpetual futures mechanics. Exchanges cannot eliminate this without changing the entire funding rate system. Retail traders lack the sophistication to time settlement windows optimally.

### Signal Logic

**Entry (Long setup - when funding is highly positive)**:
1. Check if current time is within 45 minutes before a funding settlement (00:00, 08:00, 16:00 UTC)
2. Confirm funding rate is above the 85th percentile of recent 90-observation history
3. Wait for price to drop below the 20-period VWAP on 1m chart (pre-settlement selling pressure)
4. Enter long when RSI(14) on 1m drops below 25 (panic selling from longs closing to avoid funding)
5. This is effectively buying the forced selling from overleveraged longs

**Exit**:
- Take profit: When price returns to VWAP (mean reversion target), typically 0.15-0.30% move
- Stop loss: 0.20% below entry (tight, since this is a high-probability reversion)
- Time exit: Close 15 minutes after settlement if neither TP nor SL hit

**Entry (Short setup - when funding is highly negative)**:
- Mirror logic: Enter short 45 min before settlement when funding < 15th percentile, price above VWAP, RSI > 75

### Timeframe
- Primary: 1m candles for entry/exit timing
- Reference: 8-hourly funding rate data (already cached in our system)

### Expected Trade Frequency
- 3 settlement windows per day x potentially 1 trade per window = up to 3 trades per day per symbol
- Not every window will produce a signal (only when funding is extreme)
- Realistic: 5-10 trades per week per symbol

### Leverage Recommendation
- 20x leverage recommended
- At 20x with taker fees: round-trip cost = ~2.1% of margin
- Target move of 0.15-0.30% = 3-6% of margin at 20x
- Risk:reward ratio of approximately 1.5:1 to 3:1

### Risk Management
- Stop loss: 0.20% (4% of margin at 20x)
- Take profit: 0.15-0.30% (3-6% of margin at 20x)
- Max concurrent positions: 1 per symbol
- Max daily loss: 10% of margin
- Position size: 30-50% of equity (to survive multiple stops)

### Why It Might Work in Crypto
- Crypto funding settlements happen at FIXED times (unlike traditional futures)
- Extreme funding rates are common (meme coins regularly hit 0.1%+ per 8h)
- Retail traders are often overleveraged and forced to act near settlement
- 24/7 markets mean no "closing time" complexity

### Data Requirements
- 1m OHLCV candles
- 8-hourly funding rate data (already have this via Bybit)
- Need to map candle timestamps to funding settlement windows

### Potential Pitfalls
- Settlement time effects may have been arbitraged by sophisticated players
- Not all extreme funding sessions show the same pre-settlement pattern
- Funding rate can change during the settlement calculation window
- Need to filter: only trade when funding is genuinely extreme (top/bottom 15%)

---

## Strategy 2: Volatility Regime Transition Scalper

**Confidence: HIGH (7.5/10)**

### One-Line Description
Detect transitions from low-volatility to high-volatility regimes on 1-minute candles and ride the initial explosive move, then exit before the regime fully establishes.

### The Edge

**Market inefficiency**: Crypto markets exhibit extreme volatility clustering - periods of calm followed by explosive moves. Academic research shows GARCH persistence parameters (beta) exceed 0.7-0.9 for crypto, meaning volatility is highly autocorrelated. The transition from low to high volatility is predictable using Bollinger Band Width (BBW) squeeze patterns.

**Why it works**:
1. During low-volatility regimes, limit orders cluster densely around the current price
2. When a breakout occurs, these clustered orders get triggered, creating a cascade
3. The first few minutes of a volatility expansion are strongly directional (momentum)
4. After the initial burst, the market becomes choppy and mean-reverting
5. The key insight: trade ONLY the transition, not the established regime

**Empirical backing**:
- Turn-of-the-candle research (PMC, 2023) shows Bitcoin returns of 0.58 bps per minute concentrate at specific candle boundaries, with "Probabilistic Sharpe ratio of 4.96"
- EGARCH models outperform for crypto volatility modeling, confirming asymmetric volatility behavior (Springer, 2025)
- Markov-switching GARCH models show distinct low-vol and high-vol regimes in intraday crypto data (ResearchGate, 2024)
- Bollinger Band squeeze backtest studies show "breakouts tend to be more explosive after a period of consolidation"

**Why it persists**: Structural feature of market microstructure. Limit order clustering during calm periods is rational market-maker behavior, and the cascade when these orders are hit is a mechanical consequence.

### Signal Logic

**Squeeze Detection**:
1. Calculate Bollinger Band Width (BBW) = (Upper - Lower) / Middle on 1m candles, period=20, stdDev=2.0
2. Calculate BBW percentile over last 200 bars
3. Squeeze condition: BBW is in the bottom 10th percentile of its 200-bar history

**Breakout Entry (Long)**:
1. Squeeze has been active for at least 5 consecutive bars (genuine compression, not a blip)
2. Price closes above the upper Bollinger Band
3. Current volume > 2x the 20-period average volume (confirmation)
4. Enter long at close

**Breakout Entry (Short)**:
1. Same squeeze conditions
2. Price closes below the lower Bollinger Band
3. Volume > 2x average
4. Enter short at close

**Exit**:
- Take profit: 2x ATR(14) from entry (ride the volatility expansion)
- Stop loss: 1x ATR(14) from entry (tight - if it fails immediately, the thesis is wrong)
- Time exit: Close after 15 bars (15 minutes) if neither TP nor SL hit
- Trail: After 1x ATR profit, activate trailing stop at 0.5x ATR from highest/lowest point

### Timeframe
- Primary: 1m candles
- Filter: Check that 15m trend direction aligns with breakout direction (via 50-period SMA on 15m data, constructed from 1m candles within the strategy)

### Expected Trade Frequency
- 3-8 trades per day per symbol (squeezes happen multiple times daily on 1m)
- More during ranging markets, fewer during strong trends

### Leverage Recommendation
- 15-25x leverage
- ATR-based stops scale with volatility, keeping risk consistent
- At 20x: 1 ATR stop typically = 3-5% of margin

### Risk Management
- ATR-based dynamic stops (1x ATR stop, 2x ATR target = 2:1 reward:risk)
- Position size: Risk 2% of equity per trade
- Max daily trades: 5 (to prevent overtrading during choppy squeezes)
- Regime filter: Skip signals when 15m trend is unclear (ADX < 20 on 15m)

### Why It Might Work in Crypto
- Crypto has more extreme volatility clustering than traditional markets
- 24/7 trading means more regime transitions per day
- Retail traders pile in AFTER the move (they buy the new high), creating continuation
- Stop-loss cascades are more common in crypto due to high leverage usage

### Data Requirements
- 1m OHLCV candles with volume
- Bollinger Bands, ATR, volume SMA (all available in our system)
- Optional: 15m candles constructed from 1m for trend filter

### Potential Pitfalls
- False squeezes that expand then immediately contract
- The volume filter is critical - without it, false breakout rate is very high
- On very liquid pairs (BTC/USDT), the moves may be too small to cover fees
- Better suited to mid-cap alts (SOL, ARB, DOGE) with more explosive breakouts

---

## Strategy 3: Funding-Rate-Aware VWAP Mean Reversion

**Confidence: HIGH (7.5/10)**

### One-Line Description
Combine intraday VWAP mean reversion scalping with funding rate bias to only take trades in the direction favored by funding rate collection.

### The Edge

**Market inefficiency**: VWAP (Volume Weighted Average Price) acts as a gravitational center for intraday prices. When price deviates significantly from VWAP, it tends to revert. By adding a funding rate directional bias, we only take mean-reversion trades where we also collect funding payments, creating a dual alpha source.

**Why it works**:
1. VWAP reversion is one of the most well-established intraday patterns, used extensively by institutional traders and prop firms
2. Adding a funding rate filter ensures we trade with the structural flow (when funding is positive, shorting collects funding AND benefits from mean reversion of overextended longs)
3. We are essentially front-running the same dynamic as our FR V2 strategy but on a much shorter timeframe
4. Each trade collects a tiny funding payment if held through settlement, adding to the edge

**Empirical backing**:
- VWAP reversion is the backbone strategy of many prop trading firms (documented extensively in trading literature)
- BIS Working Paper 1087 documents crypto carry returns averaging 7-8% annually with a full-sample Sharpe of 6.45
- "When markets aren't strongly trending, VWAP behaves like a gravitational center" (multiple trading education sources)
- Our own FR V2 research proves funding rate extremes predict price mean reversion (Sharpe 2.08)

**Why it persists**: VWAP reversion persists because institutional algorithms use VWAP as a benchmark for execution quality. Prices naturally gravitate toward VWAP during balanced markets. Funding rate bias persists because it is a structural feature of perpetual futures.

### Signal Logic

**VWAP Calculation** (must be implemented):
- Session VWAP resets at 00:00 UTC daily (or at each funding settlement)
- VWAP = cumulative(price * volume) / cumulative(volume) for the session
- Standard deviation bands at 1x, 2x, 3x from VWAP

**Entry (Short - when funding is positive)**:
1. Funding rate is positive (> 0.005% = above median, not extreme)
2. Price is above VWAP + 2 standard deviations on 1m chart
3. RSI(14) on 1m > 75 (overbought confirmation)
4. Volume on the extension bar is declining (exhaustion, not momentum)
5. Enter short

**Entry (Long - when funding is negative)**:
1. Funding rate is negative (< -0.005%)
2. Price is below VWAP - 2 standard deviations
3. RSI(14) < 25
4. Volume declining
5. Enter long

**Exit**:
- Take profit: Price returns to VWAP (the "mean")
- Stop loss: Price extends to VWAP +/- 3 standard deviations (1 more SD beyond entry)
- Time exit: 30 bars (30 minutes) max hold
- Funding bonus: If holding through a settlement, collect the funding payment

### Timeframe
- Primary: 1m candles for signal generation
- Session: Daily (VWAP resets every 24h or every 8h at funding settlements)
- Reference: Current funding rate (8-hourly data)

### Expected Trade Frequency
- 3-6 trades per day per symbol (VWAP 2-sigma extensions happen regularly)
- Filtered by funding direction, so roughly half of potential setups qualify

### Leverage Recommendation
- 10-20x leverage
- Mean reversion strategies have higher win rates but need room for extensions
- At 15x: A 0.15% move to VWAP = 2.25% margin profit; 0.10% stop = 1.5% margin loss

### Risk Management
- Position size: 40% of equity per trade (high win rate strategy)
- Stop loss: 1 additional standard deviation beyond entry (dynamic)
- Max drawdown per session: 5% of equity
- Session filter: No trades when ADX(14) > 30 on 15m (trending market, VWAP reversion fails)

### Why It Might Work in Crypto
- Crypto VWAP levels are respected because market makers use them as benchmarks
- Funding rate provides a structural directional bias that is unique to crypto
- 24/7 trading means VWAP sessions can be defined around funding settlements
- Mean reversion at VWAP is a well-proven institutional strategy

### Data Requirements
- 1m OHLCV candles with volume
- Funding rate data (8-hourly, already cached)
- VWAP indicator (NEEDS TO BE IMPLEMENTED - see System Gaps)
- RSI, ADX from existing indicator library

### Potential Pitfalls
- VWAP reversion fails completely in strong trends
- Must implement VWAP indicator (not currently in our system)
- Session boundary definition matters: should align with funding settlements
- On extremely volatile days, 2-sigma may not be extreme enough

---

## Strategy 4: Liquidation Zone Bounce Scalper

**Confidence: MEDIUM-HIGH (7/10)**

### One-Line Description
Identify price levels where clusters of leveraged positions will be liquidated, then enter counter-trend positions immediately after a liquidation cascade pushes price to these levels, betting on the snapback.

### The Edge

**Market inefficiency**: Crypto perpetual futures have a unique structural feature - liquidations are market orders that push price further in the same direction. When price enters a "liquidation zone" (a cluster of liquidation prices), it creates a self-reinforcing cascade. But this cascade overshoots the equilibrium price, creating a high-probability snapback opportunity.

**Why it works**:
1. When BTC drops 2% in 5 minutes, it is NOT because the fundamental value changed - it is because liquidations cascaded
2. The forced selling from liquidations is price-insensitive (it is mechanical)
3. After the cascade clears, price snaps back because the selling pressure was artificial
4. This is the same principle as our FR V2 strategy (mean reversion after forced/extreme positioning) but on a micro-timescale

**Empirical backing**:
- The October 2025 crypto liquidation cascade erased "$19 billion in open interest within 36 hours" with "reflexive feedback loops between leverage, liquidity, and volatility" (Zeeshan Ali, SSRN 5611392)
- Amberdata research shows "if many leveraged longs were liquidated at or near a certain price, that level can transform into a resistance barrier" and liquidation zones act as future support/resistance
- One Medium article claims a liquidation cascade alpha strategy achieved "299% return with Sharpe 3.58" (Tigro Blanc, 2026)
- CoinChange research shows November's liquidation cascade "exposed crypto's structural fragilities" with $2 billion in forced liquidations

**Why it persists**: Liquidation cascades are a mechanical consequence of leverage + market orders for liquidation. As long as exchanges use the current liquidation mechanism, this pattern will repeat.

### Signal Logic

**Cascade Detection** (approximation using OHLCV only):
1. Calculate the "cascade score" per 1m bar:
   - Price drop speed: `abs(close - open) / ATR(14)` - how large is this bar relative to normal?
   - Volume spike: `volume / SMA(volume, 20)` - is volume surging?
   - Consecutive directional bars: count of consecutive bearish/bullish 1m bars
2. Cascade detected when:
   - 3+ consecutive bearish bars AND
   - Average bar size > 1.5x ATR AND
   - Volume > 3x average

**Entry (Long after bearish cascade)**:
1. Cascade detected (3+ bearish bars, large size, high volume)
2. RSI(5) on 1m < 15 (extreme oversold on ultra-short RSI)
3. Volume on current bar LOWER than previous bar (exhaustion signal)
4. Enter long at close of exhaustion bar

**Entry (Short after bullish cascade)**:
- Mirror logic for bullish cascades

**Exit**:
- Take profit: 50% of the cascade distance (e.g., if price dropped 0.5%, target 0.25% bounce)
- Stop loss: Below the cascade low (if it makes new lows, the cascade is continuing)
- Time exit: 10 bars (10 minutes) - the snapback is fast or it does not happen

### Timeframe
- Primary: 1m candles
- Detection: Rolling 5-10 bar window for cascade identification

### Expected Trade Frequency
- 1-3 trades per day per symbol (genuine cascades are not common)
- More during high-volatility regimes (market stress, macro events)
- Some days: 0 trades (no cascades)

### Leverage Recommendation
- 10-15x leverage (conservative - trading into the cascade is inherently risky)
- The reward is large (0.25-0.5% moves on 1m) but so is the risk
- At 10x: 0.30% move = 3% margin; 0.20% stop = 2% margin loss

### Risk Management
- Position size: 25% of equity (lower than other strategies due to tail risk)
- Stop loss: Below cascade extreme (absolute floor)
- Max daily cascade trades: 2 (cascades can continue further than expected)
- Never trade into a cascade during a genuine macro event (check if 1h trend broken)
- Trend filter: Only take cascade bounces in the direction of the 4h trend

### Why It Might Work in Crypto
- Crypto has the highest leverage ratios of any market (up to 125x)
- Liquidations are always market orders (guaranteed price impact)
- The cascade mechanism is structural and unique to crypto perpetual futures
- After cascades clear, the order book is thin, making bounces fast and sharp

### Data Requirements
- 1m OHLCV candles with volume
- ATR, RSI, Volume SMA from existing library
- Optional (enhancement): Open interest data from Bybit API (would significantly improve cascade detection)

### Potential Pitfalls
- Without order book or open interest data, cascade detection from OHLCV alone is imprecise
- Some cascades are genuine trend breaks (not bounces) - the 4h trend filter is essential
- Catching a falling knife: need very tight stops
- Requires fast execution; on 1m candles, we trade at bar close which introduces 1-bar delay

---

## Strategy 5: Intraday Time-of-Day Seasonality Scalper

**Confidence: MEDIUM (6.5/10)**

### One-Line Description
Exploit the documented intraday seasonality in Bitcoin/crypto returns: buy at 21:00 UTC and sell at 23:00 UTC (the strongest 2-hour window), enhanced with momentum and funding rate filters.

### The Edge

**Market inefficiency**: Multiple academic studies document significant time-of-day patterns in Bitcoin returns. The 21:00-23:00 UTC window shows the "most economically significant" positive returns, likely driven by Asian market opening overlap and algorithmic rebalancing patterns. A simple long strategy during this window delivered ~33% annualized returns with 20.93% volatility.

**Why it works**:
1. Asian trading session opening (Tokyo, Hong Kong, Singapore) creates buying pressure
2. Institutional rebalancing algorithms are programmed to execute at specific times
3. The turn-of-the-candle effect shows 0.58 bps/min concentrated at 15-min boundaries
4. NYSE closing at ~21:00 UTC triggers portfolio rebalancing flows into crypto
5. This seasonality persists because it is driven by structural timezone differences

**Empirical backing**:
- QuantPedia research shows "the most sizeable and significant returns relate to the time between 21:00 and 23:00" with returns "statistically meaningful at the 5% level"
- A simple buy-21:00-sell-23:00 strategy delivers "approximately 33% annualized returns with substantially lower volatility (20.93%) and drawdown (-22.45%) compared to passive holding"
- Springer (2024) confirms "trading activity, volatility and illiquidity all peaking between 16:00 and 17:00 UTC" showing crypto has strong time-of-day microstructure
- The turn-of-the-candle effect (PMC, 2023) shows positive returns of 0.58 bps/min at 15-min boundaries, with "Probabilistic Sharpe ratio of 4.96"
- ScienceDirect (2024) documents intraday and daily dynamics showing persistent seasonal patterns

**Why it persists**: Driven by structural timezone differences between major financial centers. As long as Asian, European, and American trading sessions overlap at the same times, these patterns will persist.

### Signal Logic

**Simple Version (Calendar Only)**:
1. At 21:00 UTC: Check funding rate direction (positive = prefer long, negative = prefer short)
2. Check 1h trend direction (50 SMA on 1h)
3. If both align bullish: enter long at 21:00
4. Exit at 23:00 (or when 0.3% profit reached, or when 0.15% loss)

**Enhanced Version (with Momentum Filter)**:
1. At 20:45 UTC: Begin monitoring
2. Calculate RSI(14) on 1m and 15m
3. If RSI(14) on 15m is between 40-60 (neutral zone, room to move) AND
4. Funding rate is positive (longs paying shorts = crowd is long = contrarian opportunity would be short, but seasonality says long... so we only trade when funding is MODERATE, not extreme)
5. Enter long at 21:00
6. Set ATR-based stop (1.5x ATR on 15m) and time-based exit at 23:00

**Additional Enhancement - 15-Minute Candle Turn Effect**:
- Within the 21:00-23:00 window, add micro-scalps at minute :00, :15, :30, :45
- Enter 1 minute before the turn, exit 2 minutes after
- This exploits the documented 0.58 bps/min effect at candle boundaries

### Timeframe
- Primary: 1m candles for micro-timing within the window
- Calendar: Daily (the 21:00-23:00 window is the signal)
- Filter: 1h and 15m for trend confirmation

### Expected Trade Frequency
- 1 main trade per day (21:00-23:00 window)
- Optional: 8 micro-scalps within the window (at each 15-min boundary)

### Leverage Recommendation
- 30-50x leverage for the main window trade (if the seasonality holds, the win rate is high)
- 10x for micro-scalps (smaller moves, need to overcome fees)
- At 30x: 0.15% move = 4.5% margin profit

### Risk Management
- Fixed time exit (23:00 UTC) eliminates holding period risk
- Stop loss: 0.15% (4.5% of margin at 30x)
- Target: 0.20-0.30% (6-9% of margin at 30x)
- Only trade 4 days per week (skip weekends when pattern weakens per research)
- Filter: Skip if day's range exceeds 3x average (macro event disrupts seasonality)

### Why It Might Work in Crypto
- Crypto is a 24/7 market with strong timezone-driven seasonality
- Unlike stocks, there is no "market open/close" to compete with
- Asian session has documented buying pressure characteristics
- The turn-of-the-candle effect is specific to algorithmic crypto trading

### Data Requirements
- 1m OHLCV candles with timestamps (need UTC time parsing)
- Funding rate data (for directional filter)
- RSI, ATR, SMA from existing library

### Potential Pitfalls
- Seasonality can shift over time as market participants change
- The 21:00-23:00 window research is primarily from 2019-2022; needs validation on 2024-2026
- Macro events override seasonality completely
- High leverage makes this strategy vulnerable to gap moves (though crypto doesn't really gap)
- The edge per trade is small; high leverage is needed to make it worthwhile

---

## Strategy 6: Volume-Weighted Momentum Burst Scalper

**Confidence: MEDIUM (6/10)**

### One-Line Description
Detect sudden volume-price bursts on 1-minute candles that signal informed trading, then ride the short-term momentum for 3-10 minutes before mean reversion takes over.

### The Edge

**Market inefficiency**: Large informed trades (whale orders, institutional executions) create temporary momentum on 1-minute charts. These trades move price for 3-10 minutes before the market absorbs them. By detecting the initial burst, we can ride the informed flow.

**Why it works**:
1. Order flow research shows "imbalance has a near-linear relationship with short-horizon price changes"
2. Without order book data, we can approximate order flow using volume spikes + price direction
3. A bar with 5x average volume and a strong directional close signals informed activity
4. The momentum from informed trades persists for 3-10 minutes (well-documented in microstructure research)
5. After 10 minutes, the market absorbs the information and price stabilizes or reverts

**Empirical backing**:
- Academic research on order book imbalance shows it "provides a short predictive window... typically from a few seconds to about a minute" and is "structural information, not a lag of past trades" (hftbacktest.readthedocs.io)
- Cornell/SSRN paper on "Microstructure and Market Dynamics in Crypto Markets" (Easley et al.) analyzes how order flow drives crypto prices
- Trading Volume Alpha paper (AEA 2025 conference) documents volume-price interaction as an alpha source
- DWF Labs research on market making confirms that order flow analysis is used by crypto market makers

**Why it persists**: Informed traders CANNOT avoid leaving footprints in volume and price. Large orders, even when broken up, create detectable spikes on 1-minute charts. The persistence window (3-10 min) exists because it takes time for the market to fully absorb new information.

### Signal Logic

**Volume Burst Detection**:
1. Calculate volume SMA(20) on 1m
2. Volume burst: current volume > 5x SMA(20)
3. Directional burst: abs(close - open) > 1.5x ATR(14)
4. Combined burst: both volume AND directional conditions met

**Entry (Momentum Long)**:
1. Volume burst detected with bullish close (close > open)
2. Close is in the top 25% of the candle range (strong close, not just wick)
3. Not already in a position
4. Enter long at close

**Entry (Momentum Short)**:
1. Volume burst with bearish close (close < open)
2. Close is in the bottom 25% of the candle range
3. Enter short at close

**Exit**:
- Take profit: 1x ATR from entry (capture the continuation)
- Stop loss: 0.5x ATR from entry (tight - if it does not continue, the thesis failed)
- Time exit: 10 bars (10 minutes)
- Early exit: If volume drops below 1.5x average after entry (informed flow exhausted)

### Timeframe
- Primary: 1m candles
- Filter: None needed (the volume burst IS the signal)

### Expected Trade Frequency
- 5-15 trades per day per symbol (volume bursts on liquid crypto are common)
- Filtered for quality (5x volume threshold is aggressive)

### Leverage Recommendation
- 15-25x leverage
- Quick trades (3-10 min holding) limit exposure
- At 20x: 0.10% move = 2% margin

### Risk Management
- Position size: 30% of equity
- Stop: 0.5x ATR (very tight - this is momentum trading)
- Reward:risk = 2:1 (1x ATR target vs 0.5x ATR stop)
- Max consecutive losses: 4 (then pause for 30 minutes)
- Volume quality: Reject signals where the candle has long wicks (indecision, not momentum)

### Why It Might Work in Crypto
- Crypto markets have extreme volume spikes (more than traditional markets)
- Whale activity is a documented driver of short-term price moves
- No dark pools in crypto (all order flow is on-exchange and visible)
- Meme coin and altcoin markets are particularly susceptible to informed flow

### Data Requirements
- 1m OHLCV candles with volume (critical - volume is the primary signal)
- ATR, SMA from existing library
- Volume quality analysis (candle body vs wick ratio)

### Potential Pitfalls
- Volume spikes can be manipulation (spoofing) rather than genuine informed flow
- 5x volume threshold may be too aggressive or too lenient depending on the asset
- On BTC/USDT, volume spikes are less informative (too many participants)
- Better suited to mid-cap assets (SOL, DOGE, ARB) where single traders can move price
- Without order book data, we cannot distinguish buying from selling volume

---

## Strategy 7: Multi-Timeframe Momentum Alignment Scalper

**Confidence: MEDIUM (5.5/10)**

### One-Line Description
Only scalp in the direction where 1m, 5m (constructed), 15m (constructed), and 1h (constructed) momentum all align, using the alignment moment as a high-conviction entry.

### The Edge

**Market inefficiency**: When momentum aligns across multiple timeframes simultaneously, it indicates a genuine directional move rather than noise. Most 1m moves are noise; the ones that are not noise are the ones confirmed by higher timeframes. By waiting for alignment, we dramatically increase the signal-to-noise ratio.

**Why it works**:
1. Most 1m scalping fails because most 1m moves are random noise
2. When a 1m bullish signal is confirmed by 5m, 15m, AND 1h all being bullish, the probability of continuation is much higher
3. The alignment moment often coincides with the START of a multi-timeframe trend
4. Once alignment occurs, we ride the initial thrust and exit before the fastest timeframe reverses

**Empirical backing**:
- "Momentum and trend-following strategies typically perform better in stable regimes" (multiple volatility regime studies)
- Volatility-Adjusted Time Series Momentum (VATSM) research shows "dynamically adjusting lookback period based on market volatility" improves returns
- Multi-timeframe analysis is used by professional prop trading firms
- Academic research shows "positive returns of 0.58 basis points per minute" concentrate at specific moments, suggesting alignment effects

**Why it persists**: Different participant groups operate on different timeframes. When all groups agree on direction (alignment), the move is genuine. This is a fundamental aspect of market microstructure.

### Signal Logic

**Timeframe Construction** (from 1m candles):
- 5m: Aggregate every 5 1m candles
- 15m: Aggregate every 15 1m candles
- 1h: Use funding rate interval or aggregate 60 1m candles

**Momentum on Each Timeframe**:
- EMA(8) vs EMA(21): fast above slow = bullish
- RSI(14): above 55 = bullish, below 45 = bearish

**Alignment Score**:
- Score = count of timeframes where EMA crossover is bullish + (1 if RSI > 55)
- Range: 0 (all bearish) to 8 (all 4 TFs bullish on both EMA and RSI)
- Entry threshold: Score >= 7 (strong alignment)

**Entry (Long)**:
1. Alignment score >= 7 (bullish)
2. 1m candle closes above 1m EMA(8) (immediate trigger)
3. Volume on current 1m bar > 1.5x average (participation confirmation)
4. Enter long

**Entry (Short)**:
1. Alignment score <= 1 (bearish)
2. 1m candle closes below 1m EMA(8)
3. Volume > 1.5x average
4. Enter short

**Exit**:
- Take profit: 1.5x ATR(14) on 1m
- Stop loss: 1x ATR(14) on 1m
- Signal exit: Close when 1m RSI crosses 50 (momentum on fastest TF fading)
- Time exit: 20 bars (20 minutes)

### Timeframe
- Primary: 1m candles
- Constructed: 5m, 15m, 1h from 1m data
- Multi-TF alignment is the core signal

### Expected Trade Frequency
- 2-5 trades per day per symbol (full alignment is relatively rare)
- Higher frequency in trending markets, near-zero in ranging markets

### Leverage Recommendation
- 20-30x leverage (high-conviction entries due to multi-TF alignment)
- At 25x: 0.12% move = 3% margin

### Risk Management
- Position size: 40% of equity (high conviction trades)
- ATR-based stops (dynamic)
- Max daily loss: 8% of equity
- Alignment validation: Check alignment at entry AND monitor - if any TF breaks alignment, tighten stop

### Why It Might Work in Crypto
- Crypto trends can be very powerful when they get going
- Multi-TF alignment catches the start of these trends
- 24/7 market means no overnight gaps to worry about
- Works across all crypto assets (not asset-specific)

### Data Requirements
- 1m OHLCV candles
- EMA, RSI, ATR from existing library
- Internal aggregation logic for constructing higher TFs from 1m data

### Potential Pitfalls
- Constructing higher TFs from 1m is computationally expensive
- Alignment can occur at the END of a move, not just the start
- Full alignment may be too restrictive (missing trades)
- The strategy is essentially a trend-following overlay on 1m - it may lag

---

## Cost Analysis Summary

### Transaction Cost Reality Check

For ALL strategies, the following costs apply per round-trip:

| Leverage | Fee Cost (taker) | Slippage Cost | Total RT Cost | Min Move to Profit |
|----------|-------------------|---------------|---------------|-------------------|
| 10x | 1.1% of margin | 1.0% of margin | 2.1% of margin | 0.105% price |
| 15x | 1.65% of margin | 1.5% of margin | 3.15% of margin | 0.105% price |
| 20x | 2.2% of margin | 2.0% of margin | 4.2% of margin | 0.105% price |
| 25x | 2.75% of margin | 2.5% of margin | 5.25% of margin | 0.105% price |
| 50x | 5.5% of margin | 5.0% of margin | 10.5% of margin | 0.105% price |

**Note**: The minimum price move to profit (0.105%) is constant regardless of leverage because fees and slippage scale proportionally. The leverage just amplifies both the profit AND the cost in margin terms.

**With maker fees (0.02% per side)**: Round-trip cost drops to 0.04% + 0.10% slippage = 0.14% in price terms. Using maker orders would dramatically improve all strategies.

### Recommended Assets for Testing

| Asset | Why | Expected Edge |
|-------|-----|---------------|
| BTC/USDT | Most liquid, benchmark | Moderate (lower volatility per 1m bar) |
| ETH/USDT | Second most liquid | Moderate-High |
| SOL/USDT | High volatility, liquid | High (more explosive 1m moves) |
| DOGE/USDT | Meme coin dynamics, extreme funding | High (extreme FR, volume bursts) |
| ARB/USDT | Mid-cap with good liquidity | High (volatile but liquid enough) |
| LDO/USDT | Our top FR V2 performer | Medium-High (familiar characteristics) |
| INJ/USDT | Known for large moves | High (explosive but may whipsaw) |

---

## System Gaps Required for Implementation

### Gap 1: VWAP Indicator (Required for Strategy 3)
- **What**: Implement session-based VWAP with standard deviation bands
- **Complexity**: Medium
- **Implementation**: Add to `src/quant/indicators.ts` or as a helper in the strategy
- **Formula**: VWAP = cumsum(price * volume) / cumsum(volume), reset at session boundary

### Gap 2: 1-Minute Candle Data Caching
- **What**: Cache 1m candle data from Bybit for target symbols (6+ months)
- **Complexity**: Simple (infrastructure exists, just need to run cache script with timeframe=1m)
- **Note**: 1m data is ~525,600 candles per year per symbol vs 2,190 for 4h. Storage and performance implications.

### Gap 3: Intra-Bar Time Awareness
- **What**: Strategy needs to know the UTC hour/minute of each candle for time-of-day strategies
- **Complexity**: Simple (timestamp is already in Candle interface, just parse it)
- **Implementation**: `new Date(candle.timestamp).getUTCHours()` etc.

### Gap 4: Multi-Timeframe Construction from 1m
- **What**: Helper to aggregate 1m candles into 5m, 15m within the strategy
- **Complexity**: Simple
- **Implementation**: Group consecutive 1m bars by floor(timestamp / (5*60*1000)) for 5m

### Gap 5: Performance Optimization for 1m Backtests
- **What**: 1m backtests over 6 months = 262,800 bars. Need to ensure indicator calculations are efficient.
- **Complexity**: Medium
- **Note**: Current indicator calculations recalculate from scratch each bar. For 1m, this could be very slow.
- **Solution**: Incremental indicator calculation or pre-calculate all indicators in init()

### Gap 6: Leverage Configuration in Strategy Params
- **What**: Allow strategies to specify leverage as a parameter
- **Complexity**: Simple (LeveragedPortfolio already supports leverage up to 125x)
- **Note**: Need to wire strategy params to engine's leverage setting

---

## Strategy Priority Ranking

| Rank | Strategy | Confidence | Novel? | Edge Type | Implementation |
|------|----------|------------|--------|-----------|----------------|
| 1 | FR Settlement Window Scalper | 8/10 | Very | Structural | Medium |
| 2 | Volatility Regime Transition | 7.5/10 | Moderate | Microstructure | Simple |
| 3 | FR-Aware VWAP Mean Reversion | 7.5/10 | Moderate | Structural+Technical | Medium (VWAP) |
| 4 | Liquidation Zone Bounce | 7/10 | Very | Structural | Simple |
| 5 | Time-of-Day Seasonality | 6.5/10 | Low | Calendar | Simple |
| 6 | Volume Momentum Burst | 6/10 | Moderate | Microstructure | Simple |
| 7 | Multi-TF Momentum Alignment | 5.5/10 | Low | Technical | Medium |

### Recommended Implementation Order

**Phase 1 (Immediate - Highest Edge)**:
1. **FR Settlement Window Scalper** - Most novel, exploits our existing FR data, structural edge
2. **Volatility Regime Transition** - Uses existing indicators, well-documented edge

**Phase 2 (After Phase 1 Results)**:
3. **Liquidation Zone Bounce** - Novel concept, simple implementation
4. **FR-Aware VWAP Mean Reversion** - Requires VWAP indicator implementation

**Phase 3 (Exploratory)**:
5. **Time-of-Day Seasonality** - Calendar anomaly, needs validation on recent data
6. **Volume Momentum Burst** - Simple but needs careful parameter tuning
7. **Multi-TF Momentum Alignment** - Most conventional, lowest expected edge

---

## References

### Academic Papers
1. "Turn-of-the-candle effect in bitcoin returns" (PMC, 2023) - [Link](https://pmc.ncbi.nlm.nih.gov/articles/PMC10015199/)
2. "Anatomy of the Oct 10-11, 2025 Crypto Liquidation Cascade" by Zeeshan Ali (SSRN 5611392) - [Link](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5611392)
3. "Microstructure and Market Dynamics in Crypto Markets" by Easley et al. (Cornell/SSRN) - [Link](https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf)
4. BIS Working Paper 1087 "Crypto Carry" - [Link](https://www.bis.org/publ/work1087.pdf)
5. "The Crypto Carry Trade" by Christin et al. (CMU) - [Link](https://www.andrew.cmu.edu/user/azj/files/CarryTrade.v1.0.pdf)
6. "Intraday and daily dynamics of cryptocurrency" (ScienceDirect, 2024) - [Link](https://www.sciencedirect.com/science/article/pii/S1059056024006506)
7. "Intraday regime switching volatility dynamics of bitcoin liquidity" (ResearchGate, 2024) - [Link](https://www.researchgate.net/publication/381840417_Intraday_regime_switching_volatility_dynamics_of_bitcoin_liquidity)
8. "Perpetual Futures Pricing" by Ackerer, Hugonnier, Jermann (Wharton) - [Link](https://finance.wharton.upenn.edu/~jermann/AHJ-main-10.pdf)
9. "The Seasonality of Bitcoin" by Vojtko, Javorska (SSRN 4581124) - [Link](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4581124)
10. "Predictability of Funding Rates" by Emre Inan (SSRN 5576424) - [Link](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5576424)
11. "Designing funding rates for perpetual futures in cryptocurrency markets" (arXiv 2506.08573) - [Link](https://arxiv.org/html/2506.08573v1)
12. "High-frequency dynamics of Bitcoin futures" (ScienceDirect, 2025) - [Link](https://www.sciencedirect.com/science/article/pii/S2214845025001188)
13. "Volatility dynamics of cryptocurrencies using GARCH-family models" (Springer, 2025) - [Link](https://link.springer.com/article/10.1186/s43093-025-00568-w)
14. "Exploring Risk and Return Profiles of Funding Rate Arbitrage on CEX and DEX" (ScienceDirect, 2025) - [Link](https://www.sciencedirect.com/science/article/pii/S2096720925000818)
15. "Trading Games: Beating Passive Strategies in the Bullish Crypto Market" (Journal of Futures Markets, Wiley, 2025) - [Link](https://onlinelibrary.wiley.com/doi/full/10.1002/fut.70018)
16. "Adverse Selection in Cryptocurrency Markets" by Tinic, Sensoy (Nottingham) - [Link](https://nottingham-repository.worktribe.com/OutputFile/40584797)

### Industry Research
1. Amberdata Blog - "Liquidations in Crypto: How to Anticipate Volatile Market Moves" - [Link](https://blog.amberdata.io/liquidations-in-crypto-how-to-anticipate-volatile-market-moves)
2. CEPR VoxEU - "Crypto carry: Market segmentation and price distortions" - [Link](https://cepr.org/voxeu/columns/crypto-carry-market-segmentation-and-price-distortions-digital-asset-markets)
3. QuantPedia - "Are There Seasonal Intraday or Overnight Anomalies in Bitcoin?" - [Link](https://quantpedia.com/are-there-seasonal-intraday-or-overnight-anomalies-in-bitcoin/)
4. QuantPedia - "The Seasonality of Bitcoin" - [Link](https://quantpedia.com/the-seasonality-of-bitcoin/)
5. Coinbase Research - "Understanding Funding Rates in Perpetual Futures" - [Link](https://www.coinbase.com/learn/perpetual-futures/understanding-funding-rates-in-perpetual-futures)
6. DWF Labs - "4 Core Crypto Market Making Strategies Explained" - [Link](https://www.dwf-labs.com/news/4-common-strategies-that-crypto-market-makers-use)
7. CoinChange - "Bitcoin's $2 Billion Reckoning" - [Link](https://www.coinchange.io/blog/bitcoins-2-billion-reckoning-how-novembers-liquidations-cascade-exposed-cryptos-structural-fragilities)

---

## Change Log

**Version 1.0** - 2026-03-04
- Initial 7-strategy research document
- Comprehensive cost analysis
- System gap identification
- Priority ranking established
