# Fix Playwright Docker Config and Add Debugging

**Date**: 2026-01-25 10:30
**Author**: orchestrator

## Summary

Fixed multiple critical issues related to Docker environment configuration and debugging capabilities. Playwright MCP server was freezing when running in Docker due to GUI browser launch attempts. Docker containers weren't exposing necessary ports for development access. Added comprehensive logging to the history endpoint to help diagnose 500 errors.

## Changed

- `.mcp.json` - Added `--headless` flag to Playwright MCP arguments to prevent GUI browser launch in headless Docker environment
- `.docker/claude-sandbox/docker-compose.yml` - Added port mappings for API server (3000) and frontend development server (5173)
- `.docker/claude-sandbox/Dockerfile` - Added `-c` flag to ENTRYPOINT for run.sh execution to properly pass arguments to claude
- `src/api/routes/backtest.ts` - Added detailed info and error logging with stack traces to history endpoint for improved debugging

## Fixed

- Playwright MCP server freezing in Docker containers
- Port forwarding unavailable for development servers
- run.sh not receiving proper flags via Docker ENTRYPOINT
- Minimal error handling on history API endpoint making 500 errors difficult to diagnose

## Context

The issues were blocking effective development and testing in Docker environments:

1. **Playwright Freezing**: The Playwright MCP server attempted to launch a graphical browser inside Docker, causing it to hang indefinitely. Adding `--headless` mode allows it to function properly in headless environments.

2. **Port Forwarding**: Without explicit port mappings in docker-compose.yml, developers couldn't access the API server (port 3000) or frontend dev server (port 5173) from the host machine, and Playwright tests couldn't reach the UI.

3. **ENTRYPOINT Flag**: The Dockerfile was running `run.sh` without the `-c` flag that claude expects, preventing proper command execution in the container.

4. **Error Diagnostics**: The history endpoint lacked adequate logging, making it nearly impossible to diagnose why 500 errors were occurring. Added request entry point logging, response count logging, and full error stack trace logging.

## Files Modified

- `.mcp.json` - Playwright MCP configuration
- `.docker/claude-sandbox/docker-compose.yml` - Container port mappings
- `.docker/claude-sandbox/Dockerfile` - ENTRYPOINT configuration
- `src/api/routes/backtest.ts` - History endpoint logging
