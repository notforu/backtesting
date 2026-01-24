# Trade Badge Label Fix

**Date**: 2025-01-24 16:22
**Author**: main-claude

## Summary
Fixed trade action badge labels so arrows indicate position type (LONG=↑, SHORT=↓) regardless of open/close.

## Changed
- `src/web/types.ts` - Updated `getTradeActionLabel()` function

### Before
```
OPEN_LONG: 'Open Long ↑'
CLOSE_LONG: 'Close Long ↓'  ← Wrong, arrow showed market direction
OPEN_SHORT: 'Open Short ↓'
CLOSE_SHORT: 'Close Short ↑'  ← Wrong, arrow showed market direction
```

### After
```
OPEN_LONG: 'Open ↑'
CLOSE_LONG: 'Close ↑'  ← Arrow shows position type (was LONG)
OPEN_SHORT: 'Open ↓'
CLOSE_SHORT: 'Close ↓'  ← Arrow shows position type (was SHORT)
```

## Context
- Green badges for OPEN trades (entering position)
- Red badges for CLOSE trades (exiting position)
- ↑ arrow for LONG positions
- ↓ arrow for SHORT positions
- Defaults already correct: 1 month period, 1h resolution

## Files Modified
- `src/web/types.ts` - `getTradeActionLabel()` function
