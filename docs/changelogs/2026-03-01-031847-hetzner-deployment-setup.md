# Hetzner Deployment Setup

**Date**: 2026-03-01 03:18:47
**Author**: system

## Summary
Added production deployment infrastructure for deploying the backtesting platform to Hetzner VDS (Ubuntu 24.04). Includes automatic Docker setup, firewall configuration, environment generation, and health checks.

## Added
- `scripts/deploy-hetzner.sh` - Fully automated deployment script for fresh Ubuntu 24.04 servers
  - Installs Docker and Docker Compose
  - Configures UFW firewall (allows SSH on port 22, HTTP on port 80)
  - Generates secure `.env.prod` with randomly generated Postgres password
  - Builds and deploys via `docker-compose.prod.yml`
  - Waits for health check and displays dashboard URL
- `@fastify/static` npm dependency for serving compiled React frontend

## Changed
- `src/api/server.ts` - Added static file serving for production
  - Imports `@fastify/static` plugin
  - Serves compiled React app from `dist/web/` directory
  - Implements SPA fallback: routes all non-API, non-file requests to `index.html` for client-side routing
  - Checks if `dist/web` exists before registering (safe for development)
- `package.json` - Added `@fastify/static` dependency (v9.0.0)

## Files Modified
- `src/api/server.ts` - Static file serving and SPA fallback
- `package.json` - Added @fastify/static dependency
- `package-lock.json` - Lockfile updated

## Context
The deployment script automates all steps needed to get the platform running on a fresh Hetzner VDS:
1. Updates system packages
2. Installs Docker and Docker Compose
3. Hardens firewall (deny all except SSH and HTTP)
4. Generates production environment variables with secure random Postgres password
5. Builds Docker images and starts services
6. Validates deployment with health checks
7. Displays dashboard URL for immediate access

The server changes enable the production Docker container to serve the entire application (API + frontend) from a single Fastify process, with proper SPA routing support.

**Usage**: `sudo bash scripts/deploy-hetzner.sh`

**Requires**: Fresh Ubuntu 24.04 VDS with root access
