# Strategy Config API Routes

**Date**: 2026-03-10
**Type**: New feature

## Summary

Introduced REST API endpoints for managing `strategy_configs` rows, plus supporting changes
to `saveBacktestRun`, `getBacktestSummaries`, and the backtest run endpoint.

---

## New file: `src/api/routes/strategy-configs.ts`

Six endpoints registered under `/api/strategy-configs`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/strategy-configs` | List all configs, optional `strategy`/`symbol`/`timeframe` query filters |
| GET | `/api/strategy-configs/versions` | Version history for a (strategy, symbol, timeframe) triple |
| GET | `/api/strategy-configs/:id` | Get a single config by ID |
| POST | `/api/strategy-configs` | Find-or-create with content-hash deduplication |
| DELETE | `/api/strategy-configs/:id` | Cascading delete (runs + unlink sessions) |
| GET | `/api/strategy-configs/:id/runs` | All backtest runs for a config |
| GET | `/api/strategy-configs/:id/paper-sessions` | Paper sessions linked directly or via aggregation |

All endpoints use Zod validation and follow the same error-handling patterns as `aggregations.ts`.

---

## Modified: `src/api/server.ts`

- Imported `strategyConfigRoutes` and registered it with `fastify.register`.

---

## Modified: `src/data/db.ts`

### `saveBacktestRun`
- Added third optional parameter `strategyConfigId?: string`.
- INSERT now includes `strategy_config_id`, `initial_capital`, `exchange`, `start_date`, `end_date`
  columns (all added by migration 015).

### `BacktestSummary` interface
- Added optional `strategyConfigId?: string` field.

### `HistoryFilters` interface
- Added optional `strategyConfigId?: string` field.

### `getBacktestSummaries`
- Applies `WHERE br.strategy_config_id = $N` when `filters.strategyConfigId` is set.
- Selects `br.strategy_config_id` and maps it to `summary.strategyConfigId`.

---

## Modified: `src/core/engine.ts`

### `EngineConfig` interface
- Added optional `strategyConfigId?: string` field.

### `runBacktest`
- Passes `options.strategyConfigId` to `saveBacktestRun` so runs are linked when the caller
  provides a config ID.

---

## Modified: `src/api/routes/backtest.ts`

### `POST /api/backtest/run`
- Before running the backtest, calls `findOrCreateStrategyConfig` to get (or create) the
  matching `strategy_configs` row.
- Passes `strategyConfigId` to `runBacktest` via `EngineConfig` — the engine persists the
  link automatically; no duplicate save occurs.
- Response now includes `strategyConfigId`.

### `GET /api/backtest/history`
- Result items now include `strategyConfigId` (passed through from `BacktestSummary`).

---

## Backward compatibility

- All new fields are additive (optional). Existing callers that do not pass `strategyConfigId`
  are unaffected — the column is stored as NULL for those runs.
- Reading old rows still works: `strategyConfigId` is simply absent/undefined.
