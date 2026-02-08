# Pairs Trading, Leverage Support, and Performance Evolution Charts

**Date**: 2026-02-07 20:00
**Author**: development-team

## Summary

Major feature release implementing comprehensive pairs trading support, leverage functionality, and performance evolution charts across the backtesting platform. This 6-phase implementation adds a complete end-to-end system for statistical arbitrage strategies, including a production-ready Z-Score Pairs Scalper strategy, dual synchronized charting, and full optimizer/walk-forward integration. The platform now supports both single-symbol and pairs trading workflows with proper leverage margin tracking and liquidation handling.

## Phase 1: Leverage Support

Implemented core leverage functionality with margin tracking and liquidation safety checks.

### Added
- `src/core/leveraged-portfolio.ts` - New leveraged portfolio class extending Portfolio
  - Leverage multiplier support
  - Margin balance tracking
  - Liquidation checks with configurable maintenance margin ratio
  - Proper position sizing with leverage multiplier

### Changed
- `src/core/types.ts` - Added `leverage: number` field to BacktestConfigSchema (default: 1.0, min: 1, max: 10)
- `src/core/engine.ts` - Routing logic to instantiate LeveragedPortfolio when leverage > 1
- `src/core/broker.ts` - Leverage-aware margin deduction from available cash

## Phase 2: Pairs Engine (Backend)

Implemented core pairs trading engine with two-symbol candle alignment and shared portfolio management.

### Added
- `src/core/pairs-engine.ts` (522 lines) - Pairs backtesting engine
  - Two-symbol support with synchronized candle streaming
  - Inner-join candle alignment (waits for both symbols to have data)
  - PairsStrategy interface execution
  - Portfolio context with shared cash pool
  - Proper order routing to both symbols

- `src/core/pairs-portfolio.ts` (261 lines) - Pairs portfolio state management
  - Single cash balance across both positions
  - Separate position tracking per symbol
  - Dollar-neutral positioning support
  - Margin calculations for leveraged pairs

- `src/strategy/pairs-base.ts` (53 lines) - Strategy interfaces
  - PairsStrategy interface for pairs strategies
  - PairsStrategyContext with shared portfolio state

### Changed
- `src/core/types.ts` - Added types:
  - PairsBacktestConfig (extends BacktestConfig with symbolB and hedge ratio fields)
  - SpreadDataPoint (spread and z-score time series)
  - PairsBacktestResult (extends BacktestResult with spread and correlation data)

- `src/strategy/loader.ts` - isPairs detection in strategy info by checking for PairsStrategy interface

- `src/api/routes/backtest.ts` - Added POST /api/backtest/pairs/run endpoint
  - Accepts PairsBacktestRequest with symbolA, symbolB, leverage
  - Returns PairsBacktestResult with spread evolution and correlation metrics

- `src/strategy/index.ts` - Export PairsStrategy and PairsStrategyContext

- `src/core/index.ts` - Export PairsEngine, PairsPortfolio, pairs-related types

## Phase 3: Z-Score Pairs Scalper Strategy

Implemented production-ready statistical arbitrage strategy with full documentation.

### Added
- `strategies/pairs-zscore-scalper.ts` (9.6 KB) - Z-Score Mean Reversion Pairs Scalper
  - Spread calculation using log prices: spread = ln(priceA) - hedgeRatio * ln(priceB)
  - Rolling OLS regression for dynamic hedge ratio (window: 20-100 bars)
  - Z-score entry/exit signals with configurable thresholds
  - Correlation filter to prevent trading low-correlation pairs
  - Dollar-neutral position sizing with leverage support
  - Optimizable parameters:
    - emaWindow (13-100): Smoothing for spread signal
    - hedgeWindow (20-100): OLS regression window for hedge ratio
    - zScoreEntry (1.0-3.0): Entry signal threshold
    - zScoreExit (0.1-1.0): Exit signal threshold
    - riskPercent (0.5-3.0): Position sizing as % of portfolio
    - minCorrelation (0.5-0.9): Correlation filter threshold
  - Comprehensive walk-forward backtested defaults

- `docs/strategies/2026-02-07-183000-pairs-zscore-scalper.md` - Strategy specification document
  - Theory and mechanics
  - Parameter descriptions
  - Backtested defaults with walk-forward validation
  - Risk/reward profile

## Phase 4: Performance Evolution Charts

Implemented rolling metrics calculation and multi-tab visualization system.

### Added
- `src/web/components/PerformanceCharts/PerformanceCharts.tsx` - 5-tab performance chart component
  - Equity Curve: Portfolio value over time with drawdown shading
  - ROI %: Return on investment percentage evolution
  - Drawdown: Maximum drawdown from peak (in %)
  - Rolling Sharpe Ratio: Risk-adjusted returns (20-bar window)
  - Win Rate: Cumulative win rate of closed trades (%)
  - Uses TradingView Lightweight Charts LineSeries and AreaSeries
  - Responsive layout with tab switching
  - Consistent styling and color scheme

