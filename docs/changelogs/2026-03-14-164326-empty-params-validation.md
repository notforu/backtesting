# Validation: Prevent Saving Strategy Config With Empty Params

**Date:** 2026-03-14

## Summary

Added validation to `findOrCreateStrategyConfig()` that throws an informative error when params remain empty after attempting to load strategy defaults. Previously the function would silently persist a config with an empty `params` object if the strategy was not found.

## Changes

### `src/data/strategy-config.ts`

- After the try/catch block that loads default params from the strategy definition, added a second guard:
  ```
  if (Object.keys(finalParams).length === 0) {
    throw new Error(
      `Cannot create strategy config for "${config.strategyName}" with empty params. ...`
    );
  }
  ```
- If the strategy is found and returns non-empty defaults, the function proceeds normally.
- If the strategy is not found OR returns empty defaults, an error is thrown before any DB query runs.

### `src/api/routes/strategy-configs.ts`

- `POST /api/strategy-configs` handler: added a check on the thrown error message; returns HTTP 400 instead of 500 for the empty-params error.

### `src/api/routes/aggregations.ts`

- `POST /api/aggregations` handler: same 400 treatment for the empty-params error propagated from `findOrCreateStrategyConfig`.

## Tests

### `src/data/__tests__/strategy-config.test.ts`

Added mocks for `../../strategy/loader.js` and `../../strategy/base.js`. Updated three existing tests that passed `params: {}` for unrelated purposes to use explicit params. Added four new tests to `findOrCreateStrategyConfig` describe block:

- Succeeds with empty params when strategy defines defaults (loadStrategy returns strategy, getDefaultParams returns non-empty object).
- Throws when params empty and strategy not found (loadStrategy rejects).
- Throws when params empty and strategy returns empty defaults (getDefaultParams returns `{}`).
- Succeeds with explicit non-empty params without ever calling loadStrategy.

### `src/api/routes/__tests__/strategy-configs.test.ts`

- Renamed "returns 500 when service throws" to "returns 500 when service throws a non-validation error".
- Added "returns 400 when service throws empty params error".

### `src/api/routes/__tests__/aggregations.test.ts`

- Renamed existing 500 test to clarify it covers non-validation errors.
- Added "returns 400 when findOrCreateStrategyConfig throws empty params error".

## Test results

All 1005 tests pass across 26 test files.
