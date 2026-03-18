# Kill Switch Toggle — API + Database + UI

**Date**: 2026-03-18
**Type**: Feature

## Summary

Added kill switch toggle functionality for Paper Trading and Live Trading, with persistent database storage and UI controls on the Trading page.

## Changes

### Database

- `/migrations/017_add_platform_settings.sql` — new `platform_settings` table (key TEXT PK, value JSONB, updated_at TIMESTAMPTZ)
- `/src/data/db.ts` — added `getPlatformSetting(key)` and `setPlatformSetting(key, value)` exported functions

### API

- `/src/api/routes/settings.ts` — new route plugin:
  - `GET  /api/settings/kill-switch` — returns `{ pt, lt }` with `{ enabled, ddPercent }`
  - `PUT  /api/settings/kill-switch/pt` — update paper trading kill switch
  - `PUT  /api/settings/kill-switch/lt` — update live trading kill switch
  - Default: `{ enabled: true, ddPercent: 30 }` when no DB record exists
- `/src/api/server.ts` — registered `settingsRoutes`
- `/src/api/routes/index.ts` — exported `settingsRoutes`

### Frontend

- `/src/web/types.ts` — added `KillSwitchConfig`, `KillSwitchSettings`, `UpdateKillSwitchRequest` interfaces
- `/src/web/api/client.ts` — added `getKillSwitchSettings()`, `updatePtKillSwitch()`, `updateLtKillSwitch()` functions
- `/src/web/components/PaperTradingPage/KillSwitchPanel.tsx` — new React component with toggle switches and DD% inputs using React Query
- `/src/web/components/PaperTradingPage/PaperTradingPage.tsx` — `KillSwitchPanel` added at top of Trading page

### Tests

- `/src/data/__tests__/platform-settings.test.ts` — 5 tests for `getPlatformSetting`/`setPlatformSetting` (mocked pg Pool)
- `/src/api/routes/__tests__/settings.test.ts` — 12 tests covering all endpoints, defaults, validation, and error handling

## Notes

- Kill switch enforcement (halting trading on DD breach) is **not yet wired** — this PR only persists the settings. Integration with the paper trading engine loop is a follow-up task.
- Default values (`enabled: true, ddPercent: 30`) are returned when the key is absent from the database.
- All 1166 existing tests continue to pass; typecheck and lint are clean.
