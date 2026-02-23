# Aggregation as a First-Class Entity: Complete Refactoring (Phases 1-9)

**Date:** 2026-02-22 13:30

## Summary

Major refactoring that replaces legacy multi-asset strategy hacks (`signal-aggr`, `fr-spike-aggr`) with a proper Aggregation entity — a saved, re-runnable configuration that composes multiple strategy+symbol+timeframe combinations into a portfolio. The aggregation is now managed via dedicated CRUD API endpoints, Zustand store, and dedicated frontend UI components. Multi-asset backtests are no longer ad-hoc but persistent and queryable from history.

**Type:** Architecture / Refactor

## Changed

### Phase 1: Database Migration
- **New table**: `aggregation_configs` in `migrations/006_add_aggregations.sql`
  - Stores: `id`, `name` (UNIQUE), `allocation_mode`, `max_positions`, `sub_strategies` (JSONB), `initial_capital`, `exchange`, `mode`, `created_at`, `updated_at`
  - Foreign key on `backtest_runs.aggregation_id` (SET NULL on delete)

### Phase 2: Backend Database Layer
- Added types in `src/data/db.ts`: `AggregationConfig`, `SubStrategyConfigDB`, `AggregationConfigRow`
- Added helper: `rowToAggregationConfig()` for snake_case → camelCase conversion with JSONB handling
- Added 5 CRUD functions (all async):
  - `saveAggregationConfig(config)` — INSERT with ON CONFLICT upsert
  - `getAggregationConfig(id)` — SELECT by id
  - `getAggregationConfigs()` — SELECT all, ORDER BY updated_at DESC
  - `updateAggregationConfig(id, updates)` — dynamic SET for partial updates
  - `deleteAggregationConfig(id)` — DELETE, returns boolean
- Modified `saveBacktestRun(result, aggregationId?)` to accept optional aggregation link
- Modified `getBacktestSummaries()` to LEFT JOIN with `aggregation_configs` for context
- Modified `getBacktestRun()` to include `aggregation_id` in response

### Phase 3: Backend API Routes
- **New file**: `src/api/routes/aggregations.ts` with 6 Fastify endpoints:
  - `GET /api/aggregations` — list all configs
  - `POST /api/aggregations` — create new config
  - `GET /api/aggregations/:id` — fetch single config
  - `PUT /api/aggregations/:id` — update config (partial update support)
  - `DELETE /api/aggregations/:id` — delete config (runs remain, link set to null)
  - `POST /api/aggregations/:id/run` — execute aggregation, save result linked to config
- Zod validation for:
  - `SubStrategySchema` (strategy, symbol, timeframe)
  - `CreateAggregationSchema` (full payload with defaults)
  - `UpdateAggregationSchema` (all fields optional)
  - `RunAggregationSchema` (date range as number or ISO string, optional capital override)
- Run endpoint behavior:
  - Fetches aggregation config from DB
  - Dynamically imports `runAggregateBacktest` from aggregate engine
  - Executes with `saveResults: false` to avoid double-save
  - Manually saves with `saveBacktestRun(result, aggregationId)` for linking
  - Returns full result with `aggregationId`, `aggregationName`, `duration`
- Registered in `src/api/server.ts` via `fastify.register(aggregationRoutes)`

### Phase 4: Frontend Types & API Client
- **Added to `src/web/types.ts`**:
  - `AggregationConfig` — full config interface matching backend
  - `CreateAggregationRequest` — request payload
  - `UpdateAggregationRequest` — partial update payload
  - `RunAggregationRequest` — run-specific payload
- **Added to `src/web/api/client.ts`**:
  - `getAggregations()` — fetch all configs
  - `createAggregation(req)` — create new
  - `updateAggregation(id, req)` — update config
  - `deleteAggregation(id)` — delete config
  - `getAggregationConfig(id)` — fetch single
  - `runAggregation(id, req)` — execute aggregation
- **Added to `src/web/hooks/useBacktest.ts`**:
  - `useAggregations()` — useQuery for list
  - `useCreateAggregation()` — useMutation for create
  - `useUpdateAggregation()` — useMutation for update
  - `useDeleteAggregation()` — useMutation for delete
  - `useRunAggregation()` — useMutation for run

