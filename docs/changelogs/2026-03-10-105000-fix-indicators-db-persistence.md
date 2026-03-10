# Fix: Indicators Database Persistence

**Date**: 2026-03-10 10:50
**Author**: docs-writer

## Summary

Fixed dynamic strategy indicators (e.g., FR V2 percentile thresholds) not persisting to database, causing chart to fall back to static threshold lines when loading historical results.

## Changed

- `src/data/db.ts` — Updated `BacktestRunRow` interface to include indicators field
- `src/data/db.ts` — Modified `saveBacktestRun()` to persist `indicators` as JSONB
- `src/data/db.ts` — Modified `getBacktestRun()` to restore `indicators` from database

## Added

- Migration `migrations/014_add_indicators_to_backtest_runs.sql` — Added `indicators JSONB` column to `backtest_runs` table

## Fixed

- Dynamic indicator data (percentile thresholds, FR V2 metrics) now survives database round-trip
- Historical backtest results now correctly display per-bar indicators on the chart instead of falling back to static lines

## Files Modified

- `migrations/014_add_indicators_to_backtest_runs.sql` — New database schema
- `src/data/db.ts` — Database interface and persistence logic

## Context

The `setIndicator()` mechanism was added to the engine and SignalAdapter to emit per-bar indicator data (like dynamic percentile thresholds). While the data flowed correctly for fresh backtests, it was lost when saving to and loading from the database. This fix ensures indicators survive the database round-trip, preserving the full visualization context when reviewing historical results.

All 16 indicator-related unit tests pass, confirming SignalAdapter collection, FR V2 emission, and dynamic value behavior.
