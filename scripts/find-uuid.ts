/**
 * Find which table(s) contain a given UUID across local and prod databases.
 *
 * URL /backtesting/:id → backtest_results (loaded via GET /backtest/:id)
 * URL /configs/aggregation/:id → aggregation_configs
 * URL /configs/strategy/:id → strategy_configs
 *
 * Since SSH is disabled for the claude user on prod, we query prod via the
 * public API endpoint for backtest lookups, and do a direct DB check locally.
 *
 * Usage:
 *   npx tsx scripts/find-uuid.ts [uuid]
 *   npx tsx scripts/find-uuid.ts b35b694c-264b-4b80-bce5-b544854840c3
 */

import { getPool } from '../src/data/db.js';

const UUID = process.argv[2] ?? 'b35b694c-264b-4b80-bce5-b544854840c3';
const PROD_API_BASE = 'http://5.223.56.226/api';

// ---------------------------------------------------------------------------
// Local DB checks
// ---------------------------------------------------------------------------

interface TableHit {
  table: string;
  column: string;
  row: Record<string, unknown> | null;
}

async function checkLocalDb(uuid: string): Promise<TableHit[]> {
  const pool = getPool();
  const hits: TableHit[] = [];

  const checks: Array<{ table: string; column: string; selectCols: string }> = [
    { table: 'backtest_results', column: 'id', selectCols: 'id, strategy, symbol, created_at, aggregation_id' },
    { table: 'aggregation_configs', column: 'id', selectCols: 'id, name, created_at' },
    { table: 'aggregation_runs', column: 'id', selectCols: 'id, aggregation_config_id, created_at' },
    { table: 'aggregation_runs', column: 'aggregation_config_id', selectCols: 'id, aggregation_config_id, created_at' },
    { table: 'backtest_results', column: 'aggregation_id', selectCols: 'id, strategy, symbol, created_at, aggregation_id' },
  ];

  for (const { table, column, selectCols } of checks) {
    try {
      const res = await pool.query(
        `SELECT ${selectCols} FROM ${table} WHERE ${column} = $1 LIMIT 5`,
        [uuid]
      );
      if (res.rows.length > 0) {
        hits.push({ table, column, row: res.rows[0] });
        console.log(`  LOCAL HIT: ${table}.${column}`);
        console.log('  ', JSON.stringify(res.rows[0], null, 2));
        if (res.rows.length > 1) {
          console.log(`  ... and ${res.rows.length - 1} more row(s)`);
        }
      } else {
        console.log(`  LOCAL MISS: ${table}.${column}`);
      }
    } catch (err: unknown) {
      // Table might not exist in local schema — skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  LOCAL ERROR checking ${table}.${column}: ${msg}`);
    }
  }

  await pool.end();
  return hits;
}

// ---------------------------------------------------------------------------
// Prod API checks (HTTP — SSH disabled for claude user)
// ---------------------------------------------------------------------------

async function checkProdApi(uuid: string): Promise<void> {
  console.log('\n=== Checking PROD via public API ===');

  // 1. Try fetching as a backtest result: GET /backtest/:id
  try {
    const url = `${PROD_API_BASE}/backtest/${uuid}`;
    console.log(`  GET ${url}`);
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      console.log(`  PROD HIT: backtest_results (id=${uuid})`);
      console.log('  strategy:', data.strategy ?? data.config);
      console.log('  symbol  :', (data as any).symbol ?? (data as any).config?.symbol);
      console.log('  created :', (data as any).createdAt ?? (data as any).created_at);
    } else {
      const body = await res.text().catch(() => '');
      console.log(`  PROD MISS: backtest_results — HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
  } catch (err: unknown) {
    console.log('  PROD ERROR (backtest_results):', err instanceof Error ? err.message : String(err));
  }

  // 2. Try fetching aggregation config: GET /aggregations/configs/:id
  try {
    const url = `${PROD_API_BASE}/aggregations/configs/${uuid}`;
    console.log(`  GET ${url}`);
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      console.log(`  PROD HIT: aggregation_configs (id=${uuid})`);
      console.log('  name:', data.name);
      console.log('  row :', JSON.stringify(data).slice(0, 200));
    } else {
      const body = await res.text().catch(() => '');
      console.log(`  PROD MISS: aggregation_configs — HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
  } catch (err: unknown) {
    console.log('  PROD ERROR (aggregation_configs):', err instanceof Error ? err.message : String(err));
  }

  // 3. Try fetching aggregation run via history endpoint filtered by id
  //    There is no direct aggregation_runs endpoint, so check history
  try {
    const url = `${PROD_API_BASE}/backtest/history?limit=1&runId=${uuid}`;
    console.log(`  GET ${url} (aggregation run check via history)`);
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as any;
      const runs = data.runs ?? data.results ?? data.items ?? [];
      const match = Array.isArray(runs) ? runs.find((r: any) => r.id === uuid) : null;
      if (match) {
        console.log(`  PROD HIT: history/backtest_results via runId filter (id=${uuid})`);
        console.log('  row:', JSON.stringify(match).slice(0, 200));
      } else {
        console.log(`  PROD: history returned ${runs.length} rows but none matched uuid`);
      }
    } else {
      const body = await res.text().catch(() => '');
      console.log(`  PROD: history endpoint returned HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
  } catch (err: unknown) {
    console.log('  PROD ERROR (history):', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Context: URL routing
// ---------------------------------------------------------------------------

function printUrlContext(): void {
  console.log('=== URL Routing Context ===');
  console.log('  /backtesting/:id       → backtest_results.id (loaded via GET /backtest/:id)');
  console.log('  /configs/strategy/:id  → strategy_configs.id');
  console.log('  /configs/aggregation/:id → aggregation_configs.id');
  console.log('');
  console.log(`  Given URL was: http://5.223.56.226/backtesting/${UUID}`);
  console.log('  => This UUID is treated as a backtest_results.id by the frontend');
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nSearching for UUID: ${UUID}\n`);
  printUrlContext();

  console.log('=== Checking LOCAL database ===');
  let localHits: TableHit[] = [];
  try {
    localHits = await checkLocalDb(UUID);
  } catch (err: unknown) {
    console.log('LOCAL DB unavailable:', err instanceof Error ? err.message : String(err));
  }

  await checkProdApi(UUID);

  console.log('\n=== Summary ===');
  if (localHits.length > 0) {
    console.log('Local DB hits:');
    for (const h of localHits) {
      console.log(`  ${h.table}.${h.column}`);
    }
  } else {
    console.log('Local DB: no hits');
  }
  console.log('(See PROD results above)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