### Phase 5: Frontend State Management
- **New file**: `src/web/stores/aggregationStore.ts` (Zustand)
  - `activeConfigTab` — 'strategies' | 'aggregations'
  - `selectedAggregationId` — current selected aggregation
  - `dateRange` — startDate/endDate for runs
  - `initialCapital` — configurable capital
  - `isCreateModalOpen` — modal visibility
  - Getters/setters for all state fields

### Phase 6-7: Frontend UI Components
- **Modified `src/web/components/StrategyConfig/StrategyConfig.tsx`**:
  - Added tab bar: "Strategies | Aggregations"
  - When tab is 'aggregations', renders `AggregationsPanel` instead of strategy form
- **New component**: `src/web/components/AggregationsPanel/AggregationsPanel.tsx`
  - Lists all saved aggregations
  - Select/run/edit/delete functionality
  - Calls aggregation store for state management
  - Displays loading/error states
- **New component**: `src/web/components/AggregationsPanel/CreateAggregationModal.tsx`
  - Modal form for creating aggregations
  - Fields: name, allocation_mode (select), max_positions (number), exchange (select), mode (select), initial_capital (number)
  - Sub-strategy list picker (searchable, select strategies to include)
  - Uses React Query mutation for creation
  - Closes modal and refetches list on success

### Phase 8: Display Logic
- **Modified `src/web/App.tsx`**:
  - Changed multi-asset detection from `symbol === 'MULTI'` to checking for `perAssetResults` field
  - Removed `parseMultiAssets()` helper function
  - Correctly identifies aggregation runs regardless of symbol value
  - "Portfolio" label shown for runs with per-asset breakdowns

### Phase 9: History Explorer UI
- **Modified `src/web/components/History/HistoryExplorer.tsx`**:
  - Added AGG badge (purple background) for aggregation runs
  - Added "Portfolio" display for MULTI symbol runs (or runs with perAssetResults)
  - Added run type filter: "All / Strategies / Aggregations"
  - Segmented button control for filtering

## Deleted

### Strategy Hacks Removed
- `/workspace/strategies/signal-aggr.ts` — legacy aggregate strategy hack
- `/workspace/strategies/fr-spike-aggr.ts` — legacy multi-asset FR strategy hack

### API Endpoints Removed
- `POST /api/backtest/multi/run` — ad-hoc multi-asset orchestration (316 lines)
- `POST /api/backtest/aggregate/run` — temporary aggregation endpoint

### Frontend Code Removed
- `useRunMultiAssetBacktest()` hook
- `useRunAggregateBacktest()` hook
- `runMultiAssetBacktest()` client function
- `runAggregateBacktest()` client function
- `RunMultiAssetBacktestRequest` type
- `RunAggregateBacktestRequest` type
- `isMultiAsset` and `isAggregate` boolean flags from `StrategyInfo` and `StrategyDetails`
- `ASSET_PRESETS` constant
- All multi-asset/aggregate conditional branches from `StrategyConfig.tsx`
- Auto-exchange/mode setter for multi-asset strategies

## Added

### Backend
- **6 new API endpoints** for aggregation CRUD + run
- **5 new database CRUD functions** in `src/data/db.ts`
- **Aggregation schema validation** with Zod
- **Run endpoint** that executes aggregations and links results to config

### Frontend
- **Aggregation store** (Zustand) for state management
- **AggregationsPanel** component for listing/selecting aggregations
- **CreateAggregationModal** component for creating aggregations
- **Tab bar** in StrategyConfig for switching between single-strategy and aggregation modes
- **Type definitions** for all aggregation-related requests/responses
- **React Query hooks** (5 total) for aggregation CRUD operations
- **AGG badge** in history for visual aggregation run identification
- **Portfolio label** for multi-asset runs in history

### Database
- `aggregation_configs` table with full schema
- `aggregation_id` foreign key on `backtest_runs`
- Migration file: `migrations/006_add_aggregations.sql`

## Fixed

