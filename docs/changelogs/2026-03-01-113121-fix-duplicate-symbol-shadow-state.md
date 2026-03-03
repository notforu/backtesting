# Fix: Duplicate Symbol Shadow State Pollution in Paper Trading Engine

**Date:** 2026-03-01
**Type:** Bug Fix (TDD)

## Problem

When two sub-strategies in a paper trading session traded the **same symbol** on different timeframes (e.g., `BTC/USDT 4h` and `BTC/USDT 1h`), both adapter instances received the same shadow positions on tick resume. This caused the 1h adapter to erroneously believe it had an open position (from the 4h adapter's DB record), leading to:

- Incorrect position state in strategies (false `ctx.longPosition` / `ctx.shortPosition`)
- Missed entry signals from the unrelated sub-strategy
- Potential duplicate or conflicting exit signals

**Root cause:** Shadow state restore in `engine.ts` filtered DB positions by `symbol` only:
```typescript
// Before fix (WRONG):
const matchingPositions = dbPositions.filter(p => p.symbol === subConfig.symbol);
```

## Solution

Added a `subStrategyKey` field (`"strategyName:symbol:timeframe"`) that uniquely identifies each adapter instance. The shadow state restore now filters by this key, so each adapter only sees its own positions.

## Changes

### `src/paper-trading/types.ts`
- Added `subStrategyKey: string` field to `PaperPosition` interface
- JSDoc: `"strategyName:symbol:timeframe"` format description

### `src/paper-trading/db.ts`
- Added `sub_strategy_key: string` to `PaperPositionRow` interface
- Updated `rowToPosition` mapper to include `subStrategyKey`
- Updated `savePaperPosition` SQL to store the key in the new column
- Changed `ON CONFLICT` constraint from `(session_id, symbol, direction)` to `(session_id, sub_strategy_key, direction)`
- Updated `deletePaperPosition` signature: second param is now `subStrategyKey` (not `symbol`)

### `src/paper-trading/engine.ts`
- Shadow state restore now filters: `dbPositions.filter(p => p.subStrategyKey === subKey)` where `subKey = "${strategyName}:${symbol}:${timeframe}"`
- `savePaperPosition` calls now include `subStrategyKey`
- Both `deletePaperPosition` calls in exit handler use the inline key
- `forceCloseAllPositions` uses `pos.subStrategyKey`

### `migrations/008_add_sub_strategy_key_to_positions.sql` (new file)
```sql
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS sub_strategy_key TEXT NOT NULL DEFAULT '';
ALTER TABLE paper_positions DROP CONSTRAINT IF EXISTS paper_positions_session_id_symbol_direction_key;
ALTER TABLE paper_positions
  ADD CONSTRAINT paper_positions_session_id_sub_strategy_key_direction_key
  UNIQUE (session_id, sub_strategy_key, direction);
```

### `src/paper-trading/__tests__/engine.test.ts`
- Updated all `PaperPosition` fixtures to include `subStrategyKey`
- Updated `deletePaperPosition` assertions to expect subStrategyKey format
- Added assertion in test 12 (open short) for `subStrategyKey`
- **Test 20 (new):** "duplicate symbol: two strategies on same symbol get independent shadow state" - verifies exactly one adapter sees a long position (the 4h one with a DB record) and the other sees flat
- **Test 21 (new):** "duplicate symbol: opened position is saved with the correct subStrategyKey" - verifies the key is non-empty and matches the `strategyName:symbol:timeframe` format

## Test Results

All 24 engine tests pass (including 2 new tests). TypeScript compiles cleanly.

```
24 tests passed
0 failed
```
