import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const syms = [
    'LPT/USDT:USDT', 'RPL/USDT:USDT', 'TIA/USDT:USDT', 'IMX/USDT:USDT',
    'ONT/USDT:USDT', 'COTI/USDT:USDT', 'ENJ/USDT:USDT', 'COMP/USDT:USDT',
    'STG/USDT:USDT', 'GRT/USDT:USDT', 'ENS/USDT:USDT', 'KAVA/USDT:USDT',
    'IOST/USDT:USDT', 'TRB/USDT:USDT', 'BCH/USDT:USDT', 'IOTA/USDT:USDT',
    'APT/USDT:USDT', 'ARB/USDT:USDT', 'LDO/USDT:USDT', 'DOGE/USDT:USDT',
    'ICP/USDT:USDT', 'XLM/USDT:USDT', 'NEAR/USDT:USDT', 'ZEC/USDT:USDT',
  ];

  // Expected: ~2370 for 2024-01-01 to 2026-03-01 (790 days * 3/day)
  const expected = 2370;
  const threshold = expected * 0.8;

  console.log(`Expected ~${expected} FR records. Threshold (80%): ${threshold}\n`);

  const bad: string[] = [];
  const good: string[] = [];

  for (const s of syms) {
    const r = await pool.query(
      'SELECT count(*) as cnt, min(timestamp) as first_ts, max(timestamp) as last_ts FROM funding_rates WHERE symbol = $1 AND exchange = $2',
      [s, 'bybit']
    );
    const cnt = parseInt(r.rows[0].cnt);
    const lastDate = r.rows[0].last_ts ? new Date(Number(r.rows[0].last_ts)).toISOString().split('T')[0] : 'none';
    const status = cnt >= threshold ? 'OK' : 'BAD';
    console.log(`${s.padEnd(22)} ${String(cnt).padStart(5)} FR  last=${lastDate}  ${status}`);
    if (cnt >= threshold) good.push(s);
    else bad.push(s);
  }

  console.log(`\nGood (${good.length}): ${good.join(', ')}`);
  console.log(`Bad  (${bad.length}): ${bad.join(', ')}`);

  await pool.end();
}
main();
