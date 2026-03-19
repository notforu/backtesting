# Changelog

All notable changes to this project are documented here. Newest entries first.

---

## [2026-03-19] Mutation Testing Challenge: Financial Logic Coverage

### Summary
Completed manual mutation testing across 5 critical financial modules (backtesting engine, metrics, aggregate engine, multi-portfolio, and paper trading). Discovered 15 coverage gaps in existing tests and fixed with 110 new specification tests. Overall mutation kill rate improved from 63% (26/41 mutations) to 100% after fixes.

### Key Changes
- **Engine Unit Tests**: 19 new tests covering funding rate calculations, loop boundaries, early exit bypasses
- **Metrics Calculation**: 5 new tests fixing Sharpe annualization, Sortino downside deviation, win rate, expectancy calculations
- **Aggregate Engine**: NEW test file with 9 tests for capital allocation, top_n selection, weight normalization
- **Multi-Portfolio**: 3 new tests for short position PnL sign and capital distribution
- **Paper Trading**: 5 new tests for SL/TP placement, funding rate boundaries, state restoration
- **Price Watcher**: NEW test file with 41 tests (100% kill rate on 6 mutations)
- **Live Data Fetcher**: NEW test file with 28 tests for OHLCV aggregation and time windows

### Critical Findings
1. **Degenerate test inputs masked bugs**: Existing tests only used all-winner trades, equal weights, single assets
2. **15 mutations survived original tests**: Sharpe annualization factor, Sortino sign flips, off-by-one errors, weight normalization skips
3. **Structural gap identified**: `runBacktest()` cannot be unit tested due to hard DB/file system dependencies
4. **100% kill rate achieved**: All 110 new tests pass; all 41 tested mutations now killed

See `/docs/changelogs/2026-03-19-145000-mutation-testing-challenge.md` for full details.

---

## [2026-03-19] Funding Rate Spike V4: Engine-Managed Stop Loss & Take Profit

### Summary
Implemented engine-managed stop loss and take profit execution in the backtesting system. The new `funding-rate-spike-v4` strategy uses `ctx.setStopLoss()` and `ctx.setTakeProfit()` instead of manual exit checks, producing 5-24% more realistic (lower) performance metrics. Comparison with v2 reveals systematic optimism in candle-close execution models.

### Key Changes
- **Signal adapter SL/TP methods** now persist values instead of no-ops
- **Aggregate engine** checks intra-bar SL/TP levels before evaluating `wantsExit()` (step 4c)
- **Engine metrics** now track SL/TP trigger counts and pessimistic instances
- **Mode defaulting** fixed in aggregate engine (was not defaulting to 'futures')

### Performance Results
Comparison of v2 (manual candle-close exits) vs v4 (engine-managed intra-bar exits):

| Configuration | V2 Sharpe | V4 Sharpe | Degradation | Pessimistic Instances |
|---------------|-----------|-----------|-------------|----------------------|
| 7-symbol top_n | 3.122 | 2.883 | -8% | 7 |
| 11-symbol top_n | 3.042 | 2.312 | -24% | 22 |
| 13-symbol short-selling | 2.982 | 2.833 | -5% | 9 |

V2's systematic optimism (5-24% higher Sharpe) is resolved by filling at exact SL/TP price levels rather than candle close.

### Files
See `/docs/changelogs/2026-03-19-091500-funding-rate-spike-v4-engine-sltp.md` for complete details.

---

## [2026-02-25] Params Modal and Explorer Improvements

### Summary
Major improvements to the Run Params Modal, History Explorer, and header UX. Added editable params modal for aggregation runs with support for ad-hoc backtest execution, new API endpoint for inline aggregation runs, and enhanced history explorer with params tooltips and visual highlighting.

### Added
- **Params button in header**: Gear icon "Params" button in main header bar (next to "Explore Runs")
  - Only visible when a run is loaded that has parameters
  - Opens RunParamsModal for the currently displayed backtest
- **New API endpoint**: `POST /api/backtest/aggregate/run` - Runs aggregation backtest with inline config
  - Accepts full `AggregateBacktestConfig` in body
  - Validates with Zod schema, saves result to DB
