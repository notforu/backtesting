# Changelog

All significant changes to the backtesting platform are documented here. See individual files in `/chat_logs/` for detailed information on each change.

## 2026-03-01: Fix Chart Real-Time Updates When Session Paused

**File**: `/docs/changelogs/2026-03-01-160000-fix-chart-realtime-when-paused.md`

Fixed paper trading price chart not updating in real-time when session is paused/stopped. Stabilized `endRounded` value in PaperTradingPage to prevent React Query cache key changes on WebSocket ticks. Updated Chart component to use TradingView's `update()` method for incremental candle updates instead of `setData()` which was resetting zoom/scroll position.

**Key fixes**:
- Chart continues real-time updates regardless of session status (running/paused/stopped)
- WebSocket ticks no longer trigger React Query refetches
- Chart zoom/scroll position preserved during updates
- TradingView `update()` method properly handles new bar appends

---

## 2026-02-26: Paper Trading System Implementation

**File**: `/chat_logs/2026-02-26-160000-paper-trading-system.md`

Implemented comprehensive paper trading system for running live multi-asset strategies in parallel with backtesting. Includes tick-based execution engine mirroring backtest architecture, real-time Bybit data ingestion, Telegram notifications, PostgreSQL persistence, and full React UI with equity charting. 115 new tests ensure robustness of capital management and order execution.

**Key additions**:
- Paper trading engine with tick loop, signal processing, funding rate handling
- SessionManager singleton for lifecycle control and auto-restore on crash
- 11 REST API endpoints for CRUD and real-time SSE updates
- React components for session management, live metrics, equity charting
- Telegram notifications for trade events and daily summaries
- Production-ready Docker + PM2 + Nginx + PostgreSQL stack
- 115 tests covering engine, positions, funding, persistence, and notifications

---

## 2026-02-23: Expanded FR-Spike Scan and Aggregations

**File**: `/docs/changelogs/2026-02-23-160000-expanded-fr-spike-scan-and-aggregations.md`

Expanded funding-rate-spike strategy from 26 to 74 Bybit symbols. Batch scanned 148 runs, discovered 10 new profitable assets, validated 4 with walk-forward testing. Created 6 aggregation portfolio configs with best Sharpe of 2.31. Results saved to database.

**Key achievements**:
- 74 Bybit symbols with 2-year candle + funding rate data
- 56/120 qualifying runs profitable (47%)
- Top performer: ADA 1h (Sharpe 1.56)
- 4 WF-validated assets (ETC 1h improved 86% OOS!)
- Production-ready portfolio configs saved to DB

---

## Previous Work

See `/docs/changelogs/` for all historical changes.
