/**
 * Re-run backtests for previously imported configs after FR data was cached on prod.
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

const CONFIGS = [
  { id: 'ca9ce587-2d1c-4039-84c9-fab8fcc3e778', name: '#0 single_strongest 10 assets' },
  { id: '2f881f0d-a362-46dc-bef3-13db419ddbe5', name: '#3 single_strongest 6 assets' },
  { id: '36278a02-434b-4c68-970a-e8e957a36f0d', name: '#5 top_n 12 assets' },
  { id: 'a4bd1b90-dccb-4ac5-9e7a-868ad247f871', name: '#6 top_n 6 assets' },
];

async function main() {
  const token = await login();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  for (const config of CONFIGS) {
    console.log(`\n=== ${config.name} ===`);
    const start = Date.now();

    const resp = await fetch(`${BASE_URL}/api/aggregations/${config.id}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ startDate: '2024-01-01', endDate: '2026-03-01' }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!resp.ok) {
      console.log(`  FAILED (${resp.status}): ${await resp.text()}`);
      continue;
    }

    const result = await resp.json() as any;
    const m = result.metrics || {};
    console.log(`  Completed in ${elapsed}s`);
    console.log(`  Sharpe: ${m.sharpeRatio?.toFixed(4)}, Return: ${m.totalReturnPercent?.toFixed(2)}%, MaxDD: ${m.maxDrawdownPercent?.toFixed(2)}%`);
    console.log(`  Trades: ${m.totalTrades}, WinRate: ${m.winRate?.toFixed(2)}%`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
