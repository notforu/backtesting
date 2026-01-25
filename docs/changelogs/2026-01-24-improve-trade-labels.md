# Improve Trade Action Labels for Clarity

**Date**: 2026-01-24
**Author**: docs-writer

## Summary
Enhanced trade action labels in the UI to be more descriptive and clearer about position type. Updated `getTradeActionLabel()` function to explicitly show whether trades are opening/closing long or short positions.

## Changed
- Trade action labels now include position type (Long/Short) for improved clarity
- Previously showed: 'Open ↑', 'Close ↑', 'Open ↓', 'Close ↓'
- Now shows: 'Open Long ↑', 'Close Long ↑', 'Open Short ↓', 'Close Short ↓'

## Files Modified
- `src/web/types.ts` - Updated `getTradeActionLabel()` function to include Long/Short descriptors

## Context
The previous labels were ambiguous - users had to rely on the arrow direction to understand if a trade was for a long or short position. Adding explicit "Long" and "Short" labels makes the trades table more immediately readable and reduces cognitive load when reviewing trade history.
