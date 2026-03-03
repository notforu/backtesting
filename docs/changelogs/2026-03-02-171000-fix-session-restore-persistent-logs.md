# Fix: Session Auto-Restore and Persistent Docker Logging

**Date**: 2026-03-02 17:10
**Author**: claude-code

## Summary

Fixed two critical reliability issues: (1) paper trading sessions are now auto-restored after container restart instead of being silently lost, and (2) Docker container logs now persist across restarts with automatic rotation instead of being discarded.

## Changed

### Paper Trading Session Management (`src/paper-trading/session-manager.ts`)
- `shutdownAll()` now persists session state to database before clearing in-memory engines
- Sessions are marked as `paused` in DB on shutdown (not just lost)
- `restoreActiveSessions()` expanded to restore both `running` and `paused` sessions
- Uses `resumeSession()` for restoration, which recreates engines from stored state

### Docker Production Logging (`docker-compose.prod.yml`)
- Configured `json-file` logging driver with rotation for all 3 services
- **API service**: 10 files × 50MB = 500MB max retention (high volume)
- **Postgres service**: 5 files × 10MB = 50MB max retention
- **Nginx service**: 5 files × 10MB = 50MB max retention
- Logs now persist across `docker compose down` and auto-rotate by file size

## Added

- N/A (bug fixes only)

## Fixed

- Session data loss on container restart (sessions now marked `paused` and restored)
- Lost Docker logs on container restart (now persisted with rotation)

## Files Modified

- `src/paper-trading/session-manager.ts` - Session shutdown/restore logic
- `docker-compose.prod.yml` - Logging driver configuration

## Context

**Session Auto-Restore Issue**: When containers restarted, users lost all running paper trading sessions. Root cause: `shutdownAll()` only cleared in-memory state without writing to DB, so `restoreActiveSessions()` on startup found no sessions to restore (looked only for `status === 'running'`, missing paused sessions).

**Persistent Logging Issue**: Docker containers use unbounded default logging by default, which doesn't survive `docker compose down`. Operators had no way to review logs from crashes or failures after restarts. Fix uses `json-file` driver with size-based rotation (industry standard for production Docker logging).

Both fixes are critical for production reliability and observability.
