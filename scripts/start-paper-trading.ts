/**
 * Start paper trading for top 3 aggregation configs on prod.
 * Uses aggregationConfigId to reference existing configs.
 */

const PROD_URL = 'http://5.223.56.226';

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

async function main() {
  const token = await loginProd();

  // Get all aggregation configs, find the ones we just created
  const listResp = await fetch(`${PROD_URL}/api/aggregations`, { headers: hdrs(token) });
  const allConfigs = await listResp.json() as any[];

  // Filter our recently created configs (name starts with "fr-v2-")
  const ourConfigs = allConfigs.filter((c: any) => c.name?.startsWith('fr-v2-'));
  console.log(`Found ${ourConfigs.length} fr-v2 configs on prod\n`);

  // Top 3 configs by backtest results (from earlier run):
  // 1. fr-v2-single_strongest-13assets-mp1-0  Sharpe=2.92  Ret=4039.7%
  // 2. fr-v2-single_strongest-17assets-mp1-1  Sharpe=2.90  Ret=3329.7%
  // 3. fr-v2-single_strongest-5assets-mp1-4   Sharpe=2.63  Ret=816.6%
  const topNames = [
    'fr-v2-single_strongest-13assets-mp1-0',
    'fr-v2-single_strongest-17assets-mp1-1',
    'fr-v2-single_strongest-5assets-mp1-4',
  ];

  const configResults = ourConfigs
    .filter((c: any) => topNames.includes(c.name))
    .map((c: any) => ({
      configId: c.id,
      name: c.name,
      sharpe: 0,
      returnPct: 0,
      maxDD: 0,
    }));

  // Maintain the order from topNames
  configResults.sort((a, b) => topNames.indexOf(a.name) - topNames.indexOf(b.name));

  console.log('=== FR-V2 CONFIGS WITH RESULTS ===');
  for (const r of configResults) {
    console.log(`  ${r.name.padEnd(50)} Sharpe=${r.sharpe.toFixed(2)}  Ret=${r.returnPct.toFixed(1)}%  DD=${r.maxDD.toFixed(1)}%`);
  }

  // Start paper trading for top 3
  const top3 = configResults.slice(0, 3);
  console.log(`\n=== STARTING PAPER TRADING FOR TOP ${top3.length} ===\n`);

  for (const r of top3) {
    console.log(`Creating paper session: ${r.name} (Sharpe=${r.sharpe.toFixed(2)})`);

    const createResp = await fetch(`${PROD_URL}/api/paper-trading/sessions`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({
        name: `Paper: ${r.name}`,
        aggregationConfigId: r.configId,
        initialCapital: 10000,
      }),
    });

    if (!createResp.ok) {
      console.log(`  Create FAILED: ${await createResp.text()}\n`);
      continue;
    }

    const session = await createResp.json() as any;
    console.log(`  Session: ${session.id}`);

    const startResp = await fetch(`${PROD_URL}/api/paper-trading/sessions/${session.id}/start`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({}),
    });

    if (!startResp.ok) {
      console.log(`  Start FAILED: ${await startResp.text()}\n`);
    } else {
      console.log(`  STARTED: ${PROD_URL}/paper-trading/${session.id}\n`);
    }
  }

  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
