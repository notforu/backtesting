/**
 * Fix sub_strategy_config_ids for all aggregation configs on prod.
 * Calls POST /api/aggregations/:id/regenerate-ids for each broken config.
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
  const configs = await listResp.json() as Array<{
    id: string;
    name: string;
    subStrategies: Array<{ symbol: string }>;
    subStrategyConfigIds?: string[];
  }>;

  // Find configs with mismatched IDs
  const broken = configs.filter(c => {
    const ids = c.subStrategyConfigIds || [];
    return ids.length !== c.subStrategies.length;
  });

  console.log(`Found ${broken.length}/${configs.length} configs with mismatched subStrategyConfigIds\n`);

  let fixed = 0;
  let failed = 0;

  for (const config of broken) {
    const existingIds = config.subStrategyConfigIds || [];
    process.stdout.write(`${config.name} (${existingIds.length}→${config.subStrategies.length})... `);

    const resp = await fetch(`${BASE_URL}/api/aggregations/${config.id}/regenerate-ids`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.log(`FAILED: ${text.substring(0, 150)}`);
      failed++;
      continue;
    }

    const updated = await resp.json() as { subStrategyConfigIds?: string[] };
    const newIds = updated.subStrategyConfigIds || [];
    console.log(`OK (${newIds.length} IDs)`);
    fixed++;
  }

  console.log(`\nDone: ${fixed} fixed, ${failed} failed`);
}

main().catch(err => { console.error(err); process.exit(1); });
