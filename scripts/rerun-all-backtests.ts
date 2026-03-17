/**
 * Re-run backtests for ALL aggregation configs on prod.
 * After cleaning up empty strategy configs, this ensures all results are fresh.
 */

const BASE_URL = 'http://5.223.56.226';

async function login(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status}`);
  const data = await resp.json() as { token: string };
  return data.token;
}

async function main() {
  const token = await login();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  // Get all aggregation configs
  const listResp = await fetch(`${BASE_URL}/api/aggregations`, { headers });
  const configs = await listResp.json() as Array<{ id: string; name: string }>;

  console.log(`Found ${configs.length} aggregation configs\n`);

  const results: Array<{ name: string; sharpe: number; ret: number; dd: number; trades: number; elapsed: number; error?: string }> = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    console.log(`[${i + 1}/${configs.length}] ${config.name}...`);
    const start = Date.now();

    try {
      const resp = await fetch(`${BASE_URL}/api/aggregations/${config.id}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ startDate: '2024-01-01', endDate: '2026-03-01' }),
      });

      const elapsed = (Date.now() - start) / 1000;

      if (!resp.ok) {
        const text = await resp.text();
        console.log(`  FAILED (${resp.status}): ${text.substring(0, 200)}`);
        results.push({ name: config.name, sharpe: 0, ret: 0, dd: 0, trades: 0, elapsed, error: text.substring(0, 100) });
        continue;
      }

      const result = await resp.json() as any;
      const m = result.metrics || {};
      const sharpe = m.sharpeRatio || 0;
      const ret = m.totalReturnPercent || 0;
      const dd = m.maxDrawdownPercent || 0;
      const trades = m.totalTrades || 0;

      console.log(`  Sharpe=${sharpe.toFixed(2)} Return=${ret.toFixed(0)}% DD=${dd.toFixed(1)}% Trades=${trades} (${elapsed.toFixed(0)}s)`);
      results.push({ name: config.name, sharpe, ret, dd, trades, elapsed });
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ERROR: ${msg}`);
      results.push({ name: config.name, sharpe: 0, ret: 0, dd: 0, trades: 0, elapsed, error: msg });
    }
  }

  // Summary table
  console.log('\n\n=== SUMMARY ===\n');
  console.log('Name'.padEnd(55) + 'Sharpe'.padStart(8) + 'Return%'.padStart(10) + 'MaxDD%'.padStart(8) + 'Trades'.padStart(8));
  console.log('-'.repeat(89));

  const sorted = [...results].sort((a, b) => b.sharpe - a.sharpe);
  for (const r of sorted) {
    if (r.error) {
      console.log(`${r.name.padEnd(55)} FAILED: ${r.error}`);
    } else {
      console.log(
        `${r.name.padEnd(55)}${r.sharpe.toFixed(2).padStart(8)}${r.ret.toFixed(0).padStart(10)}${r.dd.toFixed(1).padStart(8)}${String(r.trades).padStart(8)}`
      );
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
