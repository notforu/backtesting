# Changelog

All notable changes to this project are documented here. Newest entries first.

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
