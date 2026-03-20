# Tailwind v4 Responsive Fix & Equity Chart Refresh

**Date**: 2026-03-20 07:45
**Author**: docs-writer

## Summary
Fixed two production UI bugs: Tailwind v4 responsive CSS classes missing from production build, and equity chart not refreshing on paper trading page.

## Fixed
1. **Tailwind v4 responsive breakpoints missing** - The `@tailwindcss/postcss` v4 plugin was not scanning component files for class names. Added `@source "../../"` and `@config "../../tailwind.config.js"` directives to `src/web/index.css`. This restored sm: (13 classes), md: (16 classes), and lg: (4 classes) responsive breakpoints to the production CSS bundle. Previously only xl: was present, making ALL mobile responsive layouts completely broken.

2. **Equity chart blank on paper trading page** - The `usePaperEquity()` hook in `src/web/hooks/usePaperTrading.ts` was missing `refetchInterval`, causing equity snapshots to be cached indefinitely without polling. Added `refetchInterval: 30000` to match the pattern of other hooks in the file. SSE invalidation already existed but this provides a fallback when SSE is not connected.

## Files Modified
- `src/web/index.css` - Added @source and @config Tailwind v4 directives
- `src/web/hooks/usePaperTrading.ts` - Added refetchInterval: 30000 to usePaperEquity

## Context
The mobile responsive overhaul (commit d6e9c6a) added 63+ responsive Tailwind classes across 6 components, but none of them were included in the production CSS because Tailwind v4 changed how it discovers content files. The @source directive explicitly tells Tailwind v4 where to scan.
