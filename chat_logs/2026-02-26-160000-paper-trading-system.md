# Paper Trading System Implementation

**Date**: 2026-02-26 16:00
**Author**: claude-code (orchestrator)

## Summary

Implemented a comprehensive paper trading system that allows users to run live multi-asset strategies in parallel with backtesting. The system includes a tick-based execution engine mirroring the backtest architecture, real-time Bybit data ingestion, Telegram notifications, database persistence via PostgreSQL, and a React UI with live equity charting. 115 new tests ensure robustness of capital management, funding rate handling, and order execution logic.

## Added

### Backend - Paper Trading Engine
- `src/paper-trading/types.ts` — Core TypeScript types: PaperSession, PaperPosition, PaperTrade, PaperEquitySnapshot, PaperTradingEvent (discriminated union), TickResult
- `src/paper-trading/db.ts` — 13 CRUD functions for paper_sessions, paper_positions, paper_trades, paper_equity_snapshots tables
- `src/paper-trading/live-data.ts` — BybitProvider wrapper for live 1h candles, funding rates, and spot prices with automatic retry logic
- `src/paper-trading/engine.ts` (~836 lines) — Core tick-based execution engine:
  - Mirrors aggregate-engine.ts tick loop structure
  - Processes aggregation signals, handles multi-symbol portfolios
  - Exit-before-entry logic to avoid simultaneous buy/sell on same bar
  - Funding rate payments for futures positions (8h intervals)
  - Stale candle detection prevents trading on old data
  - Capital preservation through risk management integration
- `src/paper-trading/session-manager.ts` — SessionManager singleton:
  - Lifecycle control: create, start, pause, resume, stop
  - Auto-restore sessions on server startup (resume interrupted runs)
  - SSE subscriptions for real-time client updates
  - Graceful shutdown with final equity snapshot
  - Telegram notifications for trade events and daily summaries
  - Daily summary timer (configurable UTC time)

### Backend - API
- `src/api/routes/paper-trading.ts` — 11 REST endpoints:
  - `POST /paper-sessions` — Create new session with aggregation config
  - `GET /paper-sessions` — List all sessions (paginated, filterable)
  - `GET /paper-sessions/:id` — Get session details
  - `POST /paper-sessions/:id/start` — Start session tick loop
  - `POST /paper-sessions/:id/pause` — Pause without closing positions
  - `POST /paper-sessions/:id/resume` — Resume paused session
  - `POST /paper-sessions/:id/stop` — Close all positions and finalize
  - `GET /paper-sessions/:id/trades` — Get session trades (paginated)
  - `GET /paper-sessions/:id/equity-snapshots` — Get equity history
  - `GET /paper-sessions/:id/events` — SSE stream for real-time updates
  - `POST /paper-sessions/:id/force-tick` — Dev-only endpoint for testing

### Backend - Infrastructure
- `migrations/007_add_paper_trading.sql` — 4 tables with full indexes and constraints:
  - `paper_sessions` — Session metadata, aggregation config snapshot, status, capital tracking
  - `paper_positions` — Open positions per asset with entry price, quantity, funding rate base
  - `paper_trades` — All executed trades with entry/exit prices, PnL, trade duration
  - `paper_equity_snapshots` — Hourly equity history for charting (per-asset and portfolio totals)
- `src/notifications/telegram.ts` — TelegramNotifier class:
  - sendMessage(text) — Raw message API
  - notifyTradeOpened/Closed(trade) — Trade notifications with PnL
  - notifyDailySummary(sessionId, metrics) — End-of-day stats
  - notifySessionError(sessionId, error) — Error alerts
  - notifySessionStatusChange(sessionId, status) — Status change notifications
  - Uses TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars
- `src/config/env.ts` — Zod-based environment validation:
  - getEnv() — Get single env var with type coercion
  - validateEnv() — Validate entire process.env against schema at startup

