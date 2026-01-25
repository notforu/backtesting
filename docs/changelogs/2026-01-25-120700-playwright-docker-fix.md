# Playwright Docker Fix

**Date**: 2026-01-25 12:07
**Author**: system

## Summary

Fixed Playwright MCP to work inside Docker and verified the History 500 error is resolved. Playwright can now successfully navigate to the frontend application running in Docker, and the backtest history endpoint returns data correctly.

## Changed

- **Dockerfile**: Added all Playwright system dependencies (libglib2.0, libnspr4, libnss3, libxss1, libatk1.0, libatk-bridge2.0, libcups2, libxkbcommon0, libpango-1.0, libpangoxft-1.0, libgconf-2-4, libxext6, libxrender1, libxinerama1, libxi6, libxrandr2, libxcursor1, libxtst6)
- **Dockerfile**: Pre-install Playwright and Chromium to `/opt/playwright-browsers`
- **Dockerfile**: Create symlink `/opt/google/chrome/chrome` → Playwright's Chromium for MCP compatibility
- **Dockerfile**: Transfer browser directory ownership to `claude` user
- **docker-compose.yml**: Added `cap_add: SYS_ADMIN` for Chrome sandboxing capability
- **docker-compose.yml**: Added `security_opt: seccomp=unconfined` for Chrome syscall access
- **docker-compose.yml**: Exposed ports 3000 (API), 5173/5174 (Vite), 9222 (Chrome DevTools Protocol)
- **vite.config.ts**: Added `host: true` to allow frontend access from outside container
- **src/api/routes/backtest.ts**: Enhanced error logging with request entry, response counts, and stack traces

## Added

- **.mcp.json**: Configured Playwright MCP with `--headless` flag and config file reference
- **playwright-mcp.config.json**: New configuration file with `chromiumSandbox: false` option to disable sandbox restrictions

## Fixed

- Playwright MCP now works inside Docker containers
- `/api/backtest/history` endpoint no longer returns 500 errors
- History widget displays backtest data correctly ("20 runs")
- Frontend is now accessible from host machine at `http://localhost:5173`

## Files Modified

- `/.docker/claude-sandbox/Dockerfile` - Added Playwright dependencies and browser setup
- `/.docker/claude-sandbox/docker-compose.yml` - Added security capabilities and port exposure
- `/vite.config.ts` - Added host configuration
- `/src/api/routes/backtest.ts` - Added comprehensive logging
- `/.mcp.json` - Configured Playwright MCP
- `/playwright-mcp.config.json` - New config file (created)

## Context

When running Claude and the backtesting platform in Docker, Playwright MCP couldn't access a Chrome/Chromium browser. This prevented automated testing and screenshots. The fixes ensure:

1. **Browser Availability**: Pre-installing Playwright/Chromium and creating a symlink ensures MCP finds the browser
2. **Security Permissions**: Docker capabilities and seccomp settings allow Chrome sandboxing to work
3. **Network Access**: Exposed ports and `host: true` setting allow the frontend to be accessed from the host machine
4. **Debugging**: Enhanced logging in the backtest endpoint helps diagnose similar issues in the future

Users can now run Claude with the backtesting platform in Docker and use Playwright features for testing, screenshots, and browser automation.
