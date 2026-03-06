# Backtesting System - Claude Code Instructions

---
## ⚠️ MANDATORY RULES (READ FIRST - APPLIES TO EVERY PROMPT)

### 🚨 RULE 1: DELEGATE CODE CHANGES TO SPECIALIZED AGENTS

**For ANY task involving code changes, delegate to specialized agents (be-dev, fe-dev, fullstack-dev).**

```
For code changes: Task tool → subagent_type: "be-dev" / "fe-dev" / "fullstack-dev"
For multi-step tasks: Break down yourself, then launch agents in parallel
For exploration: Task tool → subagent_type: "Explore"
For committing: Task tool → subagent_type: "commit"
```

**The MAIN Claude Code instance acts as orchestrator:**
- Break down complex tasks into subtasks
- Launch specialized agents directly (be-dev, fe-dev, etc.)
- Parallelize independent work (launch multiple agents in one message)
- Ensure proper logging and changelogs

**Agent selection guide:**
- `be-dev`: Backend, engine, strategies, API, CLI, metrics
- `fe-dev`: React components, charts, dashboard, forms
- `fullstack-dev`: Data fetching, database, cross-cutting concerns
- `docs-writer`: Changelogs and documentation

**NOTE:** The `orchestrator` agent type is read-only (can analyze and plan but cannot
write code or launch sub-agents). Use it only for complex planning/analysis tasks.

**Only exceptions (no delegation needed):**
- Simple single-line fixes
- Reading/exploring code (use Explore agent)
- Committing (use commit agent)

### 📝 RULE 2: Log Every Agent Call

After invoking ANY agent, IMMEDIATELY append to `/chat_logs/agent-usage.log`:
```
[YYYY-MM-DD HH:MM] agent-name (model) - brief task description
```

### 📄 RULE 3: Changelog for Code Changes

After ANY code modification, **ALWAYS call `docs-writer` agent** to create changelog.
- DO NOT create changelogs manually
- docs-writer creates: `/docs/changelogs/YYYY-MM-DD-HHMMSS-brief-title.md`
- **ALWAYS use local timezone** for datetime in filenames
- This ensures consistent logging and formatting

### 📁 RULE 5: Documentation Location

**ALL documentation files MUST be saved in `/docs/` folder:**
- Changelogs → `/docs/changelogs/`
- Architecture docs → `/docs/`
- Session notes → `/docs/sessions/`
- **NEVER create .md files in project root or random locations**
- **ALWAYS include datetime in local timezone in filename**: `YYYY-MM-DD-HHMMSS-title.md`

### ✅ RULE 4: Session Completion Checklist

Before completing ANY session, verify:
- [ ] Code changes went through specialized agents (be-dev, fe-dev, etc.)
- [ ] All agent calls logged to `agent-usage.log`
- [ ] Changelog created for code changes
- [ ] Changes committed (if requested)

### 💾 RULE 8: Always Save Backtest Results to Database

**When exploring strategies or running backtests (aggregations, single-asset, or any variant), ALWAYS save results to the database via `saveBacktestRun()`.**
- CLI scripts must call `saveBacktestRun(result)` after each successful run
- This ensures all results appear in the dashboard history and can be reviewed later
- NEVER run backtests without persisting results — the whole point is to track and compare runs
- For aggregation runs, pass the aggregation config ID: `saveBacktestRun(result, aggregationId)`

### 📊 RULE 9: Document All Research Results

**Every strategy research activity MUST produce a summary in `/docs/strategies/`.**

This includes:
- **Grid search results**: Save summary table (symbol, best params, Sharpe, return, DD, trades) to a dated doc
- **Walk-forward validation**: Save per-symbol train/test Sharpe, degradation %, pass/fail verdict
- **Backtest explorations**: Any multi-symbol scan, parameter sweep, or strategy comparison
- **Negative results**: Document what was tested and WHY it failed — this prevents re-investigating dead ends

**Filename format**: `/docs/strategies/YYYY-MM-DD-HHMMSS-descriptive-title.md`

**Before starting ANY research task:**
1. Read `/docs/strategies/` index to understand what has already been researched
2. Check the comprehensive assessment doc for strategy rankings and verdicts
3. Do NOT re-investigate strategies/directions already marked as "FAILED" or "Do Not Pursue" unless the user explicitly requests it
4. Reference prior findings when reporting new results

**The goal**: Build a cumulative knowledge base so we never waste time re-testing dead ends or losing context on what works and what doesn't.

