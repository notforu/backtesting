# Backtesting System - Claude Code Instructions

---
## ⚠️ MANDATORY RULES (READ FIRST - APPLIES TO EVERY PROMPT)

### 🚨 RULE 1: ALWAYS USE ORCHESTRATOR

**For ANY task involving code changes, IMMEDIATELY delegate to `orchestrator` agent.**

```
DO NOT call fe-dev, be-dev, or other agents directly.
DO NOT make code changes yourself.
ALWAYS: Task tool → subagent_type: "orchestrator"
```

The orchestrator will:
- Break down the task
- **MUST delegate to specialized agents** (fe-dev, be-dev, etc.) - orchestrator does NOT write code itself
- Ensure proper logging
- Call docs-writer for changelogs

**STRICT ENFORCEMENT:**
- Orchestrator must ALWAYS delegate code changes to fe-dev/be-dev/fullstack-dev
- Orchestrator must NOT just analyze and return instructions
- NO exceptions for "trivial" changes - all code changes go through proper delegation

**Only exceptions (non-code tasks):**
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
- [ ] All tasks went through orchestrator
- [ ] All agent calls logged to `agent-usage.log`
- [ ] Changelog created for code changes
- [ ] Changes committed (if requested)

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

**IMPORTANT**: All non-trivial tasks MUST go through the orchestrator first. The orchestrator will break down work and delegate to specialized agents.

```
Use orchestrator agent for any task that:
- Spans multiple files or components
- Requires coordination between FE/BE
- Involves feature implementation
- Needs architectural decisions
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
