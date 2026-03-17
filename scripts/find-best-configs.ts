import { getPool } from '../src/data/db.js';
const pool = getPool();

async function main() {
  // Get top aggregation runs with high Sharpe and returns
  // Fields: sharpeRatio, totalReturnPercent, maxDrawdownPercent, totalTrades
  const result = await pool.query(`
    SELECT
      br.id,
      br.aggregation_id,
      (br.metrics->>'sharpeRatio')::numeric as sharpe,
      (br.metrics->>'totalReturnPercent')::numeric as return_pct,
      (br.metrics->>'maxDrawdownPercent')::numeric as max_dd,
      (br.metrics->>'totalTrades')::int as trades,
      br.config->'params'->>'allocationMode' as alloc_mode,
      (br.config->'params'->>'maxPositions')::int as max_pos,
      CASE WHEN br.config->'params'->'subStrategies' IS NOT NULL
           THEN jsonb_array_length(br.config->'params'->'subStrategies')
           ELSE 0 END as num_assets,
      br.start_date, br.end_date,
      br.per_asset_results,
      br.config->'params'->'subStrategies' as sub_strategies,
      br.config->'params'->>'allocationMode' as allocation_mode,
      (br.config->'params'->>'maxPositions')::int as max_positions
    FROM backtest_runs br
    WHERE br.strategy_name = 'aggregation'
      AND (br.metrics->>'sharpeRatio')::numeric >= 1.5
      AND (br.metrics->>'totalReturnPercent')::numeric >= 500
      AND br.per_asset_results IS NOT NULL
    ORDER BY (br.metrics->>'sharpeRatio')::numeric DESC
    LIMIT 15
  `);

  console.log(`Found ${result.rows.length} top aggregation runs\n`);

  for (const row of result.rows) {
    console.log(`=== Run ${row.id.substring(0,8)} ===`);
    console.log(`  Sharpe: ${Number(row.sharpe).toFixed(2)}, Return: ${Number(row.return_pct).toFixed(1)}%, MaxDD: ${Number(row.max_dd).toFixed(1)}%`);
    console.log(`  Trades: ${row.trades}, Assets: ${row.num_assets}, Mode: ${row.alloc_mode}, MaxPos: ${row.max_pos}`);
    console.log(`  Agg Config ID: ${row.aggregation_id || 'none'}`);

    // Per-asset breakdown
    const assets = typeof row.per_asset_results === 'string'
      ? JSON.parse(row.per_asset_results)
      : row.per_asset_results;

    const assetEntries: Array<{symbol: string, sharpe: number, ret: number, dd: number, trades: number}> = [];

    for (const [symbol, data] of Object.entries(assets)) {
      const d = data as any;
      const metrics = d.metrics || d;
      assetEntries.push({
        symbol,
        sharpe: parseFloat(metrics.sharpeRatio || metrics.sharpe || '0'),
        ret: parseFloat(metrics.totalReturnPercent || metrics.totalReturnPct || metrics.returnPct || '0'),
        dd: parseFloat(metrics.maxDrawdownPercent || metrics.maxDrawdownPct || metrics.maxDrawdown || '0'),
        trades: parseInt(metrics.totalTrades || metrics.trades || '0'),
      });
    }

    // Sort by Sharpe desc
    assetEntries.sort((a, b) => b.sharpe - a.sharpe);

    for (const a of assetEntries) {
      const status = a.sharpe < 0.5 || a.ret < 0 ? ' PRUNE' : ' KEEP';
      console.log(`    ${a.symbol.padEnd(20)} Sharpe=${a.sharpe.toFixed(2).padStart(6)} Ret=${a.ret.toFixed(1).padStart(8)}% DD=${a.dd.toFixed(1).padStart(6)}% Trades=${String(a.trades).padStart(4)} ${status}`);
    }
    console.log('');
  }

  // Pruning logic
  const configsForPruning = result.rows.map(row => {
    const assets = typeof row.per_asset_results === 'string'
      ? JSON.parse(row.per_asset_results) : row.per_asset_results;
    const subStrategies = row.sub_strategies || [];

    const goodAssets: string[] = [];
    const badAssets: string[] = [];

    for (const [symbol, data] of Object.entries(assets)) {
      const d = data as any;
      const metrics = d.metrics || d;
      const sharpe = parseFloat(metrics.sharpeRatio || metrics.sharpe || '0');
      const ret = parseFloat(metrics.totalReturnPercent || metrics.totalReturnPct || metrics.returnPct || '0');

      if (sharpe >= 0.5 && ret > 0) {
        goodAssets.push(symbol);
      } else {
        badAssets.push(symbol);
      }
    }

    return {
      runId: row.id,
      aggConfigId: row.aggregation_id,
      sharpe: parseFloat(row.sharpe),
      returnPct: parseFloat(row.return_pct),
      allocationMode: row.allocation_mode,
      maxPositions: parseInt(row.max_positions),
      totalAssets: subStrategies.length,
      goodAssets,
      badAssets,
      subStrategies,
    };
  });

  console.log('\n=== PRUNING SUMMARY ===');
  for (const c of configsForPruning) {
    console.log(`Run ${c.runId.substring(0,8)}: ${c.totalAssets} assets -> keep ${c.goodAssets.length}, prune ${c.badAssets.length}`);
    if (c.badAssets.length > 0) {
      console.log(`  Pruning: ${c.badAssets.join(', ')}`);
    }
  }

  // Build pruned configs (keep at least 3 assets)
  const prunedConfigs = configsForPruning
    .filter(c => c.goodAssets.length >= 3)
    .map(c => {
      const prunedSubs = (c.subStrategies as any[]).filter((sub: any) =>
        c.goodAssets.includes(sub.symbol)
      );
      return {
        originalRunId: c.runId,
        originalSharpe: c.sharpe,
        originalReturn: c.returnPct,
        allocationMode: c.allocationMode,
        maxPositions: Math.min(c.maxPositions, prunedSubs.length),
        subStrategies: prunedSubs,
        prunedCount: c.badAssets.length,
        remainingCount: prunedSubs.length,
      };
    });

  // Deduplicate by sorted symbol list + allocation mode
  const seen = new Set<string>();
  const uniqueConfigs = prunedConfigs.filter(c => {
    const key = c.allocationMode + ':' + JSON.stringify(c.subStrategies.map((s: any) => s.symbol).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n=== UNIQUE PRUNED CONFIGS: ${uniqueConfigs.length} ===`);
  for (const c of uniqueConfigs) {
    console.log(`  Sharpe=${c.originalSharpe.toFixed(2)} Ret=${c.originalReturn.toFixed(1)}% | ${c.remainingCount} assets (pruned ${c.prunedCount}) | mode=${c.allocationMode} maxPos=${c.maxPositions}`);
    console.log(`    Assets: ${c.subStrategies.map((s: any) => s.symbol).join(', ')}`);
  }

  // Save
  const fs = await import('fs');
  fs.writeFileSync('/workspace/scripts/pruned-configs.json', JSON.stringify(uniqueConfigs, null, 2));
  console.log('\nSaved to /workspace/scripts/pruned-configs.json');

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
