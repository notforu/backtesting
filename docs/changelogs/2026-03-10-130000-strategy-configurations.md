# Strategy Configurations Feature

**Date**: 2026-03-10 13:00
**Author**: system

## Summary

Introduced "Strategy Configuration" as a first-class entity in the backtesting system. This major architectural restructuring provides immutable, content-addressable configuration records with SHA256 hash deduplication. Each unique combination of (strategy_name, symbol, timeframe, params) is stored once and referenced by backtest runs, paper trading sessions, and optimization results. Simultaneously removed spot/futures mode distinction — the system now operates exclusively in futures mode with spot behavior achieved via 1x leverage.

## Changed

- **Database schema**: Added `strategy_configs` table as central config registry with content hash deduplication
- **Backtest runs**: Now link to strategy_config_id instead of embedding full config; denormalized run-level metadata (initial_capital, exchange, start_date, end_date) added
- **Aggregation configs**: Restructured to reference sub_strategy_config_ids array; removed mode column (always futures); added content_hash for version tracking
- **Paper sessions**: Added strategy_config_id foreign key for config traceability
- **Optimization results**: Added strategy_config_id FK to link optimized params to source config
- **API response shapes**: Backtest runs now include strategyConfigId; aggregation endpoints updated to reflect new schema
- **Mode handling**: Spot mode removed — all trading is futures-based; spot behavior via 1x leverage
- **Backtesting engine**: Auto-creates strategy configs on `POST /api/backtest/run`

## Added

**Database**:
- `migrations/015_strategy_configs.sql` - Comprehensive migration with data backfill (381 configs from 388 existing runs)
- `strategy_configs` table (id, strategy_name, symbol, timeframe, params JSON, content_hash UNIQUE, created_at, updated_at)

**Backend**:
- `src/utils/content-hash.ts` - SHA256 hash generation for (strategy, symbol, timeframe, params) tuples
- `src/data/strategy-config.ts` - Database operations (findOrCreate, list, delete, versions lookup)
- `src/api/routes/strategy-configs.ts` - 7 new REST endpoints for config CRUD and relationship queries

**Frontend Components**:
- `src/web/components/ConfigurationsPage/` - 10 new components (index, sidebar, detail panel, tabs, run cards, aggregation browser)
- `src/web/components/RunBacktestModal/RunBacktestModal.tsx` - Extracted strategy form into reusable modal with pre-fill from existing configs
- `src/web/stores/configurationStore.ts` - Zustand store for config list + detail state
- `src/web/stores/runBacktestModalStore.ts` - Zustand store for modal open/close + pre-fill logic
- `src/web/hooks/useConfigurations.ts` - API hooks for config queries and mutations

**API Endpoints**:
- `GET /api/strategy-configs` - List with filters (strategy_name, symbol, timeframe, exchange)
- `GET /api/strategy-configs/:id` - Retrieve single config with full details
- `POST /api/strategy-configs` - Find-or-create endpoint with content hash deduplication
- `DELETE /api/strategy-configs/:id` - Delete config and cascade delete backtest runs; unlink paper sessions
- `GET /api/strategy-configs/:id/runs` - List backtest runs linked to this config
- `GET /api/strategy-configs/:id/paper-sessions` - List active paper trading sessions using this config
- `GET /api/strategy-configs/versions` - Version history (all configs with same strategy+symbol+timeframe, sorted by params)

**UI Pages**:
- "Configurations" navigation tab between Backtesting and Paper Trading
- Two sub-tabs: "Strategies" (single-asset configs) | "Aggregations" (multi-asset configs)
- Sidebar with scrollable config list, search/filter by name/symbol/strategy
- Detail panel showing config metadata + full params + action buttons (Run Backtest, Start PT, Delete)
- Per-config tabs: Runs (list + delete) | Paper (active sessions) | Versions (parameter history)
- Each run card displays metrics (Sharpe, return, max DD, trades), delete button, "Open in Backtesting" navigation
- Delete confirmation dialog shows count of affected runs/sessions

## Fixed

- **Hash deduplication**: Prevents duplicate strategy configs from bloating database (383 configs vs. potential 388+ records)
- **Run traceability**: Every backtest run now directly links to immutable config; enables reproducibility and config reuse
- **Aggregation clarity**: Explicit sub_strategy_config_ids array replaces implicit strategy parameter embedding
- **Data integrity**: Migration backfills all existing runs with properly hashed configs; no data loss

## Files Modified

### Backend
- `src/api/server.ts` - Register strategy config routes
- `src/api/routes/backtest.ts` - Auto-create strategy config before running backtest; return strategyConfigId in response
- `src/data/db.ts` - Add strategy_config_id to backtest_runs and paper_sessions save/query functions; migration runner includes 015
- `src/data/types.ts` - Add StrategyConfigEntity type definition

### Frontend
- `src/web/App.tsx` - Add ConfigurationsPage component; add RunBacktestModal; update routes to include /configs
- `src/web/components/AppHeader/AppHeader.tsx` - Add "Configurations" nav tab; add "New Backtest" button to header
- `src/web/stores/paperTradingStore.ts` - Add 'configurations' to ActivePage union type
- `src/web/hooks/useUrlSync.ts` - Add route handlers for /configs/:id, /configs/:id/runs, /configs/:id/paper, /configs/:id/versions
- `src/web/api/client.ts` - Add API functions: getStrategyConfigs, getStrategyConfig, createStrategyConfig, deleteStrategyConfig, getConfigRuns, getConfigPaperSessions, getConfigVersions
- `src/web/types.ts` - Add StrategyConfigEntity, StrategyConfigResponse types

## Context

This change addresses a critical architectural gap: previously, backtest runs embedded complete strategy configs inline, making it difficult to:
1. Identify and deduplicate equivalent configurations
2. Track which runs used identical strategy+params+symbol combinations
3. Reuse configs across backtest/paper-trading/optimization without re-entry
4. Understand parameter evolution for a given strategy on a given symbol

By making StrategyConfig a first-class entity with SHA256 content-addressing, the system now:
- **Deduplicates**: Only one record per unique (strategy, symbol, timeframe, params) tuple
- **Enables reuse**: Paper trading and optimization can reference existing configs without re-running backtests
- **Improves traceability**: Every run has a clear link to its immutable config
- **Simplifies aggregations**: Multi-asset portfolios reference arrays of strategy config IDs instead of embedding strategy specs

Additionally, removing spot/futures mode distinction simplifies the system by treating all trading as futures-based. Spot behavior is achieved by setting leverage to 1x, reducing configuration complexity and cognitive load on users.

The "Configurations" UI page complements the existing Backtesting and Paper Trading pages, giving users a dedicated space to manage, review, and reuse strategy configurations.
