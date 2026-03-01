/**
 * Backtesting API Server
 * Entry point for the REST API
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { backtestRoutes } from './routes/backtest.js';
import { strategyRoutes } from './routes/strategies.js';
import { candleRoutes } from './routes/candles.js';
import { optimizeRoutes } from './routes/optimize.js';
import { polymarketRoutes } from './routes/polymarket.js';
import { scanRoutes } from './routes/scan.js';
import { fundingRateRoutes } from './routes/funding-rates.js';
import { aggregationRoutes } from './routes/aggregations.js';
import { paperTradingRoutes } from './routes/paper-trading.js';
import { priceStreamRoutes } from './routes/price-stream.js';
import { initDb, closeDb } from '../data/db.js';
import { sessionManager } from '../paper-trading/session-manager.js';

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

// Restore any paper trading sessions that were running at last shutdown
await sessionManager.restoreActiveSessions();

// Health check endpoint
fastify.get('/api/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  };
});

// Register routes
await fastify.register(backtestRoutes);
await fastify.register(strategyRoutes);
await fastify.register(candleRoutes);
await fastify.register(optimizeRoutes);
await fastify.register(polymarketRoutes);
await fastify.register(scanRoutes);
await fastify.register(fundingRateRoutes);
await fastify.register(aggregationRoutes);
await fastify.register(paperTradingRoutes);
await fastify.register(priceStreamRoutes);

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

  GET    /api/polymarket/markets         - Browse/search Polymarket markets
  GET    /api/polymarket/markets/:slug   - Get market details by slug
  GET    /api/polymarket/categories      - List available market categories
`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
