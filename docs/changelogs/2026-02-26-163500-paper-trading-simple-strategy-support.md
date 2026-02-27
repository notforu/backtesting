# Paper Trading Simple Strategy Support

**Date**: 2026-02-26 16:35
**Author**: dev-team

## Summary

Extended paper trading session creation to support both aggregation configs and simple single-strategy configurations. This allows users to launch paper trading runs directly from a single strategy without needing to create a full aggregation config first. Single strategies are internally wrapped as 1-sub-strategy aggregations for consistent engine handling.

## Changed

- **Backend session creation**: POST `/api/paper-trading/sessions` now accepts either `aggregationConfigId` (existing) or `strategyConfig` (new option) in the request body
- **Single strategy wrapping**: When `strategyConfig` is provided, it's internally converted to an `AggregateBacktestConfig` with `allocationMode: "single_strongest"` and `maxPositions: 1` for engine compatibility
- **Frontend session modal**: Added mode toggle to switch between "From Aggregation" and "Simple Strategy" creation flows
- **Frontend strategy selection**: Simple Strategy mode includes strategy dropdown, symbol input, timeframe/exchange/mode selects, and dynamically rendered parameter fields
- **Frontend types**: Updated `CreatePaperSessionRequest` type to make `aggregationConfigId` optional and add new `strategyConfig` field with full strategy configuration

## Added

- **Backend**: Support for `strategyConfig` parameter in `/api/paper-trading/sessions` POST request
- **Frontend**: Strategy dropdown component fetched from `/api/strategies` endpoint
- **Frontend**: Dynamic parameter form generation based on selected strategy definition
- **Frontend**: Mode toggle UI in CreatePaperSessionModal

## Files Modified

- `/src/api/routes/paper-trading.ts` - Added logic to handle `strategyConfig` parameter and wrap single strategies as aggregations
- `/src/web/types.ts` - Updated `CreatePaperSessionRequest` type with optional `aggregationConfigId` and new `strategyConfig` field
- `/src/web/components/PaperTradingPanel/CreatePaperSessionModal.tsx` - Added mode toggle, strategy selection UI, and dynamic param fields for simple strategy mode

## Context

This feature reduces friction for users testing strategies in paper trading. Previously, users had to:
1. Create a saved aggregation config (or use ad-hoc endpoint)
2. Then create a paper trading session from that config

Now users can directly create a paper trading session from any strategy, which is more intuitive for single-strategy testing workflows. The internal wrapping as a 1-sub-strategy aggregation maintains consistency with the existing engine and avoids duplicate code paths.