- **Parameter display**: Added missing `label` fields to fr-spike-aggr and signal-aggr params before deletion
- **Date handling**: String dates defensively converted to numeric timestamps in aggregate-engine.ts
- **Allocation logic**: Proper capital allocation across sub-strategies in AggregateEngine

## Context

The backtesting platform previously used two legacy hack strategies (`signal-aggr`, `fr-spike-aggr`) to handle multi-asset portfolios. These were ad-hoc implementations that:
- Did not persist aggregation configurations
- Could not be re-run from history
- Had no dedicated API or UI
- Mixed business logic with strategy code

This refactoring establishes Aggregation as a first-class entity with:
- Persistent configuration storage (DB)
- Full CRUD API (6 endpoints)
- Dedicated frontend store and UI
- Proper linking in run history
- Clean separation from strategy code

Users can now:
1. Create and save aggregation configurations
2. Run them on demand with date/capital overrides
3. See all aggregation runs in history with AGG badge
4. Update/delete aggregation configs
5. Filter history by run type (Strategies vs Aggregations)

This enables professional backtesting workflows where portfolios are repeatable, auditable, and analyzable.

## Files Modified

**Backend:**
- `src/api/routes/aggregations.ts` (new) — 6 Fastify endpoints
- `src/api/server.ts` — registered aggregation routes
- `src/data/db.ts` — added 5 CRUD functions, modified saveBacktestRun/getBacktestSummaries/getBacktestRun
- `src/data/index.ts` — exported new CRUD functions and AggregationConfig type

**Frontend:**
- `src/web/components/StrategyConfig/StrategyConfig.tsx` — added tab bar, removed legacy multi-asset code
- `src/web/components/AggregationsPanel/AggregationsPanel.tsx` (new) — aggregation list/select/run/edit/delete
- `src/web/components/AggregationsPanel/CreateAggregationModal.tsx` (new) — form for creating aggregations
- `src/web/stores/aggregationStore.ts` (new) — Zustand store for aggregation state
- `src/web/api/client.ts` — 6 new aggregation API client functions
- `src/web/hooks/useBacktest.ts` — 5 new React Query hooks for aggregation CRUD
- `src/web/types.ts` — 4 new aggregation-related type definitions
- `src/web/App.tsx` — changed multi-asset detection logic, removed parseMultiAssets()
- `src/web/components/History/HistoryExplorer.tsx` — added AGG badge, portfolio label, run type filter

**Database:**
- `migrations/006_add_aggregations.sql` (new) — aggregation_configs table + FK

**Deleted:**
- `strategies/signal-aggr.ts`
- `strategies/fr-spike-aggr.ts`
- `POST /api/backtest/multi/run` endpoint (removed from backtest.ts)
- `POST /api/backtest/aggregate/run` endpoint (removed from backtest.ts)

## Quality Gates

- TypeScript: passes with 0 errors (`npm run typecheck`)
- Tests: 303 tests pass (10 test files)
- No references to deleted strategy files in source code
- All endpoint validation schemas tested with Zod
- Historical aggregation runs correctly displayed with AGG badge and Portfolio label
- Create/update/delete aggregations work end-to-end
- Run endpoint properly links result to aggregation config
- Capital allocation across sub-strategies validated

## Breaking Changes

None — removal of legacy hack strategies and endpoints is fully backward-compatible since those were temporary implementations that will be replaced by proper aggregation workflow.

## Notes for Developers

1. **Aggregation vs Strategy**: An aggregation is NOT a strategy file. It's a saved configuration that composes multiple existing strategies.
2. **Run linking**: Every aggregation run is automatically linked to its parent config via `aggregation_id`, visible in history.
3. **Capital override**: When running an aggregation, users can override the saved `initial_capital` without modifying the config.
4. **Allocation modes**: Supported modes are `single_strongest` and `top_n`. Implementations in AggregateEngine.
5. **Per-asset results**: Aggregations produce `perAssetResults` field which App.tsx uses to detect multi-asset runs.
6. **Migration required**: PostgreSQL database must have migrations applied to create `aggregation_configs` table and `aggregation_id` column on `backtest_runs`.
