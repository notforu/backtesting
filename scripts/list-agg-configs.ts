import { initDb, getDb } from '../src/data/db.js';

async function main() {
  await initDb();
  const db = getDb();
  const rows = await db.query('SELECT id, name, config FROM aggregation_configs ORDER BY created_at DESC LIMIT 25');
  for (const r of rows.rows) {
    const c = r.config || {};
    const subs = c.subStrategies || [];
    const strategies = [...new Set(subs.map((s: any) => s.strategyName))];
    console.log(`${r.name}`);
    console.log(`  alloc=${c.allocationMode || '?'} | maxPos=${c.maxPositions || '?'} | subs=${subs.length} | strat=${strategies.join(',')}`);
    console.log(`  id=${r.id}`);
    console.log('');
  }
  await db.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
