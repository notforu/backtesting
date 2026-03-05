# Recovery Fixes: technicalindicators ESM Import Crash

**Date**: 2026-03-05 12:30
**Author**: claude-code

## Summary

Fixed a critical ESM import crash in `technicalindicators` v3.1.0 that prevented all paper trading sessions from running. The npm package's broken entry point was resolved via a postinstall symlink. Also fixed dev server static file resolution for Vite compatibility and restored aggregation configs after database loss.

## Changed

- `package.json` - Added postinstall script to create `lib -> dist` symlink for technicalindicators compatibility
- `src/api/server.ts` - Added fallback path resolution for static frontend in dev mode (tsx watch)
- `scripts/cache-funding-rates.ts` - Minor updates (verification needed)

## Added

- `scripts/restore-aggregation-configs.ts` - New script to restore all 8 aggregation configs (4 V2 from production + 4 V1 from original)
- `strategies/fr-gradient-momentum.ts` - New FR scalping strategy (gradient momentum variant)
- `strategies/fr-regime-momentum.ts` - New FR scalping strategy (regime momentum variant)
- `docs/strategies/2026-03-05-140000-fr-regime-scalping-strategies.md` - Strategy documentation for both scalping approaches

## Fixed

1. **technicalindicators ESM export crash** - v3.1.0 has broken ESM entry point (`index.js` exports from `./lib/index.js` but `lib/` is not published). Postinstall script creates symlink so ATR and other indicators load correctly.

2. **Dev server static file not found** - When running API via `tsx watch`, `__dirname` resolves to `src/api/` instead of `dist/api/`, causing 404 on frontend assets. Fallback checks both `../web` (production) and `../../dist/web` (dev) to match Vite 7.3.1 output structure.

3. **Paper trading session failures** - All 5 sessions recovered from error state to running after technicalindicators fix applied.

4. **Missing aggregation configs** - Restored all 8 configs via new restore script (4 V2 from production paper trading + 4 V1 legacy).

## Files Modified

- `/package.json` - postinstall script
- `/src/api/server.ts` - fallback static path resolution
- `/scripts/cache-funding-rates.ts` - updated (details pending)
- `/scripts/restore-aggregation-configs.ts` - new
- `/strategies/fr-gradient-momentum.ts` - new
- `/strategies/fr-regime-momentum.ts` - new
- `/docs/strategies/2026-03-05-140000-fr-regime-scalping-strategies.md` - new

## Context

**Root causes:**
1. The `technicalindicators` npm package v3.1.0 published with a broken ESM entry point that references unpublished files. This was the blocker for all paper trading resume attempts (`"does not provide an export named 'ATR'"` error).

2. Vite 7.3.1 crashes with Bus error on ARM64/Docker environments, so dev mode must use `tsx watch` instead. This changes the `__dirname` resolution path for static assets.

3. Database was lost during recovery; all aggregation configs needed restoration to resume paper trading with the same configurations.

**Why this matters:**
- Paper trading infrastructure depends on technicalindicators for ATR-based scalping strategies
- Dev server now works properly for local testing (critical for iteration)
- Aggregation configs represent months of optimization work and needed preservation

**Next steps:**
- Monitor paper trading sessions for stability
- Validate FR scalping strategies perform as expected
- Document postinstall workaround if technicalindicators issue is long-term
