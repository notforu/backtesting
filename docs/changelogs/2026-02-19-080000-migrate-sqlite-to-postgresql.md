# Migrate SQLite to PostgreSQL

**Date**: 2026-02-19 08:00
**Author**: backend-team

## Summary
Replaced the SQLite (better-sqlite3) database backend with PostgreSQL (node-postgres/pg) to resolve cross-platform native binding conflicts between the Docker sandbox and host machine. Both environments can now share the same database over TCP, eliminating "SQLITE_CANTOPEN" errors and native module compilation issues.

## Changed
- Replaced synchronous SQLite backend with asynchronous PostgreSQL connection pool
- Converted 23+ database functions from sync to async (all now return Promises)
- Updated SQL syntax: `?` placeholders → `$1,$2,...`, `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`, `REAL` → `DOUBLE PRECISION`
- Transaction management now uses explicit `BEGIN/COMMIT/ROLLBACK` queries
- Added migration system to track and apply schema changes automatically

## Added
- PostgreSQL 16 service in `.docker/claude-sandbox/docker-compose.yml` with health checks and persistence
- `migrations/001_initial_schema.sql` — full PostgreSQL schema (9 tables, all indexes, constraints)
- `initDb()` function to run migrations on startup
- `getPool()` export for advanced query access
- `pg` and `@types/pg` dependencies

## Fixed
- Resolved native binding conflicts preventing Docker-host database sharing
- Fixed SQLITE_CANTOPEN errors when switching between environments
- Fixed compilation errors with better-sqlite3 on certain platforms

## Files Modified
- `package.json` — replaced better-sqlite3 with pg
- `src/data/db.ts` — complete rewrite (sync → async, SQLite → PostgreSQL)
- `src/core/engine.ts` — added await to all db calls
- `src/core/pairs-engine.ts` — added await to all db calls
- `src/core/optimizer.ts` — added await to optimization CRUD
- `src/api/routes/backtest.ts` — added await to all endpoints
- `src/api/routes/candles.ts` — added await to all endpoints
- `src/api/routes/optimize.ts` — added await to all endpoints
- `src/api/server.ts` — uses await initDb() on startup
- `src/cli/quant-backtest.ts`, `quant-optimize.ts`, `quant-walk-forward.ts` — added await closeDb() in finally blocks
- `src/data/polymarket-cache.ts` — full async rewrite
- `src/data/pm-market-selector.ts` — converted to async
- `src/data/providers/polymarket.ts` — added await to market CRUD
- `src/data/index.ts` — exports getPool/initDb instead of getDb
- `scripts/` — 8 files updated (cache-funding-rates, batch-fr-backtest, pm-discover-and-cache, pm-backtest-scan, run-optimization-minimal, run-optimization-fast, pm-monte-carlo-test, check-db)

## Breaking Changes
- `getDb()` removed — use `getPool()` for raw queries or keep using exported db functions
- All db functions now return Promises — callers must use `await`
- `closeDb()` now async — callers must use `await closeDb()`
- Requires PostgreSQL 16+ (docker-compose included)
- Connection via `DATABASE_URL` env var (default: `postgresql://backtesting:backtesting@localhost:5432/backtesting`)

## Context
SQLite's native binding module (better-sqlite3) caused compilation and loading failures when switching between Docker sandbox and host machine. PostgreSQL uses pure JavaScript connection pool (node-postgres/pg) with TCP networking, allowing both environments to connect to the same database instance without native module conflicts. This enables:
- Seamless Docker ↔ host development workflow
- Concurrent connections without SQLITE_BUSY contention
- Standard database backup/restore practices
- Future high-availability setup

## Verification
- TypeScript: 0 errors
- ESLint: 0 errors (165 pre-existing warnings)
- Production build: successful
- All 13 modified source files and 8 scripts tested with migration runner