- **Client-side function**: `runAdhocAggregation()` in `src/web/api/client.ts`
- **History Explorer params tooltip**: Hover tooltip showing key:value parameters
  - SubStrategies array displays as "N sub-strategies" instead of raw JSON

### Changed
- **RunParamsModal (full rewrite)**:
  - No longer read-only for aggregation runs
  - Full editing of top-level settings and sub-strategy list
  - Delete sub-strategies with X button
  - Add new sub-strategies via inline form
  - Fixed `[object Object]` rendering: SubStrategy params now display as `key=value` tokens
  - "Load & Run" button now triggers actual backtest execution (strategy: auto-backtest, aggregation: ad-hoc run)
- **History Explorer**: Replaced params modal trigger with hover tooltip, enhanced selected run highlighting with `bg-primary-900/40` + left accent border

### Files Modified
- `src/web/App.tsx` - Params button and modal integration
- `src/web/components/HistoryExplorer/RunParamsModal.tsx` - Complete rewrite
- `src/web/components/HistoryExplorer/HistoryExplorer.tsx` - Tooltip and highlighting updates
- `src/api/routes/backtest.ts` - New `aggregate/run` endpoint
- `src/web/api/client.ts` - New `runAdhocAggregation()` function

---

## [2026-02-24] FR Spike Aggregation Exploration & Bug Fix

### Summary
Completed comprehensive testing of 27 aggregation configurations to determine optimal deployment parameters for multi-asset funding rate spike trading. Findings: curated asset portfolios (Top 10: ADA, ATOM, DOT, ETC, HBAR, ICP, LINK, OP, XRP, INJ) achieve Sharpe 1.0+ while full universe loses 90%+. Optimal configuration is Top 10 assets with weighted_multi allocation and maxPos=5 (Sharpe 1.11, 22.1% max DD, 114.8% return).

### Fixed
- **weighted_multi NaN bug**: Fixed division by zero in `/workspace/src/core/aggregate-engine.ts` line 287 when signal weights sum to zero. Added fallback to equal-split allocation when `totalWeightSnapshot = 0`.

### Added
- **Exploration script**: `/workspace/scripts/explore-fr-aggregations.ts` - Systematic testing of all 27 configs across 6 asset selections, 4 allocation modes, and 2 timeframes
- **Analysis**: `/docs/changelogs/2026-02-24-140000-fr-aggregation-exploration.md` - Complete results table, key findings, deployment recommendations

### Key Insights
1. **Asset selection is everything**: Curated Top 10 (Sharpe 1.11) vs full universe (Sharpe -0.87). Meme coins destroy portfolios (-98% return).
2. **Optimal positions**: maxPos=3-5 is sweet spot. More diversification dilutes signal quality.
3. **weighted_multi best risk-adjusted**: Lowest DD (22.1%) among high-Sharpe configs.
4. **4h >> 1h**: 4h reduces noise and transaction costs. 1h generates 3x more trades.
5. **Funding income is structural alpha**: $1,200-1,400 over 2 years = 12-14% annual equivalent, independent of price direction.

### Recommended Deployment
- **Sharpe 1.11, DD 22.1%**: Top 10 weighted_multi maxPos=5 (best risk-adjusted)
- **Sharpe 1.12, DD 34.9%**: Top 10 single_strongest (highest return but higher DD)
- **Sharpe 1.02, DD 24.7%**: Top 10 top_n maxPos=3 (balanced middle ground)

See `/docs/changelogs/2026-02-24-140000-fr-aggregation-exploration.md` for full methodology and 27-config results table.

---

## [2026-02-22] Aggregation as a First-Class Entity (Complete Refactoring)

### Changed
- **Removed legacy hacks**: Deleted `strategies/signal-aggr.ts` and `strategies/fr-spike-aggr.ts` (temporary multi-asset scaffolding)
- **Replaced ad-hoc API**: Removed `POST /api/backtest/multi/run` and `POST /api/backtest/aggregate/run` endpoints (-316 lines from backtest.ts)
- **Multi-asset detection**: Changed from `symbol === 'MULTI'` check to detecting `perAssetResults` field for better semantics
- **Frontend refactoring**: Removed all multi-asset conditional branches, ASSET_PRESETS, and legacy hooks from StrategyConfig

