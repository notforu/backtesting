/**
 * PaperPositionsTable — exchange-style positions + pending orders widget.
 * Displays open positions with unrealized PnL and derived pending SL/TP orders.
 */

import { useState } from 'react';
import { fmtUsd } from '../PaperTradingPanel/PaperTradingPanel';
import type { Candle, PaperPosition } from '../../types';

type PosOrderTab = 'positions' | 'orders';

/** Derive a mark price from the latest candle close. */
function getMarkPrice(chartCandles: Candle[] | null | undefined): number | null {
  if (!chartCandles || chartCandles.length === 0) return null;
  return chartCandles[chartCandles.length - 1].close;
}

/** Format a number as USD, compact for larger values */
function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(n < 1 ? 6 : 4)}`;
}

type PendingOrder = {
  key: string;
  posId: number;
  symbol: string;
  direction: 'long' | 'short';
  type: 'Stop Loss' | 'Take Profit';
  side: 'Sell' | 'Buy';
  triggerPrice: number;
  amount: number;
};

interface PaperPositionsTableProps {
  positions: PaperPosition[];
  chartCandles: Candle[] | null | undefined;
}

export function PaperPositionsTable({ positions, chartCandles }: PaperPositionsTableProps) {
  const [activeTab, setActiveTab] = useState<PosOrderTab>('positions');

  const pendingOrders: PendingOrder[] = [];
  for (const pos of positions) {
    if (pos.stopLoss != null) {
      pendingOrders.push({
        key: `sl-${pos.id}`,
        posId: pos.id,
        symbol: pos.symbol,
        direction: pos.direction,
        type: 'Stop Loss',
        side: pos.direction === 'long' ? 'Sell' : 'Buy',
        triggerPrice: pos.stopLoss,
        amount: pos.amount,
      });
    }
    if (pos.takeProfit != null) {
      pendingOrders.push({
        key: `tp-${pos.id}`,
        posId: pos.id,
        symbol: pos.symbol,
        direction: pos.direction,
        type: 'Take Profit',
        side: pos.direction === 'long' ? 'Sell' : 'Buy',
        triggerPrice: pos.takeProfit,
        amount: pos.amount,
      });
    }
  }

  const posCount = positions.length;
  const ordCount = pendingOrders.length;
  const markPrice = getMarkPrice(chartCandles);

  const symbolLabel = (sym: string) =>
    sym.replace('/USDT:USDT', '').replace('/USDT', '');

  return (
    <section className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center border-b border-gray-700 px-1">
        <button
          onClick={() => setActiveTab('positions')}
          className={`px-4 py-3 text-xs font-semibold transition-colors border-b-2 ${
            activeTab === 'positions'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Positions
          {posCount > 0 && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
              activeTab === 'positions' ? 'bg-primary-600/40 text-primary-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {posCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-3 text-xs font-semibold transition-colors border-b-2 ${
            activeTab === 'orders'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Orders
          {ordCount > 0 && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
              activeTab === 'orders' ? 'bg-primary-600/40 text-primary-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {ordCount}
            </span>
          )}
        </button>
      </div>

      {/* Positions tab */}
      {activeTab === 'positions' && (
        <>
          {positions.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No open positions
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Symbol</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Size</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden md:table-cell">Entry Price</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden md:table-cell">Mark Price</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Unr. PnL</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">PnL %</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden lg:table-cell">Margin</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden lg:table-cell">Funding</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden md:table-cell">SL</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden md:table-cell">TP</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap hidden sm:table-cell">Entry Time</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const mark = markPrice ?? pos.entryPrice;
                    const notional = pos.entryPrice * pos.amount;
                    const pnlPct = notional > 0 ? (pos.unrealizedPnl / notional) * 100 : 0;
                    const pnlPositive = pos.unrealizedPnl >= 0;

                    return (
                      <tr
                        key={pos.id}
                        className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              pos.direction === 'long'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}>
                              <span className="sm:hidden">{pos.direction === 'long' ? 'L' : 'S'}</span>
                              <span className="hidden sm:inline">{pos.direction === 'long' ? 'Long' : 'Short'}</span>
                            </span>
                            <span className="text-white font-semibold">
                              {symbolLabel(pos.symbol)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-300 font-mono">
                          {pos.amount.toFixed(pos.amount < 0.01 ? 6 : pos.amount < 1 ? 4 : 3)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-300 font-mono hidden md:table-cell">
                          {fmtPrice(pos.entryPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-200 font-mono hidden md:table-cell">
                          {fmtPrice(mark)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {pnlPositive ? '+' : ''}{fmtUsd(pos.unrealizedPnl)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400 font-mono hidden lg:table-cell">
                          {fmtUsd(notional)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono hidden lg:table-cell ${pos.fundingAccumulated >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pos.fundingAccumulated !== 0
                            ? `${pos.fundingAccumulated >= 0 ? '+' : ''}${fmtUsd(pos.fundingAccumulated)}`
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                          {pos.stopLoss != null
                            ? <span className="text-red-400">{fmtPrice(pos.stopLoss)}</span>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                          {pos.takeProfit != null
                            ? <span className="text-green-400">{fmtPrice(pos.takeProfit)}</span>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap hidden sm:table-cell">
                          {new Date(pos.entryTime).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Orders tab */}
      {activeTab === 'orders' && (
        <>
          {pendingOrders.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No pending orders
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Symbol</th>
                    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Type</th>
                    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap hidden sm:table-cell">Side</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Trigger Price</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Size</th>
                    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap hidden sm:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map((order) => {
                    const isSL = order.type === 'Stop Loss';
                    return (
                      <tr
                        key={order.key}
                        className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              order.direction === 'long'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}>
                              <span className="sm:hidden">{order.direction === 'long' ? 'L' : 'S'}</span>
                              <span className="hidden sm:inline">{order.direction === 'long' ? 'Long' : 'Short'}</span>
                            </span>
                            <span className="text-white font-semibold">
                              {symbolLabel(order.symbol)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isSL
                              ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                              : 'bg-green-500/15 text-green-400 border border-green-500/25'
                          }`}>
                            <span className="sm:hidden">{isSL ? 'SL' : 'TP'}</span>
                            <span className="hidden sm:inline">{order.type}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className={`font-semibold ${order.side === 'Sell' ? 'text-red-400' : 'text-green-400'}`}>
                            {order.side}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-200">
                          {fmtPrice(order.triggerPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-300">
                          {order.amount.toFixed(order.amount < 0.01 ? 6 : order.amount < 1 ? 4 : 3)}
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                            Pending
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
