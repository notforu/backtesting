# Changelog: Polymarket Paper Trading System

**Date:** 2026-02-17 13:29
**Type:** New Feature

## Summary

Added a real-time paper trading system for Polymarket that monitors selected markets and simulates mean-reversion trades using Bollinger Band logic.

## New Files

### `/workspace/src/paper-trading/pm-paper-trader.ts`

Core paper trading module with:

- **Types**: `PaperTraderConfig`, `PaperPosition`, `PaperTrade`, `PaperTraderState`, `BBStrategyParams`
- **Price fetching**: Polls `gamma-api.polymarket.com/markets?slug=SLUG` for live YES prices, rate-limited to 1 req/sec
- **BB logic**: Inline re-implementation of `pm-mean-reversion.ts` strategy (no engine dependency)
  - Rolling price buffer per market
  - Entry on price crossing BB bands with min-profit and BB-width filters
  - Exit on mean reversion with exit-stddev threshold and extreme-zone safety exit
  - Cooldown bars between trades
- **Slippage simulation**: Applies configurable slippage % on entry and exit (both sides)
- **Position management**: One position per market, tracks costBasis, amount, entryPrice
- **P&L tracking**: Realized P&L accumulated, win/loss counts
- **State persistence**: Saves/loads JSON state to `/workspace/data/paper-trading-state.json` every poll cycle
- **Logging**: Appends to `/workspace/data/paper-trading.log` with timestamped entries
- **Graceful shutdown**: SIGINT handler saves state and prints final status
- **Hourly summaries**: Prints P&L summary and open position details each hour

### `/workspace/scripts/pm-paper-trade.ts`

CLI entry point with four modes:

| Mode | Usage |
|------|-------|
| `--mode=auto` | Calls `selectMarkets()` to pick STRONG + MODERATE markets from DB |
| `--markets=slug1,...` | Trade specific market slugs |
| `--resume` | Load saved state file and continue |
| `--status` | Print current positions and P&L then exit |

**All CLI flags:**
- `--capital=10000` - Starting capital in USD
- `--slippage=1.0` - Slippage % per side
- `--interval=60` - Poll interval in seconds
- `--per-market=1000` - Capital per market position
- `--bb-period=20` - BB period
- `--bb-stddev=2.0` - BB standard deviations
- `--exit-stddev=0.5` - Exit threshold from mean
- `--min-bb-width=0.08` - Min BB width to enter
- `--min-profit=4` - Min expected profit % to enter
- `--cooldown=3` - Cooldown bars after close

### `package.json`

Added `"paper-trade"` npm script shortcut:
```
npm run paper-trade -- --mode=auto --capital=10000
```

## Console Output Format

**Per poll cycle:**
```
[14:30:01] Polled 9/9 markets (0 failed) | Positions: 3 open | P&L: +$42.50 (+0.43%) | Trades: 12W/3L
```

**Trade events:**
```
[14:30:01] OPEN LONG  PM:cboe-futures @ 0.2400 (exec: 0.2424, slip: 1%) | $1000.00 position | expected: +8.2%
[15:45:01] CLOSE LONG PM:cboe-futures @ 0.2800 (exec: 0.2772, slip: 1%) | P&L: +$71.78 (+14.4%)
```

**Hourly summary:**
```
=== Hourly Summary (14:00-15:00) ===
Capital: $10,042.50 | Open Positions: 3 | Closed Trades: 2 (2W/0L)
Open: PM:cboe-futures (LONG @ 0.240, now 0.260, +$41)
Hourly P&L: +$42.50
```

## Usage Examples

```bash
# Start on auto-selected markets
npx tsx scripts/pm-paper-trade.ts --mode=auto --capital=10000

# Or using npm script
npm run paper-trade -- --mode=auto

# Start on specific markets
npx tsx scripts/pm-paper-trade.ts --markets="will-trump-win,fed-rate-cut" --capital=5000

# Resume after restart
npx tsx scripts/pm-paper-trade.ts --resume

# Check current status
npx tsx scripts/pm-paper-trade.ts --status
```
