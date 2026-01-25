# Docker Dev Server Issue Discovery

**Date**: 2026-01-25 12:22 (Local Time)
**Severity**: Critical for Development Workflow

## Issue Description

When Claude runs inside Docker container and the dev server (`npm run dev`) is started inside Docker:
- The frontend appears to work when accessed from host machine at `http://localhost:5173`
- However, **changes may not be visible** to the user on the host machine
- API calls may fail with 500 errors or show stale data
- The same API works perfectly when tested from inside the container (via curl or Playwright)

## Root Cause (Suspected)

The issue is likely related to:
1. Docker networking/port forwarding not properly exposing Vite's hot reload
2. Vite's WebSocket connection for HMR may not work across Docker boundary
3. Browser caching combined with proxy issues

## Evidence

- Playwright tests run inside Docker showed History widget with "20 runs" ✓
- curl from inside Docker returned correct API data ✓
- User's browser on host machine showed 500 error on same endpoint ✗
- After running `npm run dev` on **host machine** instead of Docker, everything worked ✓

## Current Workaround

**Run the dev server on the host machine, not inside Docker:**

```bash
# On host machine (not inside Docker container)
cd /path/to/project
npm run dev
```

Then access `http://localhost:5173` from host browser.

## Docker Configuration (for reference)

Current docker-compose.yml has:
- Ports exposed: 3000, 5173, 5174, 9222
- `cap_add: SYS_ADMIN` for Chrome sandboxing
- `security_opt: seccomp=unconfined`

vite.config.ts has:
- `host: true` to allow external access

## TODO

- [ ] Investigate why Vite HMR doesn't work properly across Docker boundary
- [ ] Consider using Docker's `network_mode: host` as alternative
- [ ] Test with different Docker networking configurations
- [ ] Add startup script that detects environment and suggests correct approach

## Impact

This affects the development workflow when:
- Claude is running in Docker (permissionless mode)
- User wants to see UI changes in their host browser
- Testing requires visual verification on host machine
