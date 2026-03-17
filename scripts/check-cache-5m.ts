import { closeDb, getDb } from '../src/data/db.js';

async function main() {
  const db = getDb();
  const result = await db.all(
    `SELECT symbol, timeframe, COUNT(*) as count FROM candles WHERE timeframe='5m' GROUP BY symbol, timeframe ORDER BY symbol`
  );
  console.error(JSON.stringify(result, null, 2));
  
  const frResult = await db.all(
    `SELECT symbol, COUNT(*) as count FROM funding_rates GROUP BY symbol ORDER BY symbol`
  );
  console.error('Funding rates:', JSON.stringify(frResult, null, 2));
  
  closeDb();
}
main().catch(console.error);
