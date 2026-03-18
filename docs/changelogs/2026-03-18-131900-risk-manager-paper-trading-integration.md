# RiskManager Integration into Paper Trading Engine

**Date:** 2026-03-18
**Type:** Feature

## Summary

Integrated the RiskManager module into the Paper Trading engine and session manager, adding trade validation, position tracking, and kill-switch protection to all live paper trading sessions.

## Changes

### `src/paper-trading/types.ts`
- Added two new event types to the `PaperTradingEvent` union:
  - `trade_rejected` — emitted when RiskManager blocks a trade entry
  - `kill_switch_triggered` — emitted when the drawdown kill switch fires

### `src/paper-trading/engine.ts`
- Added optional `riskManager?: RiskManager` private field
- Added `setRiskManager(rm: RiskManager): void` public method
- **Trade validation (Step 8):** Before opening a position, `validateTrade()` is called. If rejected, a `trade_rejected` event is emitted and the trade is skipped.
- **Position tracking:** After a trade opens, `onTradeOpened()` is called; after a trade closes (both long and short), `onTradeClosed()` is called with the realised PnL.
- **Kill switch check (after Step 9):** After equity is computed and persisted, `onEquityUpdate()` is called followed by `checkKillSwitch()`. If triggered: all open positions are force-closed, a `kill_switch_triggered` event is emitted, and the engine is paused via `this.pause()`.
- All RM checks are guarded with `if (this.riskManager)` — engine is fully backward compatible without a RiskManager attached.

### `src/paper-trading/session-manager.ts`
- Added imports: `RiskManager` from risk module, `getPlatformSetting` from data/db
- Added `createRiskManager(session)` private method that reads `kill_switch_pt` from `platform_settings` DB table (fallback: `{ enabled: true, ddPercent: 30 }`)
- `startSession()` and `resumeSession()` (when recreating engine from DB) now call `createRiskManager()` and `engine.setRiskManager(rm)` before starting
- `handleTelegramNotification()` handles `kill_switch_triggered`: sends an HTML-formatted alert message
- `persistEvent()` handles both `kill_switch_triggered` and `trade_rejected` event types for the DB event log

### `src/paper-trading/__tests__/risk-integration.test.ts` (new file)
14 tests covering the integration:
1. Backward compatibility — engine works without RiskManager
2. Engine executes trades without RiskManager
3. Trade rejected when kill switch is already triggered
4. Trade rejected when maxPositions limit reached
5. Trade rejected when maxTradeSize exceeded
6. Kill switch triggers when equity drops past threshold
7. Kill switch pauses the engine after triggering
8. Kill switch event has correct sessionId, reason, and equity
9. RiskManager position count increments when trade opens
10. RiskManager position count decrements via onTradeClosed
11. Engine calls onTradeClosed after closing via exit signal
12. RiskManager currentEquity updates after each tick
13. Trade proceeds normally when RiskManager permits
14. Kill switch does not trigger when disabled

### `src/paper-trading/__tests__/session-manager.test.ts` (updated)
- Added mock for `../../data/db.js` (`getPlatformSetting` returns null by default)
- Added `setRiskManager: vi.fn()` to the mock PaperTradingEngine to prevent "not a function" errors

## Kill Switch Configuration

Kill switch settings are read from `platform_settings` table with key `kill_switch_pt`:

```json
{ "enabled": true, "ddPercent": 30 }
```

- `enabled`: whether to check for kill switch at all
- `ddPercent`: drawdown percentage from peak equity that triggers the switch

If the key is absent, defaults to `{ enabled: true, ddPercent: 30 }`.

## RiskManager Defaults (per session)

| Setting | Value |
|---------|-------|
| `maxCapital` | `session.initialCapital` |
| `maxTradeSize` | `session.initialCapital * 0.5` (50%) |
| `maxPositions` | `aggregationConfig.maxPositions ?? 5` |
| `symbolWhitelist` | `[]` (all symbols allowed) |
