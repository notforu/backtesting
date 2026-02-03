# Fix Optimization Endpoint 500 Error

**Date**: 2026-01-25 13:00
**Author**: system

## Summary

Fixed a critical database schema mismatch that caused the optimization endpoint to return 500 errors. The optimizer functions were trying to access a table called `optimized_params` that didn't exist in the schema initialization. Added the missing table definition to resolve the issue.

## Changed

- **src/data/db.ts**: Updated `initializeTables()` function to create the `optimized_params` table with proper schema

## Added

- **optimized_params table**: New table in database schema with columns:
  - `id`: Primary key (integer, auto-increment)
  - `strategy_name`: Name of the strategy (string)
  - `symbol`: Trading pair symbol (string)
  - `params`: Optimized parameters as JSON (string)
  - `metrics`: Performance metrics as JSON (string)
  - `optimized_at`: Timestamp of optimization (datetime)
  - `config`: Optimization configuration as JSON (string)
  - `total_combinations`: Total parameter combinations tested (integer)
  - `tested_combinations`: Number of combinations actually tested (integer)
  - **Unique constraint** on (strategy_name, symbol) to prevent duplicate optimizations
  - **Index** on strategy_name and symbol for efficient lookups

## Fixed

- `/api/optimization/optimize` endpoint no longer returns 500 errors
- `saveOptimizedParams()` function can now persist results
- `getOptimizedParams()` and `getAllOptimizedParams()` can retrieve stored results
- `deleteOptimizedParams()` can clean up old results

## Files Modified

- `/workspace/src/data/db.ts` - Added `optimized_params` table to schema initialization

## Context

The optimizer module had four functions (`saveOptimizedParams`, `getOptimizedParams`, `getAllOptimizedParams`, `deleteOptimizedParams`) that all queried the `optimized_params` table. However, the database schema initialization was creating a table called `optimization_results` instead, causing all optimizer queries to fail with "table not found" errors when the endpoint tried to save or retrieve optimization results.

This fix ensures the database schema matches what the optimizer code expects, allowing users to run optimization workflows without errors.
