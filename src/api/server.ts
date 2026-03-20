/**
 * Backtesting API Server
 * Entry point for the REST API
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import Fastify from 'fastify';
import { BUILD_HASH } from './build-info.js';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { backtestRoutes } from './routes/backtest.js';
import { strategyRoutes } from './routes/strategies.js';
import { candleRoutes } from './routes/candles.js';
import { optimizeRoutes } from './routes/optimize.js';
import { scanRoutes } from './routes/scan.js';
import { fundingRateRoutes } from './routes/funding-rates.js';
import { aggregationRoutes } from './routes/aggregations.js';
import { paperTradingRoutes } from './routes/paper-trading.js';
import { priceStreamRoutes } from './routes/price-stream.js';
import { configExportRoutes } from './routes/config-export.js';
import { strategyConfigRoutes } from './routes/strategy-configs.js';
import { settingsRoutes } from './routes/settings.js';
import { initDb, closeDb } from '../data/db.js';
import { sessionManager } from '../paper-trading/session-manager.js';
import { ensureRootUser, authHook } from '../auth/index.js';
import { authRoutes } from './routes/auth.js';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register CORS
await fastify.register(cors, {
  origin: true,
});

// Initialize database connection (run migrations)
await initDb();

// Ensure root user has the correct password hash (uses ROOT_PASSWORD env var, default: "admin")
await ensureRootUser();

// Register global auth hook before routes
fastify.addHook('onRequest', authHook);

// Restore any paper trading sessions that were running at last shutdown
await sessionManager.restoreActiveSessions();

// Health check endpoint
fastify.get('/api/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    commit: BUILD_HASH,
  };
});

// Diagnostic endpoint: list built frontend assets
fastify.get('/api/debug/assets', async () => {
  try {
    const __filename2 = fileURLToPath(import.meta.url);
    const __dirname2 = path.dirname(__filename2);
    const webDist = path.join(__dirname2, '..', 'web', 'assets');
    const webDistFallback = path.join(__dirname2, '..', '..', 'dist', 'web', 'assets');
    const assetsDir = existsSync(webDist) ? webDist : existsSync(webDistFallback) ? webDistFallback : null;
    if (!assetsDir) return { error: 'assets dir not found', checked: [webDist, webDistFallback] };
    const files = readdirSync(assetsDir);
    return { assetsDir, files };
  } catch (e: unknown) {
    return { error: String(e) };
  }
});

// Register routes
await fastify.register(authRoutes);
await fastify.register(backtestRoutes);
await fastify.register(strategyRoutes);
await fastify.register(candleRoutes);
await fastify.register(optimizeRoutes);
await fastify.register(scanRoutes);
await fastify.register(fundingRateRoutes);
await fastify.register(aggregationRoutes);
await fastify.register(paperTradingRoutes);
await fastify.register(priceStreamRoutes);
await fastify.register(configExportRoutes);
await fastify.register(strategyConfigRoutes);
await fastify.register(settingsRoutes);

// Serve frontend static files in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Compiled server lives at dist/api/server.js, so ../web resolves to dist/web
// In dev mode (tsx), __dirname is src/api — fall back to project root dist/web
const webDistPath = path.join(__dirname, '..', 'web');
const webDistFallback = path.join(__dirname, '..', '..', 'dist', 'web');

const resolvedWebDir = existsSync(path.join(webDistPath, 'index.html'))
  ? webDistPath
  : existsSync(path.join(webDistFallback, 'index.html'))
    ? webDistFallback
    : null;

if (resolvedWebDir) {
  await fastify.register(fastifyStatic, {
    root: resolvedWebDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: serve index.html for any non-API, non-file route
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  // Pause all active paper trading engines before closing DB
  await sessionManager.shutdownAll();
  await closeDb();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    console.log(`
╔════════════════════════════════════════════════════════╗
║         Backtesting API Server Started                 ║
╠════════════════════════════════════════════════════════╣
║  URL:     http://localhost:${port}                       ║
║  Health:  http://localhost:${port}/api/health            ║
║  Docs:    See /docs/ARCHITECTURE.md                    ║
╚════════════════════════════════════════════════════════╝

Available endpoints:
  POST   /api/backtest/run      - Run a new backtest
  GET    /api/backtest/:id      - Get backtest result
  GET    /api/backtest/history  - List all runs
  DELETE /api/backtest/:id      - Delete a run

  GET    /api/strategies        - List all strategies
  GET    /api/strategies/:name  - Get strategy details

  GET    /api/candles           - Get candle data
  GET    /api/exchanges         - List exchanges
  GET    /api/symbols           - List symbols

  POST   /api/optimize          - Start optimization job
  GET    /api/optimize/:strategyName/:symbol/:timeframe - Get optimization history
  GET    /api/optimize/:strategyName/:symbol/:timeframe/latest - Get latest optimization
  GET    /api/optimize/all      - List all optimizations
  DELETE /api/optimize/:strategyName/:symbol/:timeframe - Delete all runs
  DELETE /api/optimize/id/:id    - Delete specific run
`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
