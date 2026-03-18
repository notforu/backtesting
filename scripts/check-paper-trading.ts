/**
 * check-paper-trading.ts
 *
 * Fetches paper trading session results from the production API and produces
 * a detailed analysis report. Compares live paper trading performance against
 * historical backtest predictions for the same time window.
 *
 * Usage:
 *   npx tsx scripts/check-paper-trading.ts
 *
 * Progress goes to stderr, report goes to stdout.
 */

const BASE_URL = 'http://5.223.56.226';

// ============================================================================
// Types (matching the API response shapes from src/paper-trading/db.ts)
// ============================================================================

interface SubStrategy {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
  exchange?: string;
}

interface AggregationConfig {
  subStrategies: SubStrategy[];
  allocationMode: string;
  maxPositions: number;
  initialCapital: number;
  mode?: string;
  exchange?: string;
}

interface PaperSession {
  id: string;
  name: string;
  aggregationConfig: AggregationConfig;
  aggregationConfigId: string | null;
  status: string;
  initialCapital: number;
  currentEquity: number;
  currentCash: number;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  positions: PaperPosition[];
}

interface PaperPosition {
  id: number;
  sessionId: string;
  symbol: string;
  direction: 'long' | 'short';
  subStrategyKey: string;
  entryPrice: number;
  amount: number;
  entryTime: number;
  unrealizedPnl: number;
  fundingAccumulated: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

interface PaperTrade {
  id: number;
  sessionId: string;
  symbol: string;
  action: string;
  price: number;
  amount: number;
  timestamp: number;
  pnl: number | null;
  pnlPercent: number | null;
  fee: number;
  fundingIncome: number;
  balanceAfter: number;
}

interface TradesResponse {
  trades: PaperTrade[];
  total: number;
}

interface EquitySnapshot {
  id: number;
  sessionId: string;
  timestamp: number;
  equity: number;
  cash: number;
  positionsValue: number;
}

interface BacktestRun {
  id: string;
  totalReturnPercent: number;
  sharpeRatio: number;
  startDate: number;
  endDate: number;
  runAt: string;
  params?: Record<string, unknown>;
}

interface AggregationRunsResponse {
  results: BacktestRun[];
  total?: number;
}

// ============================================================================
// API helpers
// ============================================================================

async function fetchJSON<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function progress(msg: string): void {
  process.stderr.write(`  ${msg}\n`);
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

function fmtDateTime(tsMs: number): string {
  return new Date(tsMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function fmtPct(val: number, digits = 2): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(digits)}%`;
}

function fmtUSD(val: number, digits = 2): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}$${Math.abs(val).toFixed(digits)}`;
}

function fmtDuration(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function bar(val: number, max: number, width = 20): string {
  const filled = Math.round((Math.abs(val) / Math.max(Math.abs(max), 1)) * width);
  const char = val >= 0 ? '#' : '-';
  return '[' + char.repeat(filled) + ' '.repeat(width - filled) + ']';
}

// ============================================================================
// Analysis functions
// ============================================================================

interface ClosedTrade {
  symbol: string;
  openTrade: PaperTrade;
  closeTrade: PaperTrade;
  pnl: number;
  pnlPct: number;
  durationMs: number;
  fees: number;
  fundingIncome: number;
}

function matchClosedTrades(trades: PaperTrade[]): ClosedTrade[] {
  // trades are sorted newest-first; reverse to process chronologically
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const closed: ClosedTrade[] = [];
  const openBySymbol = new Map<string, PaperTrade>();

  for (const t of sorted) {
    if (t.action === 'open_long' || t.action === 'open_short') {
      openBySymbol.set(t.symbol, t);
    } else if (t.action === 'close_long' || t.action === 'close_short') {
      const open = openBySymbol.get(t.symbol);
      if (open) {
        closed.push({
          symbol: t.symbol,
          openTrade: open,
          closeTrade: t,
          pnl: t.pnl ?? 0,
          pnlPct: t.pnlPercent ?? 0,
          durationMs: t.timestamp - open.timestamp,
          fees: open.fee + t.fee,
          fundingIncome: (open.fundingIncome ?? 0) + (t.fundingIncome ?? 0),
        });
        openBySymbol.delete(t.symbol);
      }
    }
  }

  return closed;
}

function computeMetrics(
  session: PaperSession,
  trades: PaperTrade[],
  closedTrades: ClosedTrade[],
  equity: EquitySnapshot[]
): {
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalFees: number;
  totalFundingIncome: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: ClosedTrade | null;
  worstTrade: ClosedTrade | null;
  avgDurationMs: number;
  totalReturnPct: number;
  openTradeCount: number;
  closedTradeCount: number;
} {
  const realizedPnL = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const unrealizedPnL = session.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalPnL = realizedPnL + unrealizedPnL;
  const totalFees = trades.reduce((s, t) => s + t.fee, 0);
  const totalFundingIncome = trades.reduce((s, t) => s + t.fundingIncome, 0);

  const wins = closedTrades.filter((t) => t.pnl > 0);
  const losses = closedTrades.filter((t) => t.pnl <= 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  const sorted = [...closedTrades].sort((a, b) => b.pnl - a.pnl);
  const bestTrade = sorted[0] ?? null;
  const worstTrade = sorted[sorted.length - 1] ?? null;

  const avgDurationMs =
    closedTrades.length > 0
      ? closedTrades.reduce((s, t) => s + t.durationMs, 0) / closedTrades.length
      : 0;

  const totalReturnPct = ((session.currentEquity - session.initialCapital) / session.initialCapital) * 100;

  const openTradeCount = session.positions.length;

  return {
    totalPnL,
    realizedPnL,
    unrealizedPnL,
    totalFees,
    totalFundingIncome,
    winRate,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    avgDurationMs,
    totalReturnPct,
    openTradeCount,
    closedTradeCount: closedTrades.length,
  };
}

// ============================================================================
// Backtest comparison
// ============================================================================

/**
 * Given a session's start date and today's date, compute the annualised daily return
 * rate implied by the backtest run, then project what that implies over the paper
 * trading window. This is an approximation — the backtest covers a different period
 * so we use daily return to project.
 */
function projectBacktestReturn(
  run: BacktestRun,
  sessionStartMs: number,
  nowMs: number
): {
  backtestDailyReturnPct: number;
  paperWindowDays: number;
  projectedReturnPct: number;
  projectedPnL: number;
  initialCapital: number;
} {
  const backtestDays = (run.endDate - run.startDate) / (1000 * 60 * 60 * 24);
  const paperWindowDays = (nowMs - sessionStartMs) / (1000 * 60 * 60 * 24);

  // Daily compounding rate implied by the backtest total return
  const backtestDailyReturnFactor = Math.pow(1 + run.totalReturnPercent / 100, 1 / backtestDays);
  const backtestDailyReturnPct = (backtestDailyReturnFactor - 1) * 100;

  // Project over paper trading window using simple multiplication (linear approximation)
  const projectedReturnPct = backtestDailyReturnPct * paperWindowDays;
  const projectedPnL = (projectedReturnPct / 100) * 10000; // assume $10k initial

  return {
    backtestDailyReturnPct,
    paperWindowDays,
    projectedReturnPct,
    projectedPnL,
    initialCapital: 10000,
  };
}

// ============================================================================
// Session report printer
// ============================================================================

function printSessionReport(
  session: PaperSession,
  trades: PaperTrade[],
  equity: EquitySnapshot[],
  backtestRuns: BacktestRun[],
  nowMs: number,
  isTarget: boolean
): void {
  const closed = matchClosedTrades(trades);
  const m = computeMetrics(session, trades, closed, equity);

  const sessionDays = (nowMs - session.createdAt) / (1000 * 60 * 60 * 24);
  const symbols = session.aggregationConfig.subStrategies.map((s) => s.symbol.replace('/USDT:USDT', '')).join(', ');
  const hasOptimizedParams = session.aggregationConfig.subStrategies.some(
    (s) => Object.keys(s.params).length > 0
  );

  const divider = '='.repeat(72);
  const thinDiv = '-'.repeat(72);

  console.log(divider);
  if (isTarget) {
    console.log(`  *** TARGET SESSION ***`);
  }
  console.log(`  SESSION: ${session.name}`);
  console.log(`  ID: ${session.id}`);
  console.log(divider);

  // Basic info
  console.log('');
  console.log('  OVERVIEW');
  console.log(thinDiv);
  console.log(`  Status          : ${session.status.toUpperCase()}`);
  console.log(`  Started         : ${fmtDateTime(session.createdAt)} (${sessionDays.toFixed(1)} days ago)`);
  console.log(`  Last tick       : ${session.lastTickAt ? fmtDateTime(session.lastTickAt) : 'never'}`);
  console.log(`  Tick count      : ${session.tickCount}`);
  console.log(`  Symbols (${session.aggregationConfig.subStrategies.length})     : ${symbols}`);
  console.log(`  Allocation mode : ${session.aggregationConfig.allocationMode}`);
  console.log(`  Max positions   : ${session.aggregationConfig.maxPositions}`);
  console.log(`  Optimized params: ${hasOptimizedParams ? 'YES (walk-forward validated)' : 'NO (defaults)'}`);
  console.log(`  Initial capital : $${session.initialCapital.toFixed(2)}`);
  console.log(`  Current equity  : $${session.currentEquity.toFixed(2)}`);
  console.log('');

  // P&L summary
  console.log('  P&L SUMMARY');
  console.log(thinDiv);
  console.log(`  Total return    : ${fmtPct(m.totalReturnPct)} (${fmtUSD(m.totalPnL)})`);
  console.log(`  Realized P&L    : ${fmtUSD(m.realizedPnL)}`);
  console.log(`  Unrealized P&L  : ${fmtUSD(m.unrealizedPnL)} (${session.positions.length} open)`);
  console.log(`  Total fees paid : ${fmtUSD(-m.totalFees)}`);
  console.log(`  Funding income  : ${fmtUSD(m.totalFundingIncome)}`);
  console.log('');

  // Trade stats
  console.log('  TRADE STATISTICS');
  console.log(thinDiv);
  if (m.closedTradeCount === 0 && m.openTradeCount === 0) {
    console.log('  *** NO TRADES YET — strategy has not triggered any signals ***');
    console.log('  This may indicate:');
    console.log('    - Funding rates have not spiked above threshold during this period');
    console.log('    - Market conditions do not match strategy entry criteria');
    console.log('    - Session may have a configuration issue');
  } else {
    console.log(`  Closed trades   : ${m.closedTradeCount}`);
    console.log(`  Open positions  : ${m.openTradeCount}`);
    if (m.closedTradeCount > 0) {
      console.log(`  Win rate        : ${m.winRate.toFixed(1)}% (${closed.filter(t => t.pnl > 0).length}W / ${closed.filter(t => t.pnl <= 0).length}L)`);
      console.log(`  Avg win         : ${fmtPct(m.avgWin)}`);
      console.log(`  Avg loss        : ${fmtPct(m.avgLoss)}`);
      console.log(`  Avg duration    : ${fmtDuration(m.avgDurationMs)}`);
    }
    if (m.closedTradeCount < 5) {
      console.log(`  *** INSUFFICIENT DATA: only ${m.closedTradeCount} closed trade(s) — statistics are not meaningful ***`);
    }
  }
  console.log('');

  // Best/worst trades
  if (m.bestTrade || m.worstTrade) {
    console.log('  NOTABLE TRADES');
    console.log(thinDiv);
    if (m.bestTrade) {
      const t = m.bestTrade;
      console.log(`  Best trade      : ${t.symbol.replace('/USDT:USDT', '')} ${fmtPct(t.pnlPct)} (${fmtUSD(t.pnl)})`);
      console.log(`                    Entry: ${fmtDate(t.openTrade.timestamp)} @ $${t.openTrade.price.toFixed(4)}`);
      console.log(`                    Exit:  ${fmtDate(t.closeTrade.timestamp)} @ $${t.closeTrade.price.toFixed(4)}`);
      console.log(`                    Duration: ${fmtDuration(t.durationMs)}`);
    }
    if (m.worstTrade && m.worstTrade !== m.bestTrade) {
      const t = m.worstTrade;
      console.log(`  Worst trade     : ${t.symbol.replace('/USDT:USDT', '')} ${fmtPct(t.pnlPct)} (${fmtUSD(t.pnl)})`);
      console.log(`                    Entry: ${fmtDate(t.openTrade.timestamp)} @ $${t.openTrade.price.toFixed(4)}`);
      console.log(`                    Exit:  ${fmtDate(t.closeTrade.timestamp)} @ $${t.closeTrade.price.toFixed(4)}`);
      console.log(`                    Duration: ${fmtDuration(t.durationMs)}`);
    }
    console.log('');
  }

  // Per-symbol breakdown from closed trades
  if (closed.length > 0) {
    console.log('  PER-SYMBOL BREAKDOWN (closed trades)');
    console.log(thinDiv);
    const bySymbol = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of closed) {
      const sym = t.symbol.replace('/USDT:USDT', '');
      const entry = bySymbol.get(sym) ?? { pnl: 0, count: 0, wins: 0 };
      entry.pnl += t.pnl;
      entry.count += 1;
      if (t.pnl > 0) entry.wins += 1;
      bySymbol.set(sym, entry);
    }
    const maxAbsPnl = Math.max(...[...bySymbol.values()].map((v) => Math.abs(v.pnl)));
    for (const [sym, data] of [...bySymbol.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = data.count > 0 ? ((data.wins / data.count) * 100).toFixed(0) : '0';
      console.log(
        `  ${sym.padEnd(8)} ${bar(data.pnl, maxAbsPnl)}  ${fmtUSD(data.pnl).padStart(9)}  ${data.wins}/${data.count} (${wr}% WR)`
      );
    }
    console.log('');
  }

  // Open positions
  if (session.positions.length > 0) {
    console.log('  OPEN POSITIONS');
    console.log(thinDiv);
    for (const pos of session.positions) {
      const sym = pos.symbol.replace('/USDT:USDT', '');
      const dur = fmtDuration(nowMs - pos.entryTime);
      console.log(
        `  ${sym.padEnd(8)} ${pos.direction.toUpperCase().padEnd(5)}  Entry: $${pos.entryPrice.toFixed(4).padStart(10)}  UnrealPnL: ${fmtUSD(pos.unrealizedPnl).padStart(9)}  Funding: ${fmtUSD(pos.fundingAccumulated).padStart(8)}  Open ${dur}`
      );
    }
    console.log('');
  }

  // Backtest comparison
  if (backtestRuns.length > 0) {
    console.log('  BACKTEST vs PAPER TRADING COMPARISON');
    console.log(thinDiv);

    // Use the most recent backtest run for projection
    const latestRun = backtestRuns[0];
    const backtestStartDate = fmtDate(latestRun.startDate);
    const backtestEndDate = fmtDate(latestRun.endDate);
    const backtestDays = (latestRun.endDate - latestRun.startDate) / (1000 * 60 * 60 * 24);
    const projection = projectBacktestReturn(latestRun, session.createdAt, nowMs);

    console.log(`  Reference backtest: ${backtestStartDate} to ${backtestEndDate} (${backtestDays.toFixed(0)} days)`);
    console.log(`  Backtest total return : ${fmtPct(latestRun.totalReturnPercent)}`);
    console.log(`  Backtest Sharpe       : ${latestRun.sharpeRatio.toFixed(2)}`);
    console.log(`  Backtest daily return : ${fmtPct(projection.backtestDailyReturnPct, 4)}/day`);
    console.log('');
    console.log(`  Paper trading window  : ${fmtDate(session.createdAt)} to ${fmtDate(nowMs)} (${projection.paperWindowDays.toFixed(1)} days)`);
    console.log(`  Projected return      : ${fmtPct(projection.projectedReturnPct)} (at backtest rate × days)`);
    console.log(`  Projected P&L         : ${fmtUSD(projection.projectedPnL)}`);
    console.log(`  Actual return         : ${fmtPct(m.totalReturnPct)}`);
    console.log(`  Actual P&L            : ${fmtUSD(m.totalPnL)}`);

    const gap = m.totalReturnPct - projection.projectedReturnPct;
    const gapUSD = m.totalPnL - projection.projectedPnL;
    console.log('');
    if (Math.abs(projection.projectedReturnPct) < 0.01) {
      console.log('  NOTE: Projected return is near zero (short window). No meaningful gap to compute.');
    } else {
      console.log(`  Deviation from projection: ${fmtPct(gap)} (${fmtUSD(gapUSD)})`);
      if (gap >= 0) {
        console.log('  VERDICT: Paper trading is OUTPERFORMING or on-par with backtest projection.');
      } else if (gap > -projection.projectedReturnPct * 0.5) {
        console.log('  VERDICT: Paper trading is UNDERPERFORMING projection by <50% — within expected variance.');
      } else {
        console.log('  VERDICT: Paper trading is significantly UNDERPERFORMING the backtest projection.');
        console.log('           Consider: market regime change, overfitting, or execution differences.');
      }
    }
    console.log('');
    console.log('  IMPORTANT CAVEATS:');
    console.log('  - Backtest covers 2024-01 to 2026-02; paper trading covers different (live) conditions');
    console.log('  - Projection uses linear daily rate — compound returns compress over short windows');
    console.log('  - Short paper trading windows (<30 days) have high variance; conclusions are premature');
    console.log('  - Funding rate strategies are event-driven; few events = legitimate zero-return periods');
  } else {
    console.log('  BACKTEST COMPARISON: No reference backtest runs found for this aggregation config.');
  }

  console.log('');
}

// ============================================================================
// Summary table across all sessions
// ============================================================================

function printSummaryTable(
  sessions: PaperSession[],
  metricsBySession: Map<string, { totalReturnPct: number; closedTradeCount: number; openCount: number; sessionDays: number }>
): void {
  const divider = '='.repeat(72);
  console.log(divider);
  console.log('  ALL SESSIONS SUMMARY TABLE');
  console.log(divider);
  console.log('');
  console.log(
    '  ' +
    'Session Name'.padEnd(38) +
    'Days'.padStart(5) +
    'Trades'.padStart(8) +
    'Open'.padStart(6) +
    'Return'.padStart(10) +
    'Status'.padStart(10)
  );
  console.log('  ' + '-'.repeat(70));

  for (const session of sessions) {
    const m = metricsBySession.get(session.id);
    if (!m) continue;
    const shortName = session.name.length > 36 ? session.name.slice(0, 33) + '...' : session.name;
    const returnStr = fmtPct(m.totalReturnPct).padStart(10);
    const indicator = m.totalReturnPct > 0 ? '  ' : m.totalReturnPct < 0 ? '  ' : '  ';
    console.log(
      `  ${shortName.padEnd(38)}${m.sessionDays.toFixed(0).padStart(5)}${m.closedTradeCount.toString().padStart(8)}${m.openCount.toString().padStart(6)}${returnStr}${session.status.padStart(10)}`
    );
    void indicator;
  }
  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const nowMs = Date.now();

  // Highlighted target sessions from the task description
  const TARGET_SESSIONS = new Set(['8c1fbd9b', '416d18ff']);

  process.stderr.write('\nFetching paper trading sessions from production...\n');
  const sessions = await fetchJSON<PaperSession[]>('/api/paper-trading/sessions');
  progress(`Found ${sessions.length} sessions total`);

  // ── fetch details for each session in parallel ──────────────────────────

  const sessionDetails: PaperSession[] = [];
  const tradesBySession = new Map<string, PaperTrade[]>();
  const equityBySession = new Map<string, EquitySnapshot[]>();
  const backtestBySession = new Map<string, BacktestRun[]>();

  for (const session of sessions) {
    progress(`Loading session: ${session.name} (${session.id.slice(0, 8)})`);

    // Full detail includes positions
    const detail = await fetchJSON<PaperSession>(`/api/paper-trading/sessions/${session.id}`);
    sessionDetails.push(detail);

    // All trades (fetch up to 500 — unlikely to exceed for now)
    const tradesResp = await fetchJSON<TradesResponse>(
      `/api/paper-trading/sessions/${session.id}/trades?limit=500`
    );
    tradesBySession.set(session.id, tradesResp.trades);
    progress(`  Trades: ${tradesResp.total}`);

    // Equity curve
    const equityCurve = await fetchJSON<EquitySnapshot[]>(
      `/api/paper-trading/sessions/${session.id}/equity`
    );
    equityBySession.set(session.id, equityCurve);

    // Backtest runs for the associated aggregation config
    if (detail.aggregationConfigId) {
      try {
        const runsResp = await fetchJSON<AggregationRunsResponse>(
          `/api/aggregations/${detail.aggregationConfigId}/runs?limit=5`
        );
        const runs = runsResp.results ?? [];
        // Sort by runAt descending (most recent first)
        runs.sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime());
        backtestBySession.set(session.id, runs);
        progress(`  Backtest runs found: ${runs.length}`);
      } catch {
        progress(`  No backtest runs found for aggregation config ${detail.aggregationConfigId}`);
        backtestBySession.set(session.id, []);
      }
    } else {
      backtestBySession.set(session.id, []);
    }
  }

  // ── build summary metrics ─────────────────────────────────────────────────

  const metricsBySession = new Map<string, { totalReturnPct: number; closedTradeCount: number; openCount: number; sessionDays: number }>();
  for (const session of sessionDetails) {
    const trades = tradesBySession.get(session.id) ?? [];
    const closed = matchClosedTrades(trades);
    const totalReturnPct = ((session.currentEquity - session.initialCapital) / session.initialCapital) * 100;
    const sessionDays = (nowMs - session.createdAt) / (1000 * 60 * 60 * 24);
    metricsBySession.set(session.id, {
      totalReturnPct,
      closedTradeCount: closed.length,
      openCount: session.positions.length,
      sessionDays,
    });
  }

  // ── print report ─────────────────────────────────────────────────────────

  const reportDate = new Date(nowMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  console.log('');
  console.log('================================================================================');
  console.log('  PAPER TRADING ANALYSIS REPORT');
  console.log(`  Generated: ${reportDate}`);
  console.log('================================================================================');
  console.log('');

  // Sort: target sessions first, then by creation date descending
  const sortedSessions = [...sessionDetails].sort((a, b) => {
    const aTarget = TARGET_SESSIONS.has(a.id.slice(0, 8)) ? 0 : 1;
    const bTarget = TARGET_SESSIONS.has(b.id.slice(0, 8)) ? 0 : 1;
    if (aTarget !== bTarget) return aTarget - bTarget;
    return b.createdAt - a.createdAt;
  });

  // Summary table first
  printSummaryTable(sortedSessions, metricsBySession);

  // Key overall observations
  console.log('================================================================================');
  console.log('  KEY OBSERVATIONS');
  console.log('================================================================================');
  console.log('');

  const totalTrades = [...tradesBySession.values()].reduce((s, t) => s + t.length, 0);
  const runningCount = sessionDetails.filter((s) => s.status === 'running').length;
  const positiveSessions = sessionDetails.filter((s) => {
    const m = metricsBySession.get(s.id);
    return m && m.totalReturnPct > 0;
  }).length;
  const negativeSessions = sessionDetails.filter((s) => {
    const m = metricsBySession.get(s.id);
    return m && m.totalReturnPct < 0;
  }).length;

  console.log(`  Active sessions   : ${runningCount}/${sessionDetails.length}`);
  console.log(`  Total trades      : ${totalTrades} across all sessions`);
  console.log(`  Positive sessions : ${positiveSessions}`);
  console.log(`  Negative sessions : ${negativeSessions}`);
  console.log(`  Flat (no trades)  : ${sessionDetails.length - positiveSessions - negativeSessions}`);
  console.log('');

  // Data sufficiency warning
  const allClosed = [...tradesBySession.values()].flatMap(matchClosedTrades);
  const totalClosed = allClosed.length;
  if (totalClosed < 20) {
    console.log('  *** WARNING: Very few closed trades across all sessions ***');
    console.log(`  Total closed trades: ${totalClosed}`);
    console.log('  Statistical significance requires at least 30-50 trades for meaningful metrics.');
    console.log('  Current data is useful for tracking activity but NOT for strategy validation.');
    console.log('');
  }

  console.log('');

  // Full session reports
  for (const session of sortedSessions) {
    const trades = tradesBySession.get(session.id) ?? [];
    const equity = equityBySession.get(session.id) ?? [];
    const backtestRuns = backtestBySession.get(session.id) ?? [];
    const isTarget = TARGET_SESSIONS.has(session.id.slice(0, 8));

    printSessionReport(session, trades, equity, backtestRuns, nowMs, isTarget);
  }

  console.log('================================================================================');
  console.log('  END OF REPORT');
  console.log('================================================================================');
  console.log('');
}

main().catch((err) => {
  process.stderr.write(`\nFATAL ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
