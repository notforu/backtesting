#!/usr/bin/env node
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}
import { initDb, closeDb } from '../src/data/db.js';

async function main() {
  await initDb();
  console.log('Database initialized successfully (all migrations applied)');
  await closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