### 🖼️ RULE 7: No Screenshots or Temp Files in Repo

**NEVER store screenshots (.png, .jpg, .jpeg, .gif, .bmp), temporary test scripts, or scratch files in the project root or anywhere in the repo.**
- Screenshots from Playwright MCP or UI testing go to `.playwright-mcp/` (gitignored)
- Temporary test scripts (test-*.mjs, test-*.ts in root) must be deleted after use
- Scratch files (p.txt, notes, etc.) must not be committed
- If you need to save an image for documentation, put it in `/docs/images/` and reference it from a markdown file

**DO NOT skip these rules. They are REQUIRED.**

---

> **IMPORTANT**: Always read `/docs/ARCHITECTURE.md` and `/docs/PROJECT_GOALS.md` before starting any task.

## Project Overview

A modular crypto backtesting platform for testing trading strategies across multiple exchanges. Built with TypeScript (full stack), designed for flexibility and future live trading integration.

## Quick Reference

- **Stack**: TypeScript, Fastify, React, SQLite, CCXT, TradingView Lightweight Charts
- **Entry Points**: `src/api/server.ts` (backend), `src/web/main.tsx` (frontend)
- **Strategies**: Plugin files in `/strategies/` folder
- **Database**: SQLite at `/data/backtesting.db`

## Agent System

**IMPORTANT**: The main Claude Code instance acts as orchestrator. For code changes, delegate directly to specialized agents (be-dev, fe-dev, fullstack-dev). The `orchestrator` agent type is read-only and cannot write code or launch sub-agents.

```
For code changes: launch be-dev, fe-dev, or fullstack-dev directly
For complex planning: use orchestrator agent (analysis only)
For exploration: use Explore agent
Parallelize: launch multiple agents in one message when work is independent
```

### Available Agents

**Development:**
- `orchestrator` - **USE FIRST** - Coordinates multi-step tasks, delegates to specialists
- `fe-dev` - React/UI development (charts, dashboard, forms, styling)
- `be-dev` - Backend/API/engine (trading logic, strategies, risk, metrics)
- `fullstack-dev` - Platform/infrastructure (data fetching, caching, database, cross-cutting concerns)

**Quality & Operations:**
- `qa` - Testing and quality assurance
- `builder` - Build, deploy, dependency management
- `runner` - Start/stop servers, check logs, monitor processes (lightweight, haiku model)
- `docs-writer` - Documentation updates
- `ui-tester` - Visual UI testing with Playwright

**Strategy Research:**
- `quant-lead` - Strategy research lead (opus). Researches real strategies via web search
  and Claude's quant knowledge. Creates detailed specs in docs/strategies/ that may
  require system improvements. NOT limited to current system capabilities.
- `quant` - Strategy implementation coordinator (sonnet). Reads strategy specs, delegates
  code writing to be-dev, then runs validation, grid search, backtesting, and walk-forward
  via CLI tools. Grid search results automatically appear in the optimizer modal.

**Architecture & Research:**
- `architect` - Deep system design, asks clarifying questions (opus model - use for complex problems)
- `Explore` - Codebase exploration and search
- `Plan` - Implementation planning and architecture

### Agent Usage Logging

**After invoking any agent, log it to `/chat_logs/agent-usage.log`:**

```
[YYYY-MM-DD HH:MM] agent-name (model) - brief task description
```

This tracks token consumption patterns:
- `opus` = high tokens (~10x haiku)
- `sonnet` = medium tokens (~3x haiku)
- `haiku` = low tokens (baseline)

Example:
```
[2025-01-24 14:30] be-dev (sonnet) - Implement short selling support
[2025-01-24 14:45] docs-writer (haiku) - Update changelog
```

### Strategy Discovery Workflow

When user requests strategy research:
1. Orchestrator delegates to `quant-lead` agent
2. quant-lead reads docs/QUANT_KNOWLEDGE.md, researches via web search
3. quant-lead creates N strategy specs in docs/strategies/
4. User reviews specs and system gaps
5. If gaps exist: use prompts to improve backtesting system first
6. Spawn `quant` agents to implement strategies from specs
7. Each quant agent workflow:
   a. Read strategy spec
   b. Delegate code writing to `be-dev`
   c. Validate → quick backtest → iterate with be-dev if needed (max 3 tries)
   d. Grid search via CLI → results saved to DB → visible in optimizer modal
   e. Update strategy defaults with best params (via be-dev)
   f. Walk-forward test for robustness
   g. Return results
