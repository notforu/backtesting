# Project Goals

## Mission

Build a flexible crypto backtesting system to test and validate trading strategies before deploying capital, with the ultimate goal of profitable algorithmic trading.

## Success Criteria

### For a Strategy to Go Live
1. **Positive backtest** - Profitable over historical data
2. **Statistical validation**:
   - Sharpe Ratio > 1.0
   - Positive expectancy
   - Reasonable max drawdown (configurable per strategy)
   - Walk-forward validation passes
3. **Paper trading period** (future phase)

### For the System
- Can test any candle-based strategy
- Supports multiple exchanges and timeframes
- Provides clear, actionable metrics
- Preserves full history of all backtest runs
- Smooth transition to live trading when ready

## Trading Approach

### Styles to Support
1. **Trend Following** - Ride momentum, hold for hours/days
   - Moving average crossovers
   - Breakout strategies
   - Momentum indicators

2. **Mean Reversion** - Fade extremes, quick trades
   - RSI oversold/overbought
   - Bollinger Band bounces
   - Statistical arbitrage

### Risk Philosophy
- Risk is **configurable per strategy**
- Default conservative: 1-2% risk per trade
- Kill switch for daily loss limits
- Never risk more than can afford to lose

## Feature Priorities

### Phase 1: Full Vertical Slice (Current)
Complete end-to-end flow for one strategy:
1. Fetch BTCUSDT candles from Binance
2. Run SMA crossover strategy
3. Display results on TradingView chart
4. Show basic metrics dashboard
5. Save run to history

### Phase 2: Multi-Asset & Correlations
- Support multiple symbols simultaneously
- BTC/ETH correlation analysis
- Cross-asset correlation matrix
- Portfolio-level strategies

### Phase 3: Advanced Analysis
- Rolling correlations (regime detection)
- Walk-forward optimization
- Monte Carlo simulation
- Strategy comparison tools

### Phase 4: Live Trading
- Real exchange connectors
- Paper trading mode
- Position synchronization
- Real-time monitoring

## Non-Goals (For Now)

- High-frequency trading (< 1 minute resolution)
- Order book / Level 2 data analysis
- Social sentiment analysis
- Multi-user / SaaS deployment

## Technical Decisions

### Why TypeScript Full Stack?
- Single language reduces context switching
- Type safety catches errors early
- Good ecosystem for both backend and frontend
- Easy to hire/collaborate if needed

### Why SQLite?
- Zero configuration
- Portable (single file)
- Sufficient for 1-2 years of candle data
- Can migrate to PostgreSQL later if needed

### Why CCXT?
- Unified API for 100+ exchanges
- Well-maintained, large community
- Makes exchange migration trivial

### Why TradingView Lightweight Charts?
- Professional appearance
- Free and open source
- Lightweight (unlike full TradingView widget)
- Good documentation

## Metrics We Care About

| Metric | Why It Matters |
|--------|----------------|
| Total Return | Bottom line performance |
| Sharpe Ratio | Risk-adjusted returns |
| Max Drawdown | Worst case scenario |
| Win Rate | Psychological sustainability |
| Profit Factor | Edge confirmation |
| Expectancy | Per-trade expected value |
| Exposure Time | Capital efficiency |

## Correlation Analysis (Planned)

Start simple, expand as needed:

1. **BTC Beta** - How does token move vs BTC?
2. **ETH Beta** - How does token move vs ETH?
3. **Correlation Matrix** - Cross-asset relationships
4. **Rolling Correlations** - Regime changes over time

Use cases:
- Avoid correlated positions (hidden concentration)
- Hedge with negatively correlated assets
- Detect regime changes (correlations breaking down)

## Versioning Strategy

- Strategies are Git-versioned
- Backtest runs reference:
  - Strategy file path
  - Git commit hash (if available)
  - Parameter values
  - Date range tested
- Full reproducibility of any historical run
