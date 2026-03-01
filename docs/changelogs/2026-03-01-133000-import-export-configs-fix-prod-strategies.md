# Import/Export Configurations + Fix Production Strategy Loading

**Date**: 2026-03-01 13:30
**Author**: agent-team

## Summary

Five-phase delivery addressing critical production issue and enabling configuration management:

1. **Fix production strategy loading**: Strategies were not loading in Docker (0 strategies available). Root cause: `.ts` files cannot be dynamically imported in Node.js without TypeScript runtime. Solution: compile strategies to `.js` via separate tsconfig, auto-detect runtime mode in loader.
2. **Backend import/export**: Core business logic for extracting/parsing/validating backtest configurations with discriminated unions (single/aggregation/pairs).
3. **API endpoints**: REST endpoints for exporting configs by run IDs and importing with validation/execution.
4. **CLI tools**: `config:export` and `config:import` npm scripts for server-side workflows.
5. **Dashboard UI**: Multi-select export from history, drag-and-drop import modal, results viewer.

## Changed

### Phase 0: Production Strategy Loading Fix
- **Root Cause**: `src/strategy/loader.ts` hardcoded `.ts` extension; production Docker ran compiled JavaScript via PM2, so dynamic imports failed
- **Fix**:
  - Detect runtime mode via `__dirname` (dev: raw `.ts` from `strategies/`, prod: compiled `.js` from `dist/strategies/`)
  - Created `tsconfig.strategies.json` for separate compilation of strategy files
  - Updated `Dockerfile.prod` to copy `dist/strategies/` instead of `strategies/`
  - Updated build script in `package.json` to compile strategies post-TypeScript

### Phase 1: Export Configuration Types
- New Zod schemas and TypeScript interfaces for export file format
- Discriminated union supporting three config types: single, aggregation, pairs
- Includes strategy params, backtest config, symbol/symbols, and metadata

### Phase 2: Export Business Logic
- `extractExportConfig()`: Extracts backtest run data into exportable format
- `buildExportFile()`: Combines multiple configs into downloadable JSON with version/timestamp
- `parseImportFile()`: Validates import file structure and yields individual configs

### Phase 3: Database Support
- `getBacktestRunsByIds()`: Fetch full run records by ID array
- `getBacktestRunIds()`: Query run IDs by strategy name and symbol filters

### Phase 4: API Endpoints
- `POST /api/configs/export` — Export selected run IDs to JSON file download
- `POST /api/configs/import` — Import with optional dry-run validation or immediate re-run execution

### Phase 5: CLI Tools
- `npm run config:export` — Export by IDs, strategy filter, or all runs
- `npm run config:import` — Import from file/directory with optional `--dry-run`

### Phase 6: Dashboard UI
- Multi-select checkboxes in history table (per-row + select-all header)
- Export/Import toolbar buttons
- Full import modal with drag-and-drop, validation preview, and results table

## Added

- `tsconfig.strategies.json` — TypeScript config for compiling strategy files
- `src/core/config-export-types.ts` — Export file format definitions and Zod schemas
- `src/core/config-export.ts` — Business logic for extract/build/parse operations
- `src/api/routes/config-export.ts` — REST endpoints for import/export
- `scripts/export-configs.ts` — CLI export tool
- `scripts/import-configs.ts` — CLI import tool
- `src/web/components/ImportConfigModal/ImportConfigModal.tsx` — Modal component for imports
- `best-configurations/` — Directory for storing exported configs (git-tracked)

## Fixed

- **Production strategy loading**: Strategies now load correctly in compiled Docker image (was 0 strategies before)
- **Runtime mode detection**: Loader intelligently selects `.ts` or `.js` based on environment

## Files Modified

| File | Changes |
|------|---------|
| `src/strategy/loader.ts` | Runtime mode detection, conditional `.ts`/`.js` selection |
| `Dockerfile.prod` | Copy `dist/strategies/` instead of `strategies/`, compile strategies in build |
| `package.json` | Added `config:export`, `config:import` scripts; updated build to compile strategies |
| `src/data/db.ts` | Added `getBacktestRunsByIds()`, `getBacktestRunIds()` queries |
| `src/api/server.ts` | Registered `/api/configs/export` and `/api/configs/import` routes |
| `src/web/api/client.ts` | Added `exportConfigs()`, `importConfigs()` API client functions |
| `src/web/components/HistoryExplorer/HistoryExplorer.tsx` | Added multi-select, export/import toolbar, selection state |

## Context

**Phase 0 Critical Fix**: Production Docker deployments had zero strategies available. PM2 runs compiled JavaScript from `dist/`, but the loader only recognized `.ts` files from source directory. This broke all strategy-based features in production. Fix ensures backward compatibility with dev environment while supporting compiled code in production.

**Phases 1-6 Feature**: Enables users to export optimized backtest configurations (parameters, settings, metadata) from history and re-import them on different systems or to share with team members. Essential for reproducing results and deploying best strategies. Supports single-asset, aggregation, and pairs trading configs.

**Backward Compatibility**: All changes are additive or non-breaking. Existing backtests continue to work. Strategy loading enhancement is transparent to strategy files.
