# Project Goals

## Mission

Build a comprehensive crypto backtesting and paper trading platform to research, optimize, validate, and simulate trading strategies before deploying real capital, with the ultimate goal of profitable algorithmic trading.

## Current Project Status

### Phase 1: Single-Asset Backtesting (Complete)
- Single strategy on one symbol with one timeframe
- Fetch historical candles from exchanges
- Run strategy bar-by-bar simulation
- Calculate comprehensive metrics
- Display equity curves and trade history
- Full test coverage for calculations

### Phase 2: Multi-Asset Portfolio Backtesting (Complete)
- Multiple strategies running simultaneously with shared capital
- Signal aggregation system (single strongest, weighted, top N)
- Per-asset equity tracking and breakdowns
- Cross-asset strategy support
- Aggregation configuration saving/loading

### Phase 3: Optimization & Walk-Forward (Complete)
- Parameter grid search with auto-caching
- Walk-forward robustness validation
- Optimization history tracking and comparison
- Progressive ranking by multiple metrics
- Batch multi-symbol optimization

### Phase 4: Paper Trading Simulation (Complete)
- Real-time strategy execution without real capital
- Live candle fetching every 5 minutes
- Multi-strategy signal processing
- WebSocket event streaming (trades, equity, errors)
- Persistent session storage (can resume after restart)
- Event audit logging

### Current Phase: UI Polish + Connector Abstraction
- Dashboard responsiveness improvements
- Connector entity abstraction (paper = Connector, Bybit = Connector)
- Production readiness and stability
- Documentation updates

## System Capabilities

### Backtesting
- Single-asset backtest with 14 production strategies
- Multi-asset portfolio backtesting with signal aggregation
- Realistic trade simulation (fees, slippage, market orders)
- Spot and futures trading modes
- Leverage support
- Funding rate payments for futures

### Optimization & Analysis
- Parameter grid search (test all combinations)
- Walk-forward validation (70% train, 30% test)
- Robustness scoring (degradation tracking)
- Comprehensive performance metrics (Sharpe, Sortino, max drawdown, etc.)
- Composite scoring (weighted metric combinations)

### Paper Trading
- Real-time simulation with live candles
- Multi-strategy signal aggregation
- Capital allocation via multiple strategies
- Session persistence (resume after restart)
- Equity snapshots for charting
- Trade event streaming

### Frontend
- Interactive equity curve charts
- Strategy configuration UI with parameter forms
- Backtest history browser with filtering
- Optimization results modal with history
- Paper trading session management
- Real-time price ticker
- Multi-asset portfolio breakdown

### Data & Persistence
- PostgreSQL database (production-grade)
- Schema migrations system
- Candle caching to avoid redundant fetches
- Backtest/optimization result history
- Paper trading session history
- User authentication (JWT)

## Success Criteria

### For a Strategy to Go Live
1. **Positive backtest** - Profitable over historical data
2. **Statistical validation**:
   - Sharpe Ratio > 1.0
   - Positive expectancy
   - Max drawdown acceptable for strategy type
   - Walk-forward validation passes (degradation < 30%)
3. **Paper trading validation** - Profitability in real-time simulation

### For the System
- Test any candle-based strategy on any CCXT exchange
- Support spot and futures trading modes
- Provide clear, actionable metrics
- Preserve full history of all runs and configurations
- Handle concurrent backtests and optimizations
- Secure user authentication

## Risk Philosophy

- Risk is **configurable per strategy**
- Conservative defaults: 1-2% risk per trade
- Kill switch mechanisms for daily loss limits
- Position sizing rules (max % of capital)
- Never over-leverage beyond configured limits

## Non-Goals

- High-frequency trading (< 1 minute resolution)
- Order book / Level 2 data analysis
- Social sentiment analysis
- Multi-user / SaaS deployment
- Real-time exchange API integration (paper trading only)

## Technical Decisions

### Why TypeScript?
- Type safety across full stack
- Reduces runtime errors
- Single language simplifies development
- Good ecosystem for backend and frontend

### Why PostgreSQL?
- Production-grade persistence
- Connection pooling for scalability
- Schema versioning via migrations
- Ready for cloud deployment
- Can handle years of historical data efficiently

### Why CCXT?
- Unified API for 100+ exchanges
- Community-maintained
- Makes exchange migration trivial
- Support for both spot and futures

### Why Fastify?
- Fast and lightweight
- Built-in JSON schema validation
- WebSocket support
- Good TypeScript support

### Why React + Vite?
- Fast development experience
- Rich component ecosystem
- Good performance
- Easy to test with Playwright

## Long-Term Vision

1. **Phase 4 Completion**: Real exchange connectors (Connector abstraction)
2. **Phase 5**: Live trading with risk management and monitoring
3. **Phase 6**: Multi-user platform with shared strategy library
4. **Phase 7**: Advanced analytics (ML signals, correlation detection, regime analysis)

## Metrics We Track

| Metric | Why It Matters |
|--------|----------------|
| Sharpe Ratio | Risk-adjusted returns (primary optimization metric) |
| Total Return % | Bottom-line profitability |
| Max Drawdown | Worst-case loss exposure |
| Win Rate | Proportion of profitable trades |
| Profit Factor | Gross profit / Gross loss ratio |
| Expectancy | Expected value per trade |
| Exposure Time | Capital efficiency |
| Walk-forward Degradation | Parameter overfitting detection |

## Current Implementation

**14 Production Strategies:**
- Momentum & Trend: SMA, EMA+MACD, CCI, BB Squeeze, ATR Scalper
- Funding Rate: FR Spike V2, FR Gradient, FR Epoch, FR Regime, FR Settlement
- Market Structure: Leader Divergence, OI Delta, BB+RSI
- Multi-confirmation: GPT Long Ultimate

**3 Major Modules:**
- Backtesting (single + aggregate)
- Optimization (grid search + walk-forward)
- Paper Trading (real-time simulation)

**Complete API:**
- 40+ REST endpoints
- WebSocket streaming
- JWT authentication
- SSE progress streams