### Added
- **Aggregation entity**: First-class persistent configuration for composing multiple strategy+symbol+timeframe combinations
- **6 new API endpoints**: Full CRUD + run at `/api/aggregations/` (GET all, POST create, GET by id, PUT update, DELETE, POST run)
- **Database migration**: `aggregation_configs` table + `aggregation_id` FK on `backtest_runs`
- **Backend CRUD layer**: 5 new async database functions in `src/data/db.ts` for aggregation persistence
- **Frontend store**: Zustand store (`src/web/stores/aggregationStore.ts`) for aggregation UI state
- **Frontend components**: AggregationsPanel + CreateAggregationModal for full aggregation workflow
- **Tab interface**: Added "Strategies | Aggregations" tab bar in StrategyConfig for switching modes
- **History UI**: AGG badge (purple) for aggregation runs, "Portfolio" label for multi-asset runs, run type filter

### Verified
- TypeScript: 0 errors (`npm run typecheck`)
- Tests: 303 passing (10 test files)
- No orphaned references to deleted strategy files
- Aggregation create/update/delete/run working end-to-end
- Historical aggregation runs correctly linked and displayed

### Context
The platform previously used two fake strategies to handle multi-asset portfolios. This refactoring establishes Aggregation as a proper saved entity with persistent DB storage, dedicated CRUD API, and frontend UI. Users can now create repeatable, auditable portfolio configurations instead of ad-hoc orchestrations. Aggregations are first-class citizens alongside individual strategy runs, visible in history with proper badges and filtering.

**Files Modified**: 14 files, ~600 lines added, ~400 lines removed (net +200)

See `/docs/changelogs/2026-02-22-133000-aggregation-first-class-entity.md` for full 9-phase breakdown.

---

## [2026-02-21] Aggregate Engine Bug Fixes

### Fixed
- **Missing Parameter Labels**: Added `label` fields to params in `fr-spike-aggr.ts` and `signal-aggr.ts` - UI was displaying blank labels because ParamInput renders param.label
- **String Date Handling**: Fixed `src/core/aggregate-engine.ts` to defensively convert string dates to numeric timestamps before passing to `getCandles()`

### Verified
- Multi-asset aggregation (2-asset and 5-asset configs) working correctly
- Allocation modes: `single_strongest` and `top_n` produce valid results
- Per-asset breakdowns, funding income tracking, and signal history all functioning properly

### Context
Signal aggregation framework bug fixes improving robustness across parameter display and date handling. All fixes are backward-compatible and non-breaking. End-to-end testing confirms correct behavior across different allocation modes and asset counts.

**Files**: `strategies/fr-spike-aggr.ts`, `strategies/signal-aggr.ts`, `src/core/aggregate-engine.ts`

See `/docs/changelogs/2026-02-21-153200-aggregate-engine-fixes.md` for detailed analysis.

---

## [2026-02-16] Filesystem Result Storage for All Backtests

### Added
- **Result Storage Module** (`src/core/result-storage.ts`): Automatic persistent storage of all backtest results
  - `saveResultToFile()` - Saves individual backtest results as JSON
  - `saveScanResultsToFile()` - Saves scanner summary with all market results
  - Path format: `results/{strategy-name}/{YYYY-MM-DD-HHmmss}-{symbol}.json`
  - Filesystem sanitization for safe file naming

### Changed
- **`src/core/engine.ts`**: Auto-saves every backtest result to filesystem after completion
- **`src/core/pairs-engine.ts`**: Auto-saves pairs backtest results to filesystem
- **`src/api/routes/scan.ts`**: Collects and saves scanner results summary file

### Context
Every backtest now persists to filesystem independently of database storage. This ensures reproducibility, provides an audit trail, and allows version control of results. Filesystem saves run independently and never crash backtests even if file I/O fails.