8. User opens dashboard → optimized params are the defaults
9. User opens optimizer modal → sees grid search history

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

### 🔴 RULE 6: Critical Test Coverage for Financial Logic

**ALL code that affects backtesting calculations, position sizing, capital allocation, PnL, metrics, equity curves, or trade execution MUST have 100% unit test coverage with ALL corner cases.**

This includes but is not limited to:
- **Portfolio/position management**: open/close long/short, PnL calculation, fee handling, funding payments
- **Capital allocation**: position sizing, capital splitting across multi-asset, weight-based allocation
- **Signal generation**: signal adapters, weight calculators, signal selection/ranking
- **Metrics calculation**: Sharpe, sortino, max drawdown, win rate, profit factor, expectancy
- **Equity curves**: per-asset and portfolio-level equity tracking
- **Engine execution**: trade execution order, exit-before-entry, same-bar behavior

**Why**: False-positive backtest results caused by calculation bugs lead to losing real money in production. Every edge case must be tested:
- Zero trades, single trade, many trades
- Mixed long/short positions across assets
- Simultaneous signals on the same bar
- Exit + re-entry on same bar
- Insufficient capital / partial fills
- Fee and slippage edge cases
- Funding rate payments during positions

**Test-first (TDD) approach required for bug fixes**: Write failing tests first, then fix code, then verify green.

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

# Quant Agent CLI Tools
npm run quant:validate -- strategies/my-strategy.ts    # Validate strategy file
npm run quant:backtest -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01
npm run quant:walk-forward -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-12-01
npm run quant:optimize -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01
npm run quant:score -- --walk-forward-file=results.json
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

## Changelog (IMPORTANT)

**After ANY significant code change, create a changelog file:**

1. Call `docs-writer` agent with summary of changes
2. Or manually create `/docs/changelogs/YYYY-MM-DD-HHMMSS-brief-title.md`

Example: `docs/changelogs/2025-01-24-143052-add-short-selling.md`

**Filename format:** `YYYY-MM-DD-HHMMSS-brief-title.md` (use LOCAL timezone)

Significant changes include:
- New features or refactoring
- Bug fixes
- API or type changes
- New files or modules

Each change gets its own file for easy tracking and review.

## Chat Logs

After each session, update `/chat_logs/` with:
- Date and summary of work done
- Decisions made and rationale
- Open questions or blockers
- Next steps

## Production Server

- **Host**: `5.223.56.226` (Singapore)
- **SSH**: `ssh claude@5.223.56.226` (key already authorized)
- **Project dir**: `/root/backtesting/` (docker-compose lives here)
- **Docker containers**: `backtesting-api-1` (app), `backtesting-nginx-1`, `backtesting-postgres-1`
- **DB**: `postgresql://backtesting:l6TvgOW6XNqSd1n3Uq5eFJiZ@postgres:5432/backtesting`
- **Compose**: `/root/backtesting/docker-compose.prod.yml` with `.env.prod`
- **Data volume**: `/var/lib/docker/volumes/backtesting_apidata/_data` → `/app/data` in container

### Deployment

**To deploy: push to GitHub and wait for the GitHub Action to complete.** You are authorized to push.

```bash
git push origin main   # Push changes
# Then wait for GitHub Action to finish (auto-deploys to prod)
```

Do NOT manually rebuild Docker or run git pull on the server. The GitHub Action handles everything.

### Running scripts on prod

```bash
# Execute inside the API container:
ssh claude@5.223.56.226 "docker exec backtesting-api-1 npx tsx scripts/SCRIPT_NAME.ts --args"

# Copy files into the container:
scp file.json claude@5.223.56.226:/tmp/
ssh claude@5.223.56.226 "docker cp /tmp/file.json backtesting-api-1:/app/data/"
```

## ⚠️ Known Issues & Gotchas

### Docker Development Issue (CRITICAL)
**When Claude runs inside Docker but user views UI on host machine:**
- Dev server running inside Docker may not properly expose changes to host
- User may see stale/cached content or errors even when API works inside container
- **WORKAROUND**: Run `npm run dev` on **host machine**, not inside Docker container
- This needs proper fix in docker-compose networking/port forwarding
- **TODO**: Investigate and fix Docker-to-host communication for dev server

### Playwright in Docker
- Requires `cap_add: SYS_ADMIN` and `security_opt: seccomp=unconfined` in docker-compose.yml
- Chrome symlink needed at `/opt/google/chrome/chrome`
- Pre-install Playwright browsers in Dockerfile for faster startup
