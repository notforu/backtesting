/**
 * Compare paper trading results with a backtest over the same period.
 */
import { initDb, getPool } from '../src/data/db.js';
import { runBacktest } from '../src/core/engine.js';
import type { BacktestConfig } from '../src/core/types.js';

async function main() {
  await initDb();
  const pool = getPool();

  // 1. Get latest paper session
  const sessionRes = await pool.query(
    'SELECT * FROM paper_sessions ORDER BY created_at DESC LIMIT 1'
  );
  if (sessionRes.rows.length === 0) { console.log('No paper sessions.'); process.exit(0); }
  const session = sessionRes.rows[0];
  const config = session.aggregation_config;
  const sub = config.subStrategies[0];

  console.log(`Paper session: "${session.name}" (${session.id})`);
  console.log(`Strategy: ${sub.strategyName} | ${sub.symbol} ${sub.timeframe} | Mode: ${config.mode}`);
  console.log(`Params: ${JSON.stringify(sub.params)}`);
  console.log(`Capital: $${Number(session.initial_capital)} | Equity: $${Number(session.current_equity).toFixed(2)} | Ticks: ${Number(session.tick_count)}`);

  // 2. Get paper trades
  const tradesRes = await pool.query(
    'SELECT * FROM paper_trades WHERE session_id = $1 ORDER BY timestamp ASC', [session.id]
  );
  const paperTrades = tradesRes.rows;

  // Get equity snapshots for time range
  const eqRes = await pool.query(
    'SELECT * FROM paper_equity_snapshots WHERE session_id = $1 ORDER BY timestamp ASC', [session.id]
  );
  const snapshots = eqRes.rows;
  if (snapshots.length === 0) { console.log('No equity snapshots.'); process.exit(0); }

  const firstTickTs = Number(snapshots[0].timestamp);
  const lastTickTs = Number(snapshots[snapshots.length - 1].timestamp);

  console.log(`\nPaper period: ${new Date(firstTickTs).toISOString()} -> ${new Date(lastTickTs).toISOString()}`);
  console.log(`Paper trades: ${paperTrades.length}`);

  // 3. Run backtest with same params
  // Key: paper trading uses 200 warmup candles before the first tick, so the
  // backtest must also start 200+ candles before to get identical SMA state.
  // The backtest engine will use all candles for indicator warmup, just like
  // the paper engine does.
  const tfMs = sub.timeframe === '1m' ? 60000 :
               sub.timeframe === '5m' ? 300000 :
               sub.timeframe === '15m' ? 900000 :
               sub.timeframe === '1h' ? 3600000 :
               sub.timeframe === '4h' ? 14400000 : 86400000;
  const warmupMs = 200 * tfMs;
  const btStartDate = firstTickTs - warmupMs;

  console.log(`\nRunning backtest for same period (with 200-bar warmup)...`);
  console.log(`Backtest period: ${new Date(btStartDate).toISOString()} -> ${new Date(lastTickTs).toISOString()}`);

  const btConfig: BacktestConfig = {
    id: `paper-comparison-${Date.now()}`,
    strategyName: sub.strategyName,
    symbol: sub.symbol,
    timeframe: sub.timeframe,
    startDate: btStartDate,
    endDate: lastTickTs,
    initialCapital: Number(session.initial_capital),
    feeRate: 0.00055,
    params: sub.params,
    exchange: sub.exchange || 'bybit',
    mode: config.mode || 'spot',
  };

  const result = await runBacktest(btConfig);

  // Filter backtest trades to only those within the paper trading period.
  // The backtest runs with 200 warmup bars that may generate their own trades
  // before the paper session started.
  const btTradesInPeriod = result.trades.filter(t =>
    t.timestamp >= firstTickTs && t.timestamp <= lastTickTs
  );

  console.log(`\nBacktest total trades: ${result.trades.length} (${btTradesInPeriod.length} in paper period)`);

  // 4. Compare
  let paperPnl = 0;
  for (const t of paperTrades) { if (t.pnl != null) paperPnl += Number(t.pnl); }

  const initialCap = Number(session.initial_capital);
  const paperEquity = Number(session.current_equity);
  const btFinal = initialCap + result.metrics.totalReturn;

  console.log('\n============================================');
  console.log('            COMPARISON RESULTS');
  console.log('============================================');
  console.log(`                         Paper Trading    Backtest`);
  console.log(`Initial Capital:        ${initialCap.toFixed(2).padStart(13)} ${initialCap.toFixed(2).padStart(12)}`);
  console.log(`Final Equity:           ${paperEquity.toFixed(2).padStart(13)} ${btFinal.toFixed(2).padStart(12)}`);
  console.log(`PnL:                    ${paperPnl.toFixed(2).padStart(13)} ${result.metrics.totalReturn.toFixed(2).padStart(12)}`);
  const paperRet = ((paperEquity / initialCap) - 1) * 100;
  console.log(`Return %:               ${(paperRet.toFixed(2)+'%').padStart(13)} ${(result.metrics.totalReturnPercent.toFixed(2)+'%').padStart(12)}`);
  console.log(`Total Trades:           ${paperTrades.length.toString().padStart(13)} ${btTradesInPeriod.length.toString().padStart(12)}`);
  console.log(`Total Fees:             ${'-'.padStart(13)} ${result.metrics.totalFees.toFixed(2).padStart(12)}`);
  console.log(`Sharpe:                 ${'-'.padStart(13)} ${result.metrics.sharpeRatio.toFixed(3).padStart(12)}`);

  // 5. Trade-by-trade
  console.log('\n========== PAPER TRADES ==========');
  for (const t of paperTrades) {
    const time = new Date(Number(t.timestamp)).toISOString().slice(5, 19);
    const pnl = t.pnl != null ? ` PnL:${Number(t.pnl).toFixed(4)}` : '';
    console.log(`  ${time} ${t.action.padEnd(14)} @${Number(t.price).toFixed(1)} amt:${Number(t.amount).toFixed(6)}${pnl}`);
  }

  console.log('\n========== BACKTEST TRADES (in paper period) ==========');
  for (const t of btTradesInPeriod) {
    const time = new Date(t.timestamp).toISOString().slice(5, 19);
    const pnl = t.pnl ? ` PnL:${t.pnl.toFixed(4)}` : '';
    console.log(`  ${time} ${t.action.padEnd(14)} @${t.price.toFixed(1)} amt:${t.amount.toFixed(6)}${pnl}`);
  }

  // 6. Trade matching
  console.log('\n========== TRADE MATCHING ==========');

  // Group trades by timestamp (multiple trades can happen at the same timestamp)
  const paperTradeMap = new Map<number, typeof paperTrades>();
  for (const t of paperTrades) {
    const ts = Number(t.timestamp);
    if (!paperTradeMap.has(ts)) paperTradeMap.set(ts, []);
    paperTradeMap.get(ts)!.push(t);
  }

  const btTradeMap = new Map<number, typeof btTradesInPeriod>();
  for (const t of btTradesInPeriod) {
    if (!btTradeMap.has(t.timestamp)) btTradeMap.set(t.timestamp, []);
    btTradeMap.get(t.timestamp)!.push(t);
  }

  let matched = 0, mismatched = 0, paperOnly = 0, btOnly = 0;

  // Match paper trades to backtest trades
  for (const [ts, paperTrades_] of paperTradeMap) {
    const btTrades_ = btTradeMap.get(ts) || [];
    const usedBtIndices = new Set<number>();

    // For each paper trade, try to find a matching backtest trade
    for (const pt of paperTrades_) {
      let foundMatch = false;

      for (let btIdx = 0; btIdx < btTrades_.length; btIdx++) {
        if (usedBtIndices.has(btIdx)) continue;

        const bt = btTrades_[btIdx];
        const priceDiff = Math.abs(Number(pt.price) - bt.price);
        const priceTolerance = Math.max(50, bt.price * 0.001); // $50 or 0.1%, whichever is larger

        // Normalize action comparison: case-insensitive
        const paperActionNorm = pt.action.toLowerCase();
        const btActionNorm = bt.action.toLowerCase();

        if (paperActionNorm === btActionNorm && priceDiff <= priceTolerance) {
          // Match found
          matched++;
          usedBtIndices.add(btIdx);
          foundMatch = true;
          break;
        }
      }

      if (!foundMatch) {
        // Try to find by action only (price diff might be tolerance)
        let foundByAction = false;
        for (let btIdx = 0; btIdx < btTrades_.length; btIdx++) {
          if (usedBtIndices.has(btIdx)) continue;
          const bt = btTrades_[btIdx];
          const paperActionNorm = pt.action.toLowerCase();
          const btActionNorm = bt.action.toLowerCase();
          if (paperActionNorm === btActionNorm) {
            const priceDiff = Math.abs(Number(pt.price) - bt.price);
            const priceTolerance = Math.max(50, bt.price * 0.001);
            mismatched++;
            console.log(`  PRICE DIFF at ${new Date(ts).toISOString().slice(11,19)}: paper @${Number(pt.price).toFixed(1)} vs bt @${bt.price.toFixed(1)} (diff: $${priceDiff.toFixed(2)}, tolerance: $${priceTolerance.toFixed(2)})`);
            usedBtIndices.add(btIdx);
            foundByAction = true;
            break;
          }
        }

        if (!foundByAction) {
          // Action mismatch
          if (btTrades_.length > 0) {
            mismatched++;
            console.log(`  ACTION DIFF at ${new Date(ts).toISOString().slice(11,19)}: paper=${pt.action} vs bt=${btTrades_[0].action}`);
          } else {
            paperOnly++;
            console.log(`  PAPER ONLY at ${new Date(ts).toISOString().slice(11,19)}: ${pt.action} @${Number(pt.price).toFixed(1)}`);
          }
        }
      }
    }

    // Remaining backtest trades at this timestamp with no paper match
    for (let btIdx = 0; btIdx < btTrades_.length; btIdx++) {
      if (!usedBtIndices.has(btIdx)) {
        const bt = btTrades_[btIdx];
        btOnly++;
        console.log(`  BT ONLY at ${new Date(ts).toISOString().slice(11,19)}: ${bt.action} @${bt.price.toFixed(1)}`);
      }
    }
  }

  // Paper trades from timestamps not in backtest
  for (const [ts, paperTrades_] of paperTradeMap) {
    if (!btTradeMap.has(ts)) {
      for (const pt of paperTrades_) {
        paperOnly++;
        console.log(`  PAPER ONLY at ${new Date(ts).toISOString().slice(11,19)}: ${pt.action} @${Number(pt.price).toFixed(1)}`);
      }
    }
  }

  const total = matched + mismatched + paperOnly + btOnly;
  console.log(`\nMatched: ${matched} | Mismatched: ${mismatched} | Paper-only: ${paperOnly} | BT-only: ${btOnly}`);
  if (total > 0) console.log(`Match rate: ${((matched / total) * 100).toFixed(1)}%`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
