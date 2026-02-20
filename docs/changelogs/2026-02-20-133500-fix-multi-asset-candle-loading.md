# Fix Multi-Asset Candle Loading Parameter Mismatch

**Date**: 2026-02-20 13:35
**Author**: docs-writer

## Summary
Fixed multi-asset per-asset candle loading that was broken due to a parameter name mismatch between frontend and backend. When clicking individual asset tabs in the multi-asset backtest view, the UI was stuck in indefinite loading because the frontend sent wrong query parameters and didn't properly extract the response payload.

## Changed
- `src/web/api/client.ts` - Fixed `getCandles()` function to match backend API contract

## Added
- None

## Fixed
- Frontend `getCandles()` now sends `start`/`end` query params instead of `startDate`/`endDate` to match backend Zod schema validation
- Frontend `getCandles()` now correctly extracts `response.candles` instead of treating raw response as Candle array
- Multi-asset backtest tabs now load individual asset candles instantly without hanging

## Files Modified
- `src/web/api/client.ts` - Updated URL parameter names and response extraction logic

## Context
The backend `/api/candles` route uses Zod schema expecting `start` and `end` parameters (in ms since epoch). The frontend was sending `startDate` and `endDate`, causing silent validation errors that prevented data from loading. Additionally, the backend returns an object `{ candles: [...], source: string, count: number }`, but the frontend was typed to expect `Candle[]` directly, causing response handling to fail even if params were correct.

This bug prevented users from exploring individual assets when running multi-asset backtests with the fr-spike-aggr strategy, as clicking an asset tab would show indefinite "Loading candles for ATOM..." state.
