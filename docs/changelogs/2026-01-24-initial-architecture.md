# 2026-01-24 - Initial Architecture Planning

## Summary

Established the foundational architecture for the crypto backtesting system through extensive Q&A with the user.

## Decisions Made

### Tech Stack
- **Full TypeScript** - Single language for frontend and backend
- **Fastify** - API server (faster than Express)
- **React + Vite** - Frontend with TradingView Lightweight Charts
- **SQLite** - Database (better-sqlite3)
- **CCXT** - Multi-exchange support

### Architecture
- **Plugin-based strategies** - Strategies as `.ts` files in `/strategies/`
- **Multi-asset, multi-timeframe** - Strategies can access multiple symbols and resolutions
- **Market orders only** - Simplified execution model for initial version
- **Git-versioned strategies** - Backtest runs reference commit hash

### Trading Approach
- **Styles**: Trend following + Mean reversion
- **Risk**: Configurable per strategy (conservative default: 1-2% per trade)
- **Go-live criteria**: Positive backtest + Sharpe > 1.0 + walk-forward validation

### Development Workflow
- **Direct to main** - No feature branches
- **Quality gates**: Tests + TypeScript + ESLint must pass
- **Agent coordination**: Tasks + docs for communication

### Implementation Priority
- **Full vertical slice first** - Complete end-to-end flow before expanding

## Files Created

### Documentation
- `CLAUDE.md` - System prompt for Claude Code
- `docs/ARCHITECTURE.md` - Technical architecture
- `docs/PROJECT_GOALS.md` - Project goals and success criteria
- `docs/WORKFLOWS.md` - Development workflows

### Agent Definitions
- `.claude/agents/orchestrator.md` - Task coordination (user created initial version)
- `.claude/agents/fe-dev.md` - Frontend development
- `.claude/agents/be-dev.md` - Backend development
- `.claude/agents/qa.md` - Testing and QA
- `.claude/agents/builder.md` - Build and DevOps

## User Preferences Captured

- Trading experience: Exploring both trend following and mean reversion
- Risk tolerance: Wants configurable per-strategy risk
- Data scale: 1-2 years of data, few tokens initially
- Correlation analysis: Flexible, will expand as needed
- Multi-backtest: Start with one, keep flexible for future
- Notifications: Progress notifications for long-running backtests

## Open Questions

None currently - ready to start implementation.

## Next Steps

1. Set up project dependencies (package.json)
2. Implement database schema and migrations
3. Create basic data provider (Binance via CCXT)
4. Implement core backtesting engine
5. Build minimal UI (chart + run button)
6. Create first example strategy (SMA crossover)
