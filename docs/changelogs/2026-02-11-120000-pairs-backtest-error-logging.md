# Pairs Backtest Error Logging

**Date**: 2026-02-11 12:00
**Author**: docs-writer

## Summary
Added comprehensive error logging to the `/api/backtest/pairs/run` route to improve debugging of 500 errors in pairs backtesting. The catch block now logs errors with full stack traces, matching the established pattern in the `/api/backtest/history` route.

## Changed
- Enhanced error handling in `/api/backtest/pairs/run` route to log errors with `fastify.log.error()`

## Added
- Full stack trace logging for errors during pairs backtest execution
- Consistency with error logging patterns across API routes

## Fixed
- Improved error visibility for pairs backtesting 500 errors

## Files Modified
- `src/api/routes/backtest.ts` - Added error logging with stack traces in pairs backtest catch block

## Context
When pairs backtesting routes encounter errors, they now log the complete error with stack trace. This follows the pattern already established in the `/api/backtest/history` route and will help developers quickly identify and fix issues causing 500 responses during pairs strategy backtests.