See `/docs/changelogs/2026-02-16-180500-filesystem-result-storage.md` for full details.

---

## [2026-02-16] PM Strategy Final Optimization

### Changed
- **pm-correlation-pairs.ts**: Updated all default parameters to cross-validated optimal values
  - lookbackPeriod: 60 → 70
  - entryZScore: 1.5 → 2.0 (more selective entry signals)
  - exitZScore: 0.5 → 0.75 (earlier profit-taking)
  - positionSizePct: 40 → 60 (larger positions on high-conviction)
  - minCorrelation: 0.5 → 0.9 (only trade highly correlated pairs)
  - minSpreadStd: 0.05 → 0.066 (require meaningful spread volatility)
  - cooldownBars: 10 → 16 (longer recovery between trades)
  - minProfitBps: 350 → 460 (higher profit threshold)

### Context
Final optimization pass for prediction market strategies based on extensive cross-validation. pm-correlation-pairs is confirmed as the superior production candidate with Sharpe ratios of 3.2+ and drawdowns of only 0.1-0.5%, compared to pm-information-edge (Sharpe 1.0-1.3, drawdowns 9-10%). The higher entry threshold and strict minCorrelation requirement ensure high-conviction trades only on genuinely correlated pairs. pm-information-edge parameters were already optimized in the previous session and remain unchanged (momentumPeriod=20, entryThreshold=0.08, exitThreshold=0.04, minPriceRange=0.15 trend filter).

**Files**: `strategies/pm-correlation-pairs.ts`

See `/docs/changelogs/2026-02-16-123000-pm-strategy-final-optimization.md` for full details.

---

## [2026-02-11] Pairs Backtest Error Logging

### Changed
- Enhanced error handling in `/api/backtest/pairs/run` route to log errors with full stack traces
- Now uses `fastify.log.error()` pattern matching established in `/api/backtest/history` route

### Fixed
- Improved error visibility for debugging 500 errors in pairs backtesting

**Files**: `src/api/routes/backtest.ts`

See `/docs/changelogs/2026-02-11-120000-pairs-backtest-error-logging.md` for details.

---

## [2026-02-04] CCI Momentum Breakout Strategy - Walk-Forward Validated

### Added
- `strategies/cci-momentum-breakout.ts` - CCI-based momentum breakout strategy with dual-threshold entries
  - Entry modes: CCI breakout above +120/-120 thresholds and zero-line crossovers (configurable toggle)
  - Filters: SMA(30) trend direction validation, ADX(15) >= 30 trend strength confirmation
  - Exit: ATR(15)-based trailing stop at 2.5x multiplier, maximum hold of 40 bars
  - 11 configurable parameters for fine-tuning across different assets/timeframes
  - Optimized defaults from walk-forward testing: cciPeriod=30, cciBreakoutLevel=120, smaPeriod=30

### Removed
- `strategies/stochastic-momentum-trend.ts` - Discarded after failing multi-asset robustness testing

### Test Results & Validation
**CCI Momentum Breakout** (2022-2024, 4h timeframe, 70/30 walk-forward split):
- ETH/USDT: OOS Sharpe 0.62, +71.7% return (ROBUST)
- XRP/USDT: OOS Sharpe 0.81, +176.4% return (ROBUST - exceptional OOS performance)
- BTC/USDT: OOS Sharpe 0.23, +15.2% return (positive, below threshold)
- DOGE/USDT: OOS Sharpe 0.19, +14.9% return (positive, below threshold)
- SOL/USDT: OOS Sharpe -0.08, -12.9% return (FAILED)

**Conclusion**: Multi-asset robust on 2/5 assets (ETH, XRP), positive on 2/5, failed on 1/5. Excellent OOS Sharpe ratio (0.62-0.81) on alt-assets validates dual-threshold momentum approach.

**Stochastic Momentum Trend** (DISCARDED):
- Only passed SOL/USDT (OOS Sharpe 0.69), failed on BTC (-0.48), ETH (0.12), XRP (-0.38), DOGE (-0.17)
- Severe overfitting on 4/5 assets, not multi-asset robust - removed from codebase