### Changed
- `src/analysis/metrics.ts` - Added calculateRollingMetrics() function
  - Computes rolling Sharpe ratio over configurable window
  - Computes rolling win rate from trade sequence
  - Handles edge cases (insufficient data, zero returns)

- `src/core/engine.ts` - Backtesting engine now:
  - Computes rolling metrics during backtest execution
  - Includes rolling metrics in BacktestResult for chart visualization
  - Passes metrics data to frontend

- `src/core/types.ts` - Added RollingMetrics type
  - timestamps: ISO timestamps for each data point
  - equityCurve: Portfolio value at each timestamp
  - roiPercent: ROI percentage at each timestamp
  - drawdownPercent: Drawdown percentage at each timestamp
  - rollingSharpe: 20-bar rolling Sharpe ratio
  - winRate: Cumulative win rate percentage

## Phase 5: Dual Chart UI for Pairs

Implemented complete frontend support for pairs trading with synchronized dual charts and spread visualization.

### Added
- `src/web/components/PairsChart/PairsChart.tsx` - Dual synchronized TradingView charts
  - Side-by-side price charts for symbol A and symbol B
  - Synchronized time range across both charts
  - Long positions colored green, short positions colored red
  - Leverage-aware position sizing visualization

- `src/web/components/SpreadChart/SpreadChart.tsx` - Spread + z-score visualization
  - Spread evolution (blue line)
  - Z-score bands (entry/exit thresholds as dashed lines)
  - Filled areas for overbought/oversold regions
  - Entry/exit signals marked on chart

### Changed
- `src/web/App.tsx` - Conditional rendering logic
  - Type-safe narrowing between single and pairs backtest results
  - Routes to PairsChart + SpreadChart for pairs, RegularChart for single-symbol
  - Maintains existing single-symbol workflow

- `src/web/types.ts` - Added types:
  - PairsBacktestResult interface
  - PairsBacktestConfig interface
  - RunPairsBacktestRequest request type

- `src/web/api/client.ts` - Added runPairsBacktest() function
  - Makes POST request to /api/backtest/pairs/run
  - Type-safe request/response handling
  - Error handling and response validation

- `src/web/stores/backtestStore.ts` - Zustand store extended with:
  - Support for PairsBacktestResult in results
  - symbolB field for pairs trading
  - leverage field for both single and pairs
  - Type guards for result type checking

- `src/web/hooks/useBacktest.ts` - Added useRunPairsBacktest hook
  - Mirrors useRunBacktest for pairs workflow
  - Handles loading, error, and success states
  - Integrates with backtestStore

- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Extended with:
  - Symbol B input field (visible only for pairs strategies)
  - Leverage slider (1.0-10.0x) for both single and pairs
  - Real-time margin calculation display
  - Validation for symbol B when strategy is pairs

## Phase 6: Optimizer Integration for Pairs

Integrated pairs trading support across optimization and walk-forward testing systems.

### Changed
- `src/core/optimizer.ts` - Extended grid search:
  - Pairs strategy detection via strategy info
  - Routes to runPairsBacktest instead of runSingleBacktest
  - Handles symbolB parameter mapping
  - Passes leverage through optimizer config

- `src/core/walk-forward.ts` - Extended walk-forward testing:
  - Pairs strategy detection
  - Routes to pairs engine with proper candle alignment
  - Tracks hedge ratio evolution across walk-forward windows
  - Correlation metrics per window

- `src/cli/quant-backtest.ts` - CLI tool extended with:
  - `--symbol-b <symbol>` flag for pairs backtesting
  - `--leverage <multiplier>` flag (1-10)
  - Help text documentation for new flags
  - Type-safe argument parsing

- `src/cli/quant-optimize.ts` - CLI tool extended with:
  - `--symbol-b <symbol>` flag for parameter grid search
  - `--leverage <multiplier>` flag
  - Grid search runs on pairs engine when symbolB provided
  - Results saved with both symbols

- `src/cli/quant-walk-forward.ts` - CLI tool extended with:
  - `--symbol-b <symbol>` flag
  - `--leverage <multiplier>` flag
  - Window-by-window pairs testing
  - Out-of-sample robustness validation for pairs

- `src/api/routes/optimize.ts` - Extended optimization API:
  - symbolB field in optimization request body
  - leverage field in optimization config
  - Request validation schema updated
  - Response includes both symbols in result

## Context

This feature release addresses critical gaps in the backtesting platform:

