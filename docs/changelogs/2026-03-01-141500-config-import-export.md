# Config Import/Export Feature

**Date:** 2026-03-01
**Type:** New Feature

## Summary

Implemented a complete import/export system for backtest run configurations. This allows transferring configurations between environments (e.g., local to production) and re-running previously executed backtest setups.

## New Files

### `src/core/config-export-types.ts`
- TypeScript interfaces for `SingleStrategyExport`, `AggregationExport`, `PairsExport`, and `BacktestConfigExportFile`
- Full Zod validation schemas for all export types (discriminated union on `type` field)
- `BacktestConfigExportFileSchema` with `version: 1` for future versioning

### `src/core/config-export.ts`
- `extractExportConfig(row)` — converts a DB backtest run row into an `ExportedConfig` (auto-detects single/aggregation/pairs based on config shape)
- `buildExportFile(configs, environment?)` — wraps configs in the standard export envelope with timestamp
- `parseImportFile(data)` — parses and validates raw JSON against the Zod schema

### `src/api/routes/config-export.ts`
- `POST /api/configs/export` — accepts `{ runIds: string[] }`, returns a JSON file attachment
- `POST /api/configs/import` — accepts `{ file: BacktestConfigExportFile, rerun: boolean }`:
  - `rerun=false` (default): validates and returns a preview summary
  - `rerun=true`: executes all configs and returns results with new run IDs

### `scripts/export-configs.ts`
CLI script for exporting configs from the database:
```
npm run config:export -- --ids=id1,id2 --output=configs.json
npm run config:export -- --strategy=funding-rate-spike --min-sharpe=1.0 --output=configs.json
npm run config:export -- --all --output=configs.json
```

### `scripts/import-configs.ts`
CLI script for importing and optionally re-running configs:
```
npm run config:import -- --input=configs.json [--dry-run]
npm run config:import -- --input=best-configs/ [--dry-run]
```
- Supports directory input (reads all `.json` files)
- Dry run prints a summary table without executing

## Modified Files

### `src/data/db.ts`
Added two new async functions:
- `getBacktestRunsByIds(ids)` — fetches runs with LEFT JOIN to `aggregation_configs` for full export metadata
- `getBacktestRunIds(filters?)` — returns run IDs with optional strategy name and min Sharpe filters

### `src/api/server.ts`
- Registered `configExportRoutes` plugin

### `src/web/components/HistoryExplorer/HistoryExplorer.tsx`
- Added export checkbox to each row in the flat list view
- Added export/import toolbar with "Export Selected" button and "Import Configs" button
- Wired up `ImportConfigModal` (pre-existing component)

### `package.json`
Added npm scripts:
- `config:export` — runs `scripts/export-configs.ts`
- `config:import` — runs `scripts/import-configs.ts`

## Technical Notes

- Export files use `version: 1` for future migration support
- Config type detection: pairs detected by `symbolA`/`symbolB` fields, aggregation by `aggregation_id` or `symbol === 'MULTI'`
- Zod v4 compatibility: uses `.issues` instead of `.errors` on `ZodError`
- Aggregation re-runs use `runAggregateBacktest` which saves internally; pairs also saves internally
- Single strategy re-runs call `saveBacktestRun()` explicitly after execution
