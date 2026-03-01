# Fix: Strategy Loading in Production (Phase 0)

**Date:** 2026-03-01
**Type:** Bug Fix

## Problem

Production Docker container was copying raw `.ts` strategy files to `/app/strategies/` but running compiled JS via PM2 (plain Node.js, no TypeScript runtime). Node.js cannot dynamically `import()` `.ts` files without `tsx` or another TypeScript runtime, so strategies never loaded in production.

## Root Cause

- `src/strategy/loader.ts` hardcoded `.ts` extension for all strategy lookups
- `Dockerfile.prod` copied raw `.ts` files to the runtime image (`COPY ... ./strategies`)
- No compilation step existed for strategy files

## Changes

### 1. `tsconfig.strategies.json` (new file)

Added a separate TypeScript compilation config for the strategies folder:
- `rootDir: "."` and `outDir: "dist"` — compiles `strategies/x.ts` to `dist/strategies/x.js`
- Extends the main `tsconfig.json`
- Disables declarations and source maps (not needed for plugins)
- `noEmitOnError: false` — ensures JS output is produced even if strategies have pre-existing type errors (matching dev `tsx` behavior)
- `noUnusedLocals/Parameters: false` — relaxed for strategy files authored externally

### 2. `src/strategy/loader.ts`

Updated the loader to detect runtime mode and resolve the correct directory and file extension:
- Detects production vs development by checking whether `__dirname` contains `/dist/`
  - Dev (`tsx`): `__dirname` = `.../src/strategy` → loads `.ts` from `../../../strategies/`
  - Prod (compiled JS): `__dirname` = `.../dist/strategy` → loads `.js` from `../strategies/` (i.e., `dist/strategies/`)
- All functions updated: `loadStrategy`, `listStrategies`, `getStrategyDetails`, `strategyExists`

### 3. `package.json`

Updated `build` script to also compile strategies:
```
Before: "build": "tsc && vite build"
After:  "build": "tsc && tsc -p tsconfig.strategies.json && vite build"
```

### 4. `Dockerfile.prod`

Replaced raw strategy file copy with compiled JS:
```
Before: COPY --from=builder /app/strategies ./strategies
After:  COPY --from=builder /app/dist/strategies ./dist/strategies
```

The `dist/` directory is already copied on line 29 (`COPY --from=builder /app/dist ./dist`), so this line is technically redundant but kept for explicitness. Actually the `dist/strategies/` directory is included in the main `dist/` copy.

## Verification

- All 17 strategy `.ts` files compile to `.js` in `dist/strategies/`
- `import type` statements from `../src/strategy/base.js` are correctly erased in JS output
- Runtime imports (e.g., `import { SMA } from 'technicalindicators'`) are preserved in JS output
- Dev mode (`tsx`) continues to work unchanged
- `npm run typecheck` passes for all files touched in this change
