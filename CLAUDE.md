# Backtesting System - Claude Code Instructions

> **IMPORTANT**: Always read `/docs/ARCHITECTURE.md` and `/docs/PROJECT_GOALS.md` before starting any task.

## Project Overview

A modular crypto backtesting platform for testing trading strategies across multiple exchanges. Built with TypeScript (full stack), designed for flexibility and future live trading integration.

## Quick Reference

- **Stack**: TypeScript, Fastify, React, SQLite, CCXT, TradingView Lightweight Charts
- **Entry Points**: `src/api/server.ts` (backend), `src/web/main.tsx` (frontend)
- **Strategies**: Plugin files in `/strategies/` folder
- **Database**: SQLite at `/data/backtesting.db`

## Agent System

This project uses specialized agents. For complex tasks, always use the orchestrator:

```
/orchestrator <task description>
```

Available agents:
- `orchestrator` - Coordinates multi-step tasks, delegates to specialists
- `fe-dev` - React/UI development
- `be-dev` - Backend/API/engine development
- `qa` - Testing and quality assurance
- `builder` - Build, deploy, dependency management

## Workflows

### Before Any Task
1. Check `/docs/` for relevant documentation
2. Check `TaskList` for existing related tasks
3. For multi-file changes, use orchestrator agent

### Code Changes
1. Read the file(s) first - never modify without understanding
2. Run `npm run typecheck` after changes
3. Run `npm run lint` to check style
4. Run `npm test` if tests exist for modified code
5. Update docs if behavior changes

### Creating/Modifying Strategies
1. Follow the interface in `src/strategy/base.ts`
2. Add to `/strategies/` folder
3. Include parameter schema for UI generation
4. Add example usage in strategy file comments

### Quality Gates (Required)
- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] Tests pass (when applicable)
- [ ] Docs updated (if behavior changed)

## Key Directories

```
src/
├── core/       # Backtesting engine, portfolio, orders
├── data/       # Data providers, caching, database
├── strategy/   # Strategy loader and base interface
├── risk/       # Risk management module
├── analysis/   # Metrics calculation
├── api/        # REST API routes
└── web/        # React frontend

strategies/     # User strategy plugins (*.ts files)
docs/           # Documentation (read before tasks!)
chat_logs/      # Session summaries
```

## Common Commands

```bash
npm run dev          # Start development (API + frontend)
npm run build        # Production build
npm run typecheck    # Check TypeScript
npm run lint         # Check code style
npm run test         # Run tests
npm run backtest     # CLI backtest runner
```

## Style Guidelines

- Use Zod for runtime validation
- Prefer composition over inheritance for strategies
- Keep strategies stateless when possible
- Use descriptive metric names (not abbreviations)
- Error messages should suggest solutions

## Risk Module Rules

The risk module is critical for capital preservation:
- Never bypass risk checks in backtest mode
- All risk rules must be configurable
- Kill switch must be tested with each strategy
- Log all risk-related decisions

## Chat Logs

After each session, update `/chat_logs/` with:
- Date and summary of work done
- Decisions made and rationale
- Open questions or blockers
- Next steps
