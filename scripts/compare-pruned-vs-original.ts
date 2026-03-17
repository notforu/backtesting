/**
 * Compare pruned vs original configs to see if pruning helped.
 * Creates original (non-pruned) configs on prod, runs backtests, prints comparison.
 */
import { readFileSync } from 'fs';
import { getPool } from '../src/data/db.js';

const PROD_URL = 'http://5.223.56.226';
const pool = getPool();

async function loginProd(): Promise<string> {
  const resp = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  const data = await resp.json() as { token: string };
  return data.token;
}

async function createAndRun(token: string, name: string, allocationMode: string, maxPositions: number, subStrategies: any[]): Promise<any> {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  // Create config
  const createResp = await fetch(`${PROD_URL}/api/aggregations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name,
      allocationMode,
      maxPositions,
      subStrategies,
      initialCapital: 10000,
      exchange: 'bybit',
      mode: 'futures',
    }),
  });

  if (!createResp.ok) {
    const text = await createResp.text();
    throw new Error(`Create failed: ${text}`);
  }

  const config = await createResp.json() as any;

  // Run backtest
  const start = Date.now();
  const runResp = await fetch(`${PROD_URL}/api/aggregations/${config.id}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ startDate: '2024-01-01', endDate: '2026-03-01' }),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!runResp.ok) {
    const text = await runResp.text();
    return { error: text, elapsed };
  }

  const result = await runResp.json() as any;
  return { ...result.metrics, elapsed };
}

async function main() {
  const token = await loginProd();

  // Get the original (non-pruned) subStrategies from local DB
  const originalRunIds = [
    '79fcd037-4e4c-4d8e-8689-915dd26ffaf9', // #0: was 16 assets, pruned to 10
    '1a79a185',                               // #3: was 6 assets, pruned to 6 (no change)
    'c0939e8f',                               // #5: was 16 assets, pruned to 12
    '7af57291',                               // #6: was 6 assets, pruned to 6 (no change)
  ];

  // Load pruned configs for comparison
  const pruned = JSON.parse(readFileSync('/workspace/scripts/pruned-configs.json', 'utf-8'));
  const prunedConfigs = [pruned[0], pruned[3], pruned[5], pruned[6]];

  console.log('Fetching original configs from local DB...\n');

  const results: Array<{
    label: string;
    originalSharpe?: number;
    originalReturn?: number;
    originalTrades?: number;
    prunedSharpe?: number;
    prunedReturn?: number;
    prunedTrades?: number;
    origAssets: number;
    prunedAssets: number;
  }> = [];

  for (let i = 0; i < originalRunIds.length; i++) {
    const runId = originalRunIds[i];
    const prunedConfig = prunedConfigs[i];

    // Get original subStrategies from local DB
    const localRun = await pool.query(`
      SELECT config->'params'->'subStrategies' as sub_strategies,
             config->'params'->>'allocationMode' as alloc_mode,
             (config->'params'->>'maxPositions')::int as max_pos
      FROM backtest_runs WHERE id LIKE $1
    `, [runId + '%']);

    if (localRun.rows.length === 0) {
      console.log(`Run ${runId} not found in local DB, skipping`);
      continue;
    }

    const row = localRun.rows[0];
    const origSubs = row.sub_strategies;
    const allocMode = row.alloc_mode;
    const maxPos = row.max_pos;

    // Skip configs where pruning didn't change anything
    if (origSubs.length === prunedConfig.subStrategies.length) {
      console.log(`=== Config ${runId.substring(0,8)} (${allocMode}, ${origSubs.length} assets) — NO PRUNING NEEDED ===`);
      console.log(`  Same ${origSubs.length} assets in both, skipping comparison\n`);
      continue;
    }

    const label = `${runId.substring(0,8)} ${allocMode} maxPos=${maxPos}`;
    console.log(`=== ${label} ===`);
    console.log(`  Original: ${origSubs.length} assets`);
    console.log(`  Pruned:   ${prunedConfig.subStrategies.length} assets (removed ${origSubs.length - prunedConfig.subStrategies.length})`);

    // Run original (non-pruned) config on prod
    console.log(`  Running ORIGINAL backtest...`);
    const origResult = await createAndRun(
      token,
      `original-${allocMode}-${origSubs.length}assets-${runId.substring(0,8)}`,
      allocMode,
      maxPos,
      origSubs,
    );

    if (origResult.error) {
      console.log(`  Original FAILED: ${origResult.error}\n`);
      continue;
    }

    console.log(`  Original: Sharpe=${origResult.sharpeRatio?.toFixed(4)}, Ret=${origResult.totalReturnPercent?.toFixed(2)}%, DD=${origResult.maxDrawdownPercent?.toFixed(2)}%, Trades=${origResult.totalTrades} (${origResult.elapsed}s)`);

    // The pruned version was already run — get results from DB
    // Actually, let's re-run it too for a fair comparison
    console.log(`  Running PRUNED backtest...`);
    const prunedResult = await createAndRun(
      token,
      `pruned-comparison-${allocMode}-${prunedConfig.remainingCount}assets-${runId.substring(0,8)}`,
      allocMode,
      Math.min(maxPos, prunedConfig.subStrategies.length),
      prunedConfig.subStrategies,
    );

    if (prunedResult.error) {
      console.log(`  Pruned FAILED: ${prunedResult.error}\n`);
      continue;
    }

    console.log(`  Pruned:   Sharpe=${prunedResult.sharpeRatio?.toFixed(4)}, Ret=${prunedResult.totalReturnPercent?.toFixed(2)}%, DD=${prunedResult.maxDrawdownPercent?.toFixed(2)}%, Trades=${prunedResult.totalTrades} (${prunedResult.elapsed}s)`);

    const sharpeDiff = ((prunedResult.sharpeRatio - origResult.sharpeRatio) / origResult.sharpeRatio * 100).toFixed(1);
    const retDiff = ((prunedResult.totalReturnPercent - origResult.totalReturnPercent) / Math.abs(origResult.totalReturnPercent) * 100).toFixed(1);
    const ddDiff = ((prunedResult.maxDrawdownPercent - origResult.maxDrawdownPercent) / origResult.maxDrawdownPercent * 100).toFixed(1);

    console.log(`  Delta:    Sharpe ${sharpeDiff}%, Return ${retDiff}%, DD ${ddDiff}%`);
    console.log('');

    results.push({
      label,
      originalSharpe: origResult.sharpeRatio,
      originalReturn: origResult.totalReturnPercent,
      originalTrades: origResult.totalTrades,
      prunedSharpe: prunedResult.sharpeRatio,
      prunedReturn: prunedResult.totalReturnPercent,
      prunedTrades: prunedResult.totalTrades,
      origAssets: origSubs.length,
      prunedAssets: prunedConfig.subStrategies.length,
    });
  }

  console.log('\n=== SUMMARY ===');
  console.log('Config'.padEnd(45) + 'Orig Sharpe  Pruned Sharpe  Orig Ret%    Pruned Ret%');
  for (const r of results) {
    console.log(
      `${r.label.padEnd(45)}${r.originalSharpe?.toFixed(2).padStart(10)}  ${r.prunedSharpe?.toFixed(2).padStart(12)}  ${r.originalReturn?.toFixed(1).padStart(10)}%  ${r.prunedReturn?.toFixed(1).padStart(10)}%`
    );
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