### Context
Implemented rigorous walk-forward testing (70/30 IS/OOS split) to validate strategy robustness and prevent overfitting. CCI strategy demonstrates strong generalization on high-volatility alt-assets (ETH, XRP) with exceptional OOS Sharpe ratios, while Stochastic failed multi-asset validation and was discarded. Optimized defaults based on ETH/USDT best-in-sample parameters balance OOS performance with cross-asset generalization.

See `/docs/changelogs/2026-02-04-081500-cci-momentum-breakout-strategy.md` for detailed test results and analysis.

---

## [2026-02-03] Quant Agent System - Autonomous Trading Strategy Discovery

### Added
- **Quant Agent Lab**: Complete autonomous strategy discovery system with parallel agent execution
- **Validation Framework**: Walk-forward testing (70/30 split) with OOS degradation detection
- **Multi-Asset Validation**: Robustness testing across 5+ crypto assets (BTC, ETH, SOL, XRP, ADA)
- **Strategy Generation**: Code generator creating executable TypeScript strategies from hypotheses
- **Robustness Scoring**: Multi-weighted formula (30% Sharpe, 20% OOS degrade, 20% multi-asset, 15% return, 15% drawdown)
- **5 Strategy Templates**: Trend-following, mean-reversion, momentum, breakout, volatility
- **Indicator Registry**: 15+ technical indicators mapped to trading styles
- **REST API**: 7 endpoints with SSE progress streaming for real-time monitoring
- **React Dashboard**: Session configuration, real-time progress, strategy results with promotion

### Changed
- `src/data/db.ts` - Added quant_sessions and quant_strategies tables
- `src/api/server.ts` - Registered quant routes
- `src/web/App.tsx` - Added Quant Lab route and navigation

### Core Modules
- `src/core/walk-forward.ts` - Walk-forward testing with OOS degradation
- `src/core/multi-asset-validation.ts` - Cross-asset robustness validation
- `src/quant/indicators.ts` - Indicator registry
- `src/quant/generator.ts` - Strategy code generator
- `src/quant/scoring.ts` - Robustness scoring formula
- `src/quant/session.ts` - Session management
- `src/quant/executor.ts` - Parallel agent execution

### Context
Addresses critical gap in strategy development: discovering robust, generalizable strategies. The system automates hypothesis generation, rigorous validation, robustness scoring, and parallel discovery with real-time feedback. All generated strategies undergo walk-forward and multi-asset validation to prevent curve-fitting.

See `/docs/changelogs/2026-02-03-040000-quant-agent-system.md` for full details.

---

## [2026-01-25] Optimizer Memory Fix - Critical OOM Issue Resolution

### Fixed
- **Provider instance leak**: `getProvider()` now uses singleton pattern to reuse CCXT client instances instead of creating new ones on every call
- **Combination generation OOM**: Replaced full generation with indexed sampling - calculates total combinations first, then samples by index without materializing all 144M combinations
- **Unnecessary API calls**: Added `skipFeeFetch` option to EngineConfig; optimizer uses it by default to skip redundant exchange fee fetches

### Changed
- `src/data/providers/index.ts` - Added provider caching system
- `src/core/engine.ts` - Added `skipFeeFetch` configuration option
- `src/core/optimizer.ts` - Implemented memory-efficient combination sampling

### Impact
- Memory consumption reduced by 85%+ in typical scenarios
- Can now handle 100+ parameter combinations with 365+ days of data without crashing
- Previous: 4GB+ OOM crash → Now: ~675MB peak
- 50 combinations, 30 days: OOM crash → ~450MB peak (stable completion)

### Verification
- TypeScript compilation: ✅ Passed
- ESLint: ✅ No errors
- Manual testing: ✅ Completed successfully with 100 combinations, 365 days

See `/docs/changelogs/2026-01-25-000000-optimizer-memory-fix.md` for full details.

---

## [2026-01-24] Market Leader Divergence Strategy + Parameter Optimization Engine