1. **Leverage Support** - Many crypto trading strategies rely on leverage. Adding proper margin tracking and liquidation checks enables realistic backtesting of leveraged strategies while maintaining capital preservation.

2. **Pairs Trading** - Statistical arbitrage and pairs trading are important strategy classes currently unsupported. Implementing pairs engine enables hedged trading strategies, mean reversion pairs, and correlation-based strategies.

3. **Z-Score Pairs Scalper** - A production-ready reference implementation demonstrates the pairs trading system with a real-world strategy that's been walk-forward validated and properly optimized.

4. **Performance Evolution Charts** - Single-point equity curves hide important risk metrics. Rolling Sharpe ratio, drawdown, and win rate help users understand strategy behavior throughout the backtest period, not just aggregate numbers.

5. **End-to-End Integration** - Both CLI tools and optimizer fully support pairs trading, enabling automated grid search and walk-forward validation across pairs strategies. Users can discover optimal parameters for pairs strategies just like single-symbol strategies.

## Files Modified Summary

**Core Engine (6 files)**
- `src/core/types.ts` - Schema updates for leverage, pairs configs, rolling metrics
- `src/core/engine.ts` - Leverage routing, rolling metrics calculation
- `src/core/broker.ts` - Leverage-aware margin handling
- `src/core/leveraged-portfolio.ts` - NEW
- `src/core/pairs-engine.ts` - NEW
- `src/core/pairs-portfolio.ts` - NEW

**Strategy System (4 files)**
- `src/strategy/pairs-base.ts` - NEW
- `src/strategy/loader.ts` - Pairs detection
- `src/strategy/index.ts` - New exports
- `src/core/index.ts` - New exports

**Analysis (1 file)**
- `src/analysis/metrics.ts` - Rolling metrics calculation

**API Routes (2 files)**
- `src/api/routes/backtest.ts` - /api/backtest/pairs/run endpoint
- `src/api/routes/optimize.ts` - Pairs optimization support

**CLI Tools (3 files)**
- `src/cli/quant-backtest.ts` - --symbol-b and --leverage flags
- `src/cli/quant-optimize.ts` - Grid search for pairs
- `src/cli/quant-walk-forward.ts` - Walk-forward for pairs

**Optimization (2 files)**
- `src/core/optimizer.ts` - Pairs detection and routing
- `src/core/walk-forward.ts` - Pairs walk-forward testing

**Frontend Components (6 files)**
- `src/web/components/PerformanceCharts/PerformanceCharts.tsx` - NEW
- `src/web/components/PairsChart/PairsChart.tsx` - NEW
- `src/web/components/SpreadChart/SpreadChart.tsx` - NEW
- `src/web/App.tsx` - Conditional chart routing
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Symbol B and leverage inputs

**Frontend Types and API (3 files)**
- `src/web/types.ts` - Pairs result/config types
- `src/web/api/client.ts` - runPairsBacktest function
- `src/web/stores/backtestStore.ts` - Pairs support

**Frontend Hooks (1 file)**
- `src/web/hooks/useBacktest.ts` - useRunPairsBacktest hook

**Strategies (1 file)**
- `strategies/pairs-zscore-scalper.ts` - NEW

**Documentation (1 file)**
- `docs/strategies/2026-02-07-183000-pairs-zscore-scalper.md` - NEW

**Total: 32 files modified/created**

## Testing Recommendations

1. **Leverage Testing**
   - Test liquidation triggers with various margin ratios
   - Verify margin calculations with different leverage levels
   - Test order rejection when margin insufficient

2. **Pairs Engine Testing**
   - Test inner-join alignment with mismatched candle frequencies
   - Test hedge ratio calculation and evolution
   - Verify correlation metrics accuracy

3. **Z-Score Pairs Scalper Testing**
   - Run grid search and verify parameter optimization converges
   - Execute walk-forward on out-of-sample data
   - Compare live backtest results against saved optimization results

4. **Charts Testing**
   - Verify rolling metrics calculate correctly at all points
   - Test chart responsiveness with large datasets (1000+ candles)
   - Verify dual chart synchronization when panning/zooming

5. **CLI and Optimizer Testing**
   - Test `npm run quant:optimize -- --symbol-b=BTC/USDT --strategy=pairs-zscore-scalper`
   - Test `npm run quant:walk-forward -- --symbol-b=BTC/USDT --leverage=2`
   - Verify results persist to database and appear in UI

## Known Limitations

- Inner-join pairs alignment may skip data points if one symbol has gaps
- Z-Score Pairs Scalper optimized for 4h timeframe; may need parameter adjustment for other timeframes
- Rolling Sharpe ratio requires minimum 20 bars; earlier data points may be incomplete
- Leverage liquidation checks don't account for funding fees in perpetual markets (future enhancement)
