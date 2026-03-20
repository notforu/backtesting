# Deploy Pipeline Fix: Silent Deploy Failures & CSS Regression

**Date**: 2026-03-20 11:35
**Author**: docs-writer

## Summary

Fixed a critical production deployment pipeline bug that had been silently broken since infrastructure setup. GitHub Actions reported successful deploys while containers were never actually updated. Root cause: deploy script ran as `root` user from `/root/backtesting`, but running containers were started from `/home/claude/backtesting`. Docker Compose uses project directory to track containers, causing two separate container sets to coexist. Also fixed Tailwind v4 responsive CSS regression (33 utility classes missing) and added deploy diagnostics to prevent future silent failures.

## Fixed

### Deploy Pipeline (Critical)

1. **Path mismatch** — GitHub Action SSH'd as `root` user, used `~/backtesting` which resolved to `/root/backtesting`, but running containers were from `/home/claude/backtesting`. Both directories had separate container sets. Solution: Use absolute path `/home/claude/backtesting` in deploy script.

2. **Git safe.directory error** — Root user running `git pull` in `claude`-owned directory fails with git's safe.directory check. Solution: Added `git config --global --add safe.directory /home/claude/backtesting` workaround.

3. **Docker cache preventing rebuilds** — Frontend assets were cached in Docker layers, so code changes weren't reflected in production CSS/JS bundles. Solution: Added `CACHEBUST` build arg that receives git SHA, forcing Docker to rebuild frontend assets instead of using cached image layers.

4. **Stale containers running** — Old containers from `/root/backtesting` were still running alongside new ones from `/home/claude/backtesting`. Solution: Added `docker compose down && docker compose up -d --force-recreate api nginx` (preserves postgres volume to avoid password mismatch).

5. **No visibility into which version is running** — No way to verify if production server was updated. Solution: Added deploy diagnostics:
   - `/api/health` now includes `commit` field with git SHA from `BUILD_HASH`
   - New `/api/debug/assets` endpoint to list bundled CSS/JS files
   - `BUILD_HASH` injected at Docker build time

### Frontend CSS (Regression)

6. **Tailwind v4 responsive utilities missing** — Production CSS bundle was missing 33 responsive utility classes (sm:, md:, lg:) even though they were used in components. Root cause: Tailwind v4 `@config` and `@source` directives were never added to `index.css`, so Tailwind wasn't scanning component files for class discovery. Solution: Added Tailwind v4 directives to properly configure content scanning.

### Reliability

7. **Equity chart polling fallback** — Real-time equity updates depend on SSE (Server-Sent Events) WebSocket. If connection drops, chart is stale forever. Solution: Added `refetchInterval: 30000` (30s) as fallback in `usePaperEquity` hook.

## Root Cause Analysis

The deploy had been broken since infrastructure was originally set up. Here's what was happening:

1. Server at `5.223.56.226` has `/home/claude/backtesting/` with docker-compose.yml
2. Original setup started containers from there: `docker compose up -d`
3. GitHub Actions deploy script connected as `root`, used `~/backtesting` → `/root/backtesting`
4. Script did `git clone`, `docker build`, `docker compose up -d` all in `/root/backtesting`
5. Docker Compose uses project directory (env `COMPOSE_PROJECT_NAME` + directory path) to track which containers it manages
6. Result: `/root/backtesting` and `/home/claude/backtesting` each had their OWN separate container sets
7. Deploy script was redeploying `/root` containers, but users were hitting the running containers from `/home/claude`
8. Dev thought deploys were working (GitHub Action succeeded), but prod was never updating

**Why it wasn't caught earlier**: The production database is real (PostgreSQL persisting strategy backtests), so the "old" containers at `/home/claude` kept running fine. No crash, no error, just silent stale code.

## Changed

- Deploy workflow now uses absolute paths to guarantee correct container directory
- Git safe.directory configured before pulling
- Docker build includes cache-busting arg and commit hash tracking
- Deployment explicitly tears down and recreates containers (except postgres)

## Added

- `/api/health` includes `commit` field for deploy verification
- `/api/debug/assets` endpoint to list bundled CSS/JS files
- `src/api/build-info.ts` — Module to read git hash or BUILD_HASH file at runtime
- Tailwind v4 `@source` and `@config` directives to `index.css`
- 30s fallback polling in `usePaperEquity` hook

## Files Modified

| File | Changes |
|------|---------|
| `.github/workflows/deploy.yml` | Fixed project path to `/home/claude/backtesting`, added git safe.directory, CACHEBUST arg, force-recreate flag |
| `Dockerfile.prod` | Added CACHEBUST build arg, BUILD_HASH arg, wrote BUILD_HASH to file for runtime access |
| `src/api/build-info.ts` | New module: reads git SHA from BUILD_HASH file or fallback git command |
| `src/api/server.ts` | Added `commit` field to `/api/health` response, added `/api/debug/assets` endpoint |
| `src/web/index.css` | Added Tailwind v4 `@source` and `@config` directives for proper component scanning |
| `src/web/hooks/usePaperTrading.ts` | Added `refetchInterval: 30000` to `usePaperEquity` query as SSE fallback |

## Impact

- **Severity**: Critical — Deploying code to production had zero effect for weeks/months
- **User impact**: None (old containers kept running stably), but new features and bug fixes weren't reaching production
- **Regression risk**: Low — changes are primarily deployment infrastructure and build config; frontend changes (Tailwind directives, polling fallback) are backward compatible

## Context

This discovery came while investigating why the mobile responsiveness dashboard improvements from commit d6e9c6a (comprehensive mobile responsiveness overhaul) weren't visible on production. Investigation revealed the deploy pipeline itself was the blocker. The Tailwind v4 CSS regression was a cascading issue from the same root cause — if new CSS isn't being built, obviously it won't be in the bundle.

With these fixes, the full commit history (responsive dashboard, connector abstraction integration, financial test coverage, global digest scheduler) should now be live on production.
