/**
 * Re-run backtests for configs that failed with 502 during deployment.
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

// Configs that got 502 during deployment restart (only fr-v2/Auto/FR V2 — skip orig/pruned with delisted symbols)
const CONFIGS = [
  { id: '35092e82-f9d0-458b-8155-f1bdf0010152', name: 'fr-v2-top_n-17assets-mp3-2' },
  { id: '0d79e0df-a41d-4c24-9a46-7e025c6b5f9a', name: 'fr-v2-top_n-13assets-mp3-6' },
  { id: '07930505-3319-4efb-97ab-99d835e04563', name: 'fr-v2-single_strongest-13assets-mp1-0' },
  { id: '0146de93-69ff-45fc-9038-16896a8feca1', name: 'fr-v2-single_strongest-4assets-mp1-5' },
  { id: '676a7e4c-0296-432b-924f-09e127bd5745', name: 'Auto: single_strongest 1pos 4assets Sharpe1.78' },
  { id: '6d07bed5-9859-4262-a56f-c86b491b2d71', name: 'Auto: single_strongest 1pos 3assets Sharpe1.80' },
  { id: '489190c5-65d9-4ca3-a10a-fbb7942d76e8', name: 'Auto: top_n 2pos 4assets Sharpe1.84' },
  { id: '431212b1-05a9-46f0-8b12-8aa56e1bece0', name: 'Auto: single_strongest 1pos 6assets Sharpe1.88' },
  { id: 'ab23c41e-c445-41eb-9403-b0b0c691670f', name: 'Auto: single_strongest 1pos 2assets Sharpe1.94' },
  { id: '57c266ff-24f1-4865-9d8f-95df953e3516', name: 'Auto: single_strongest 1pos 5assets Sharpe1.95' },
  { id: '590c8b20-1c5b-4add-b486-5734c58f25dc', name: 'Auto: single_strongest 1pos 7assets Sharpe2.08' },
  { id: 'ab217631-d05f-4851-8e47-6a8e42a25605', name: 'FR V2 WF-Validated Portfolio (7 symbols, optimized params)' },
  { id: 'ac01734c-31c6-4ded-b8a2-81d3ce674d3e', name: 'FR V2 Expanded (10 symbols, WF-validated)' },
  { id: 'd4c0269b-8e37-4945-aa24-04ad9c10c926', name: 'aggregation 4 — 3 мар. 2026 г.' },
  { id: 'f78874dd-76c9-4efc-83f2-0afa06fb454f', name: 'aggregation 3 — 3 мар. 2026 г.' },
];

async function main() {
  const token = await login();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  for (let i = 0; i < CONFIGS.length; i++) {
    const config = CONFIGS[i];
    console.log(`[${i + 1}/${CONFIGS.length}] ${config.name}...`);
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
        continue;
      }

      const result = await resp.json() as any;
      const m = result.metrics || {};
      console.log(`  Sharpe=${(m.sharpeRatio||0).toFixed(2)} Return=${(m.totalReturnPercent||0).toFixed(0)}% DD=${(m.maxDrawdownPercent||0).toFixed(1)}% Trades=${m.totalTrades||0} (${elapsed.toFixed(0)}s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ERROR: ${msg}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
