# Aggregation First-Class Entity: Phase 1 (DB Migration) and Phase 2 (Backend API)

**Date:** 2026-02-22

## Summary

Implemented persistent aggregation configurations as a first-class entity. Users can now save, update, and re-run multi-strategy aggregations with a dedicated API. Previously, aggregation runs were ad-hoc and not linked to any saved configuration.

## Phase 1: Database Migration

### New file: `/workspace/migrations/006_add_aggregations.sql`

- Creates `aggregation_configs` table to persist aggregation definitions:
  - `id` (TEXT PRIMARY KEY), `name` (UNIQUE), `allocation_mode`, `max_positions`
  - `sub_strategies` (JSONB), `initial_capital`, `exchange`, `mode`
  - `created_at` / `updated_at` timestamps (BIGINT)
- Adds `aggregation_id` column to `backtest_runs` as a foreign key (SET NULL on delete) so every run can be linked back to the aggregation config that produced it.

### Changes to `/workspace/src/data/db.ts`

**New types:**
- `AggregationConfig` (exported interface) with camelCase fields
- `SubStrategyConfigDB` (internal interface for row representation)
- `AggregationConfigRow` (internal DB row interface)

**New helper:**
- `rowToAggregationConfig(row)` — converts snake_case DB row to camelCase TypeScript object, handles JSONB string/object duality

**New CRUD functions (all async, use `getPool()`):**
- `saveAggregationConfig(config)` — INSERT with ON CONFLICT DO UPDATE (upsert by id)
- `getAggregationConfig(id)` — SELECT by id, returns null if not found
- `getAggregationConfigs()` — SELECT all, ORDER BY updated_at DESC
- `updateAggregationConfig(id, updates)` — dynamic SET for provided fields, always updates `updated_at`, returns updated config or null if not found
- `deleteAggregationConfig(id)` — DELETE, returns true if deleted

**Modified `saveBacktestRun(result, aggregationId?)`:**
- Added optional second parameter `aggregationId?: string`
- Inserts `aggregation_id` column value (null if not provided)

**Modified `BacktestSummary` interface:**
- Added optional `aggregationId?: string` and `aggregationName?: string` fields

**Modified `getBacktestSummaries()`:**
- Added LEFT JOIN with `aggregation_configs` to fetch aggregation name alongside run summaries
- Updated all WHERE conditions and ORDER BY to use `br.` table alias (required after the JOIN)
- Count query also uses the JOIN for consistency
- Populates `aggregationId` and `aggregationName` on returned summaries when present

**Modified `getBacktestRun()`:**
- Added `aggregation_id` to the SELECT
- Added `aggregation_id` to `BacktestRunRow` interface
- Sets `(backtest as any).aggregationId` when `aggregation_id` is present in the row

### Changes to `/workspace/src/data/index.ts`

Added exports for all new CRUD functions and the `AggregationConfig` type.

## Phase 2: Backend API

### New file: `/workspace/src/api/routes/aggregations.ts`

Fastify route plugin with 6 endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/aggregations` | List all saved aggregation configs |
| POST | `/api/aggregations` | Create new aggregation config |
| GET | `/api/aggregations/:id` | Get single config by id |
| PUT | `/api/aggregations/:id` | Update existing config |
| DELETE | `/api/aggregations/:id` | Delete config (runs remain, link set null) |
| POST | `/api/aggregations/:id/run` | Run the aggregation, save result linked to config |

**Zod validation schemas:**
- `SubStrategySchema` — validates each sub-strategy with timeframe enum
- `CreateAggregationSchema` — full creation payload with defaults
- `UpdateAggregationSchema` — all fields optional for partial update
- `RunAggregationSchema` — accepts startDate/endDate as number or ISO string, optional initialCapital override

**Run endpoint behavior:**
- Fetches config from DB
- Dynamically imports `runAggregateBacktest` from aggregate engine
- Calls engine with `saveResults: false` to skip auto-save
- Manually saves result via `saveBacktestRun(result, aggregationId)` to link to config
- Returns full result + `aggregationId`, `aggregationName`, `candles: []`, `duration`

### Changes to `/workspace/src/api/server.ts`

- Imported `aggregationRoutes` from `./routes/aggregations.js`
- Registered with `await fastify.register(aggregationRoutes)`

## TypeCheck

`npm run typecheck` passes with zero errors after all changes.