### Frontend - Components
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx` — Main UI:
  - Session list with status badges (Running, Paused, Stopped)
  - Session details view with live metrics (return %, Sharpe, max DD)
  - Control buttons (Start, Pause, Resume, Stop)
  - Open positions table with current price, unrealized PnL, quantity
  - TradingView lightweight chart for equity visualization
  - Trades history table with pagination and duration tracking
  - SSE-driven real-time updates without polling
- `src/web/components/PaperTradingPanel/CreatePaperSessionModal.tsx` — Session creation:
  - Aggregation config dropdown (populated from existing configs)
  - Session name input
  - Initial capital input (USD)
  - Validation and submission
- `src/web/components/PaperTradingPanel/PaperEquityChart.tsx` — Equity charting:
  - TradingView lightweight chart (250px height)
  - Dual-axis: portfolio equity (primary) + per-asset equity overlays
  - Synchronized with equity snapshots from API

### Frontend - State Management
- `src/web/stores/paperTradingStore.ts` — Zustand store:
  - Session list and detail state
  - Real-time equity and position updates from SSE
  - Control UI state (loading, error, modal visibility)
- `src/web/hooks/usePaperTrading.ts` — React Query hooks:
  - usePaperSessions() — Get all sessions
  - usePaperSession(id) — Get session details
  - useCreatePaperSession() — Mutation for creation
  - useControlPaperSession(id) — Mutations for start/pause/resume/stop
  - usePaperSessionTrades(id) — Paginated trades
  - usePaperSessionEquitySnapshots(id) — Equity history
  - usePaperSessionSSE(id) — SSE subscription hook with automatic cleanup

### Production Deployment
- `Dockerfile.prod` — Multi-stage build:
  - Builder stage: node:20-alpine with npm install + compile
  - Runtime stage: lean alpine base with node, PM2, curl health checks
  - Security: non-root user, read-only root, health check
- `docker-compose.prod.yml` — Production stack:
  - postgres:16-alpine service with persistent volume
  - api service with PM2 ecosystem.config.cjs
  - nginx reverse proxy with SSE support
- `ecosystem.config.cjs` — PM2 fork mode configuration:
  - restart_delay: 5000ms
  - max_memory_restart: 500MB
  - autorestart on crash
- `nginx.conf` — Reverse proxy:
  - Buffering disabled for SSE streaming
  - 24h keepalive timeout
  - Gzip compression for API responses
  - Static file serving with cache headers
- `scripts/backup-db.sh` — PostgreSQL backup automation:
  - Daily dumps via docker-compose exec
  - 30-day retention policy
  - Tar compression
- `.env.prod.example` — Template with all required env vars
- `.dockerignore` — Excludes node_modules, .git, data, docs, etc.
- `docs/DEPLOYMENT.md` — 10-section deployment guide covering Docker setup, SSL, monitoring, backups

### Testing
- `src/paper-trading/__tests__/engine.test.ts` — 13 tests:
  - Tick loop initialization and execution
  - Signal processing and trade generation
  - Stale candle detection
  - Exit-before-entry logic
- `src/paper-trading/__tests__/funding.test.ts` — 9 tests:
  - Funding rate payment calculations
  - Proper deduction from capital
  - Per-position tracking
- `src/paper-trading/__tests__/positions.test.ts` — 15 tests:
  - PnL calculation for long/short positions
  - Unrealized vs realized PnL
  - Liquidation checks (capital preservation)
  - Multiple positions on same asset
- `src/paper-trading/__tests__/persistence.test.ts` — 19 tests:
  - CRUD operations for all 4 tables
  - Snapshot isolation and data integrity
  - Pagination and filtering
- `src/paper-trading/__tests__/session-manager.test.ts` — 22 tests:
  - SessionManager lifecycle (create, start, pause, resume, stop)
  - SSE subscription management
  - Auto-restore on startup
  - Graceful shutdown
  - Telegram integration
- `src/notifications/__tests__/telegram.test.ts` — 37 tests:
  - Message formatting
  - API error handling and retries
  - Notification types (trade, summary, error, status)
- `scripts/seed-paper-test.ts` — Dev helper:
  - Creates test aggregation config
  - Creates paper session ready to start
  - Useful for manual testing of UI

## Changed

- `src/api/server.ts`:
  - Registered `/api/paper-trading/*` routes
  - Added SessionManager initialization on startup
  - Added session restore call (auto-resume interrupted runs)
  - Added graceful shutdown hook to stop sessions before exit

- `src/web/types.ts`:
  - Added PaperSession, PaperPosition, PaperTrade, PaperEquitySnapshot types
  - Added PaperTradingUIState for component state management

- `src/web/api/client.ts`:
  - Added 11 API functions for paper trading endpoints
  - Added usePaperSessionSSE() subscriber function for real-time updates

- `src/web/stores/aggregationStore.ts`:
  - Extended `activeConfigTab` type to include `'paper-trading'` option
  - Allows switching between backtester, optimizer, and paper trading

- `src/web/components/StrategyConfig/StrategyConfig.tsx`:
  - Added "Paper Trading" tab to tab bar (alongside Backtest, Optimizer, Grid Search)
  - Added conditional rendering to show PaperTradingPanel when tab is active

- `package.json`:
  - Added `"paper:seed"` script pointing to `scripts/seed-paper-test.ts`

## Fixed

- **Capital preservation**: Added capital checks before order execution to prevent over-leverage
- **Stale data handling**: Tick loop validates candle freshness (skips if > 2h old)
- **Exit logic**: Implemented exit-before-entry to prevent simultaneous buy/sell signals
- **Funding rate sync**: Checks all FR timestamps between ticks for proper accrual

## Files Modified

| File | Changes |
|------|---------|
| `src/api/server.ts` | +28 lines — paper trading routes, session lifecycle |
| `src/web/types.ts` | +45 lines — paper trading frontend types |
| `src/web/api/client.ts` | +95 lines — 11 API functions + SSE subscriber |
| `src/web/stores/aggregationStore.ts` | +2 lines — activeConfigTab type extension |
| `src/web/components/StrategyConfig/StrategyConfig.tsx` | +18 lines — Paper Trading tab |
| `package.json` | +1 line — paper:seed script |

## Files Added

| File | Lines | Purpose |
|------|-------|---------|
| `migrations/007_add_paper_trading.sql` | 98 | Database schema for paper trading |
| `src/paper-trading/types.ts` | 87 | TypeScript interfaces |
| `src/paper-trading/db.ts` | 342 | CRUD operations |
| `src/paper-trading/live-data.ts` | 156 | Bybit live data fetching |
| `src/paper-trading/engine.ts` | 836 | Core execution engine |
| `src/paper-trading/session-manager.ts` | 547 | Lifecycle management |
| `src/api/routes/paper-trading.ts` | 421 | REST endpoints |
| `src/notifications/telegram.ts` | 178 | Telegram notifications |
| `src/config/env.ts` | 64 | Environment validation |
| `src/web/stores/paperTradingStore.ts` | 89 | Zustand store |
| `src/web/hooks/usePaperTrading.ts` | 234 | React Query hooks |
| `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx` | 412 | Main UI component |
| `src/web/components/PaperTradingPanel/CreatePaperSessionModal.tsx` | 168 | Modal for session creation |
| `src/web/components/PaperTradingPanel/PaperEquityChart.tsx` | 156 | Equity chart |
| `src/paper-trading/__tests__/engine.test.ts` | 289 | Engine tests |
| `src/paper-trading/__tests__/funding.test.ts` | 234 | Funding tests |
| `src/paper-trading/__tests__/positions.test.ts` | 387 | Position tests |
| `src/paper-trading/__tests__/persistence.test.ts` | 456 | Database tests |
| `src/paper-trading/__tests__/session-manager.test.ts` | 512 | SessionManager tests |
| `src/notifications/__tests__/telegram.test.ts` | 678 | Telegram tests |
| `Dockerfile.prod` | 42 | Production Docker image |
| `docker-compose.prod.yml` | 68 | Production stack definition |
| `ecosystem.config.cjs` | 18 | PM2 configuration |
| `nginx.conf` | 89 | Nginx reverse proxy config |
| `scripts/backup-db.sh` | 28 | Database backup automation |
| `.env.prod.example` | 24 | Environment template |
| `.dockerignore` | 14 | Docker build exclusions |
| `docs/DEPLOYMENT.md` | 287 | Deployment documentation |
| `scripts/seed-paper-test.ts` | 56 | Dev test helper |

## Test Coverage

- **Total new tests**: 115 (all passing)
- **Total project tests**: 418 passing
- **Coverage areas**:
  - Tick loop and signal processing
  - Position management and PnL calculations
  - Funding rate handling
  - Database persistence (CRUD)
  - SessionManager lifecycle
  - Telegram notifications (message formatting, API handling)

## Context

The paper trading system was implemented to bridge the gap between backtesting and live trading. Users can now:

1. **Run live strategies** — Execute aggregation configs against real Bybit market data
2. **Monitor in real-time** — View open positions, equity curves, and trades as they happen
3. **Get notifications** — Telegram alerts for trade execution and daily summaries
4. **Validate strategies** — Compare paper trading results with backtest expectations before deploying live capital
5. **Scale production** — Docker + PM2 + PostgreSQL + Nginx ready for cloud deployment

### Design Highlights

- **Reuses existing components** — SignalAdapter, MultiSymbolPortfolio, BybitProvider already proven in backtesting
- **Mirrors backtest architecture** — Tick loop, signal processing, funding rate handling are consistent
- **Real-time UI** — SSE updates eliminate polling, matches optimizer pattern
- **Capital preservation** — Built-in checks prevent over-leverage and liquidation
- **Graceful degradation** — Stale data detection skips bars rather than executing on old prices
- **No new dependencies** — Telegram via fetch, PM2 in Docker, SSE via Fastify

### Architecture

```
Paper Trading Flow:
  User creates session with aggregation config
       ↓
  SessionManager starts tick loop (every 4h for 1h candles)
       ↓
  Engine fetches live candles + funding rates from Bybit
       ↓
  SignalAdapter processes candles → generates signals
       ↓
  MultiSymbolPortfolio executes trades (respecting capital limits)
       ↓
  Funding rates applied to open positions
       ↓
  Equity snapshot saved to DB
       ↓
  SSE broadcast to React UI (real-time update)
       ↓
  Daily summary sent to Telegram at configured time
```

### Production Readiness

- Multi-stage Docker build with security hardening
- PostgreSQL with automated daily backups (30-day retention)
- PM2 process management with auto-restart and memory limits
- Nginx reverse proxy with SSE buffering disabled
- Health checks and graceful shutdown hooks
- Environment validation at startup
- Error recovery via session auto-restore

## Next Steps

1. Deploy to production environment and validate real-time data flow
2. Monitor session stability across market conditions
3. Gather user feedback on UI responsiveness and notification frequency
4. Consider multi-strategy session support (currently 1 config per session)
5. Add position-level stop loss / take profit overrides for risk management
