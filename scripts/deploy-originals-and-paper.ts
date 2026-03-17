/**
 * 1. Get all original top aggregation configs from local DB
 * 2. Remove delisted symbols (LPT, TIA, ONT, GRT)
 * 3. Create on prod + run backtests
 * 4. Start paper trading for the best ones
 */
import { getPool } from '../src/data/db.js';

const PROD_URL = 'http://5.223.56.226';
const pool = getPool();

// Symbols delisted on Bybit (insufficient FR data on prod)
const DELISTED_SYMBOLS = new Set([
  'LPT/USDT:USDT',
  'TIA/USDT:USDT',
  'ONT/USDT:USDT',
  'GRT/USDT:USDT',
]);

async function loginProd(): Promise<string> {
  const resp = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  const data = await resp.json() as { token: string };
  return data.token;
}

function hdrs(token: string) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

interface RunResult {
  configId: string;
  name: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  allocMode: string;
  maxPos: number;
  numAssets: number;
  subStrategies: any[];
}

async function main() {
  const token = await loginProd();

  const localRuns = await pool.query(`
    SELECT
      br.id,
      (br.metrics->>'sharpeRatio')::numeric as sharpe,
      (br.metrics->>'totalReturnPercent')::numeric as return_pct,
      br.config->'params'->'subStrategies' as sub_strategies,
      br.config->'params'->>'allocationMode' as alloc_mode,
      (br.config->'params'->>'maxPositions')::int as max_pos
    FROM backtest_runs br
    WHERE br.strategy_name = 'aggregation'
      AND (br.metrics->>'sharpeRatio')::numeric >= 1.5
      AND (br.metrics->>'totalReturnPercent')::numeric >= 500
      AND br.per_asset_results IS NOT NULL
    ORDER BY (br.metrics->>'sharpeRatio')::numeric DESC
    LIMIT 15
  `);

  console.log(`Found ${localRuns.rows.length} top local runs`);
  console.log(`Excluding delisted: ${[...DELISTED_SYMBOLS].join(', ')}\n`);

  // Filter out delisted symbols from each config, then deduplicate
  const seen = new Set<string>();
  const configs: Array<{ allocMode: string; maxPos: number; subStrategies: any[]; localSharpe: number; localRet: number }> = [];

  for (const row of localRuns.rows) {
    const subs = (row.sub_strategies as any[]).filter((s: any) => !DELISTED_SYMBOLS.has(s.symbol));
    if (subs.length < 3) continue; // need at least 3 assets

    const symbols = subs.map((s: any) => s.symbol).sort().join(',');
    const key = `${row.alloc_mode}:${row.max_pos}:${symbols}`;
    if (seen.has(key)) continue;
    seen.add(key);

    configs.push({
      allocMode: row.alloc_mode,
      maxPos: Math.min(row.max_pos, subs.length),
      subStrategies: subs,
      localSharpe: Number(row.sharpe),
      localRet: Number(row.return_pct),
    });
  }

  console.log(`${configs.length} unique configs after dedup + delisted removal\n`);

  const results: RunResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const name = `fr-v2-${c.allocMode}-${c.subStrategies.length}assets-mp${c.maxPos}-${i}`;

    console.log(`[${i+1}/${configs.length}] ${name} (local Sharpe=${c.localSharpe.toFixed(2)})`);

    try {
      const createResp = await fetch(`${PROD_URL}/api/aggregations`, {
        method: 'POST',
        headers: hdrs(token),
        body: JSON.stringify({
          name,
          allocationMode: c.allocMode,
          maxPositions: c.maxPos,
          subStrategies: c.subStrategies,
          initialCapital: 10000,
          exchange: 'bybit',
          mode: 'futures',
        }),
      });

      if (!createResp.ok) {
        console.log(`  Create FAILED: ${await createResp.text()}\n`);
        continue;
      }

      const config = await createResp.json() as any;

      const start = Date.now();
      const runResp = await fetch(`${PROD_URL}/api/aggregations/${config.id}/run`, {
        method: 'POST',
        headers: hdrs(token),
        body: JSON.stringify({ startDate: '2024-01-01', endDate: '2026-03-01' }),
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (!runResp.ok) {
        console.log(`  Backtest FAILED: ${await runResp.text()}\n`);
        continue;
      }

      const result = await runResp.json() as any;
      const m = result.metrics || {};

      console.log(`  Sharpe=${m.sharpeRatio?.toFixed(2)}, Ret=${m.totalReturnPercent?.toFixed(1)}%, DD=${m.maxDrawdownPercent?.toFixed(1)}%, Trades=${m.totalTrades}, WR=${m.winRate?.toFixed(1)}% (${elapsed}s)\n`);

      results.push({
        configId: config.id,
        name,
        sharpe: m.sharpeRatio || 0,
        returnPct: m.totalReturnPercent || 0,
        maxDD: m.maxDrawdownPercent || 0,
        trades: m.totalTrades || 0,
        winRate: m.winRate || 0,
        allocMode: c.allocMode,
        maxPos: c.maxPos,
        numAssets: c.subStrategies.length,
        subStrategies: c.subStrategies,
      });
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  results.sort((a, b) => b.sharpe - a.sharpe);

  console.log('\n=== ALL RESULTS (sorted by Sharpe) ===');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(50)} Sharpe=${r.sharpe.toFixed(2)}  Ret=${r.returnPct.toFixed(1).padStart(8)}%  DD=${r.maxDD.toFixed(1).padStart(5)}%  Trades=${String(r.trades).padStart(4)}  WR=${r.winRate.toFixed(1)}%`);
  }

  // Start paper trading for top 3
  const topN = results.filter(r => r.sharpe >= 2.0).slice(0, 3);
  if (topN.length === 0 && results.length > 0) {
    topN.push(results[0]); // at least the best one
  }

  console.log(`\n=== STARTING PAPER TRADING FOR TOP ${topN.length} ===`);

  for (const r of topN) {
    console.log(`\n  ${r.name} (Sharpe=${r.sharpe.toFixed(2)}, Ret=${r.returnPct.toFixed(1)}%)`);

    const configResp = await fetch(`${PROD_URL}/api/aggregations/${r.configId}`, {
      headers: hdrs(token),
    });
    const config = await configResp.json() as any;

    const createResp = await fetch(`${PROD_URL}/api/paper-trading/sessions`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({
        name: `Paper: ${r.name}`,
        initialCapital: 10000,
        aggregationConfig: {
          allocationMode: config.allocationMode,
          maxPositions: config.maxPositions,
          subStrategies: config.subStrategies,
          initialCapital: 10000,
          exchange: 'bybit',
          mode: 'futures',
        },
      }),
    });

    if (!createResp.ok) {
      console.log(`  Create session FAILED: ${await createResp.text()}`);
      continue;
    }

    const session = await createResp.json() as any;

    const startResp = await fetch(`${PROD_URL}/api/paper-trading/sessions/${session.id}/start`, {
      method: 'POST',
      headers: hdrs(token),
    });

    if (!startResp.ok) {
      console.log(`  Start FAILED: ${await startResp.text()}`);
    } else {
      console.log(`  STARTED: ${PROD_URL}/paper-trading/${session.id}`);
    }
  }

  console.log('\nDone!');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
