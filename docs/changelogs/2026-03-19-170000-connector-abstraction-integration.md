# Connector Abstraction Integration

**Date**: 2026-03-19 17:00
**Author**: be-dev

## Summary

Integrated the existing IConnector abstraction into the Paper Trading Engine via TDD. Trades are now routed through connectors (PaperConnector for simulation, BybitConnector for live trading in future). The architecture uses the Adapter Pattern — connectors execute orders while MultiSymbolPortfolio remains a synchronous state mirror, avoiding async overhead for high-frequency portfolio reads while enabling real exchange execution.

## Changed

- **Engine trade execution**: All open/close trades now route through connector when present, with fallback to legacy direct portfolio path for backward compatibility
- **Session initialization**: Sessions now create and connect the appropriate connector (paper/bybit) based on `connectorType` setting
- **Fill simulation**: PaperConnector.setPrice() called on every price update for accurate fill simulation
- **Force close behavior**: `forceClosePositions()` routes through connector.closeAllPositions() when present
- **Error handling**: Rejected or errored connector orders don't touch portfolio state

## Added

- `setConnector()` method in Paper Trading Engine
- `executeOpen()` and `executeClose()` private helpers in engine for connector routing
- `createConnector()` factory function in session manager
- Migration 018: `connector_type` column in `paper_sessions` table (default 'paper')
- `connectorType` field in PaperSession database type
- API parameter for `connectorType` when creating sessions
- Frontend session types updated with `connectorType`
- **17 new engine tests** (`engine-connector.test.ts`): order routing, fill mirroring, rejection handling, force close, backward compatibility
- **4 new session manager tests** (`session-manager.test.ts`): connector creation, connection/disconnection lifecycle
- **6+ new persistence tests** (`persistence.test.ts`): connector_type database field validation

## Fixed

- Ensured connector fill results properly mirror to portfolio state without duplicating trades
- Connector errors no longer corrupt portfolio state (rejected orders don't execute)
- Session cleanup now properly disconnects connectors to prevent resource leaks

## Files Modified

- `src/paper-trading/engine.ts` - Added connector routing via setConnector(), executeOpen(), executeClose()
- `src/paper-trading/session-manager.ts` - Creates and manages connector lifecycle
- `src/db/migrations/018-add-connector-type.ts` - New migration for connector_type column
- `src/db/types.ts` - Updated PaperSession type with connectorType field
- `src/api/sessions.ts` - API route accepts connectorType parameter
- `src/web/types.ts` - Frontend session types updated
- `tests/engine-connector.test.ts` - New test file with 17 tests
- `tests/session-manager.test.ts` - New connector wiring tests
- `tests/persistence.test.ts` - New connector_type database tests

## Context

The IConnector abstraction existed but was unused in the Paper Trading Engine. This integration enables:

1. **Gradual migration** from simulation to live trading (swap PaperConnector → BybitConnector)
2. **Proper simulation** of real exchange behavior (slippage, fees, rejection handling)
3. **Clean separation** between backtesting logic (MultiSymbolPortfolio) and trade execution (IConnector)
4. **No async overhead** for frequent portfolio state reads (~20/tick) while supporting async connectors

The Adapter Pattern ensures connectors are optional (backward compatible) while enabling future exchange integration without modifying engine core logic.

**Test Coverage**: TDD approach required writing 27+ tests before implementation. All tests passing (1543 total in suite).

**Next Steps**: Bybit connector support requires credentials storage mechanism (not yet implemented — currently throws "not yet supported" error).