### Added
- `strategies/marketLeaderDivergence.ts` - Trend-following divergence strategy with EMA crossovers, volume spike detection, and mean reversion
- `src/core/optimizer.ts` - Grid search parameter optimization engine with parallel execution
- `src/api/routes/optimize.ts` - REST API endpoints for optimization (POST, GET, DELETE)
- `src/web/hooks/useOptimization.ts` - React hooks for optimization UI integration
- CLI scripts: `run-optimization.ts`, `run-optimization-fast.ts`, `run-optimization-minimal.ts`, `check-db.ts`
- Database schema: `optimized_params` table with CRUD operations

### Changed
- `src/data/db.ts` - Added optimization result storage and retrieval functions
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Added optimization UI with progress tracking
- `src/web/stores/backtestStore.ts` - Added `useOptimizationStore` for state management

### Key Features
- **Optimization**: Grid search algorithm, parallel backtest execution, progress tracking
- **Metric Selection**: Optimize for Sharpe Ratio, Total Return %, Profit Factor, or Win Rate
- **Result Persistence**: All optimizations saved to database with full configuration
- **Strategy**: Trend detection (EMA), volume analysis, divergence entry, configurable stops
- **Performance**: ~30-45 minutes for 2,000 combinations with batch processing

### Known Limitations
- Network API timeouts on extended optimizations (>1000 combinations) - use CLI scripts instead
- High memory usage with very large parameter grids - keep ranges conservative
- Optimization metric reliability varies (Sharpe Ratio less stable with low trade counts)

### Files Modified
- `src/data/db.ts` - Database schema and operations
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - UI integration
- `src/web/stores/backtestStore.ts` - State management
- `src/api/server.ts` - Route registration (assumed)

See `/chat_logs/2026-01-24-141500-market-leader-divergence-and-optimizer.md` for comprehensive documentation.

---

## [2026-01-24] Add GPT LONG ULTIMATE Strategy

### Added
- `strategies/gptLongUltimate.ts` - Multi-signal trend-following strategy with fractal analysis

### Key Features
- SMA(60) and EMA(120) trend filters
- BB% RSI momentum confirmation (Bollinger Bands applied to RSI)
- Klinger Volume Oscillator (KVO) with configurable lengths
- Williams Fractals for price structure identification
- Fractal trend counting for confirmation (3+ consecutive = confirmed trend)
- Fractal Breakout and CHoCH (Change of Character) entry types
- Dynamic stop losses at 3rd most recent opposite fractal
- 14 configurable parameters with sensible defaults
- Symmetric long/short logic (shorts can be disabled)

### Context
Pine Script-derived strategy combining multiple indicators with fractal-based structure analysis. Provides institutional-grade technical analysis for identifying high-probability trade setups. The symmetric design ensures consistency between long and short trades.

See `/chat_logs/2026-01-24-150000-add-gpt-long-ultimate-strategy.md` for full details.

---

## [2026-01-24] Strengthen Orchestrator Delegation Rules

### Changed
- Rule 1 (ALWAYS USE ORCHESTRATOR) now enforces stricter delegation
- Removed "trivial single-line fixes" exception to prevent scope creep
- Added explicit requirement: orchestrator MUST delegate ALL code work to specialized agents
- Orchestrator cannot make code changes itself or return instructions (must delegate instead)

### Added
- New "STRICT ENFORCEMENT" section in Rule 1 clarifying delegation requirements

### Files Modified
- `CLAUDE.md` - Updated Rule 1 with stricter language and STRICT ENFORCEMENT section

### Context
Previous wording allowed ambiguity about what constituted "exceptions" for the orchestrator. The stricter language ensures:
- Clean separation between orchestrator (coordinator) and developers (fe-dev, be-dev, etc.)
- Proper tracking of which agent performs code work
- Prevention of orchestrator scope creep
- Clear audit trail for all code changes

See `/chat_logs/2026-01-24-140000-strengthen-orchestrator-rules.md` for full details.

---

## [2026-01-24] Improve Trade Action Labels for Clarity

### Changed
- Trade action labels now explicitly show position type (Long/Short)
- Updated `getTradeActionLabel()` to show: 'Open Long ↑', 'Close Long ↑', 'Open Short ↓', 'Close Short ↓'

