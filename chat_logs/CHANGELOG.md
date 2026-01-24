# Changelog

All notable changes to this project are documented here. Newest entries first.

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