### Files Modified
- `src/web/types.ts` - Enhanced label generation with Long/Short descriptors

### Context
Previous labels relied on arrow direction alone to indicate position type. Adding explicit Long/Short text improves UI clarity and reduces confusion when reviewing trade history.

---

## [2025-01-24] Agent Usage Logging System

### Added
- `/chat_logs/agent-usage.log` - Central log for tracking agent invocations
- Logging instructions added to all agent configs
- Token cost reference in orchestrator (opus ~10x, sonnet ~3x, haiku 1x)

### Files Modified
- `CLAUDE.md` - Added agent usage logging instructions
- `.claude/agents/*.md` - All agents now have logging reminder
- `chat_logs/agent-usage.log` - New file for usage tracking

### Context
Helps track token consumption patterns across agents. Each agent logs when completing tasks, allowing analysis of which agents consume most resources.

---

## [2025-01-24] Trading System Refactoring - Open/Close Model with Short Support

### Changed
- Trade model refactored from round-trip to event-based (open/close separate records)
- Portfolio now tracks long and short positions separately
- Metrics calculated from CLOSE trades only (where PnL is realized)
- Strategy context now uses `openLong/closeLong/openShort/closeShort` instead of `buy/sell`

### Added
- `TradeAction` enum: `OPEN_LONG`, `CLOSE_LONG`, `OPEN_SHORT`, `CLOSE_SHORT`
- Short selling support in strategies
- Balance tracking after each trade (`balanceAfter` field)
- Partial position closes supported
- `trades_v2` database table for new trade format
- New agents: `fullstack-dev`, `runner`

### Files Modified
- `src/core/types.ts` - New TradeAction, updated Trade and Position schemas
- `src/core/portfolio.ts` - New position management with open/close methods
- `src/core/broker.ts` - Updated order routing for TradeAction
- `src/core/engine.ts` - New strategy context with openLong/closeLong/openShort/closeShort
- `src/strategy/base.ts` - Updated StrategyContext interface
- `src/data/db.ts` - Added trades_v2 table, backward compatibility for legacy trades
- `src/analysis/metrics.ts` - Filter CLOSE trades for PnL calculations
- `src/web/types.ts` - Frontend type updates
- `src/web/App.tsx` - Updated trades table with action badges and balance column
- `src/web/components/Chart/Chart.tsx` - Updated trade markers for new model
- `src/cli/backtest.ts` - Updated CLI output for new trade format
- `strategies/sma-crossover.ts` - Updated to use new API with optional shorts

### Context
The old model showed trades as "BUY" with hidden sells. The new model explicitly shows every open and close event, making it clear what's happening. This enables:
- Short selling strategies
- Partial position closes
- Running balance visibility
- Clearer PnL attribution (only on closes)

---

## [2025-01-24] Agent System Setup

### Added
- `orchestrator` agent - Coordinates multi-step tasks
- `fe-dev` agent - React/UI development
- `be-dev` agent - Backend/API/engine development
- `fullstack-dev` agent - Platform/infrastructure (data, caching, cross-cutting)
- `qa` agent - Testing and quality assurance
- `builder` agent - Build, deploy, dependencies
- `runner` agent - Process management, logs (haiku model)
- `docs-writer` agent - Documentation and changelog
- `ui-tester` agent - Visual UI testing with Playwright

### Files Modified
- `.claude/agents/*.md` - All agent configurations
- `CLAUDE.md` - Updated agent system documentation

### Context
Specialized agents allow for better task delegation and consistent patterns. The orchestrator should be used first for any non-trivial task.

---

## [2025-01-24] Initial Project Architecture

### Added
- Project structure with TypeScript full-stack
- Backtesting engine core (`src/core/`)
- Data providers with CCXT (`src/data/`)
- REST API with Fastify (`src/api/`)
- React frontend with TradingView charts (`src/web/`)
- Strategy plugin system (`strategies/`)
- SQLite database for caching and results

### Context
Initial project setup following modular architecture. See `/docs/ARCHITECTURE.md` for full details.

---
