/**
 * PaperTradesTable — historical paper trades table.
 * Displays up to 200 trades with PnL coloring, funding income, and action badges.
 */

import { fmtUsd } from '../PaperTradingPanel/PaperTradingPanel';
import type { PaperTrade } from '../../types';

interface PaperTradesTableProps {
  trades: PaperTrade[];
  isMultiAsset: boolean;
  selectedAssetLabel: string | null;
  isFutures: boolean;
}

export function PaperTradesTable({
  trades,
  isMultiAsset,
  selectedAssetLabel,
  isFutures,
}: PaperTradesTableProps) {
  const title = [
    `Trades (${trades.length}`,
    isMultiAsset && selectedAssetLabel ? ` - ${selectedAssetLabel}` : '',
    isMultiAsset && !selectedAssetLabel ? ' - All Assets' : '',
    ')',
  ].join('');

  return (
    <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
      {trades.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-2 pr-3 md:pr-4">#</th>
                {isMultiAsset && !selectedAssetLabel && <th className="pb-2 pr-3 md:pr-4">Asset</th>}
                <th className="pb-2 pr-3 md:pr-4">Action</th>
                <th className="pb-2 pr-3 md:pr-4">Price</th>
                <th className="pb-2 pr-3 md:pr-4 hidden sm:table-cell">Amount</th>
                <th className="pb-2 pr-3 md:pr-4">P&amp;L</th>
                <th className="pb-2 pr-3 md:pr-4">P&amp;L %</th>
                <th className="pb-2 pr-3 md:pr-4 hidden sm:table-cell">Fee</th>
                {isFutures && <th className="pb-2 pr-3 md:pr-4 hidden sm:table-cell">Funding</th>}
                <th className="pb-2 pr-3 md:pr-4 hidden sm:table-cell">Balance</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 200).map((trade, index) => {
                const isClose = trade.action === 'close_long' || trade.action === 'close_short';
                const actionLabel =
                  trade.action === 'open_long' ? 'Open Long'
                  : trade.action === 'open_short' ? 'Open Short'
                  : trade.action === 'close_long' ? 'Close Long' : 'Close Short';
                const actionColor = trade.action.startsWith('open')
                  ? 'bg-green-900/50 text-green-400'
                  : 'bg-red-900/50 text-red-400';

                return (
                  <tr key={trade.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 pr-3 md:pr-4 text-gray-500">{index + 1}</td>
                    {isMultiAsset && !selectedAssetLabel && (
                      <td className="py-2 pr-3 md:pr-4 text-gray-400 text-xs">
                        {trade.symbol?.replace('/USDT:USDT', '') ?? '-'}
                      </td>
                    )}
                    <td className="py-2 pr-3 md:pr-4">
                      <span className={`px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium ${actionColor}`}>
                        {actionLabel}
                      </span>
                    </td>
                    <td className="py-2 pr-3 md:pr-4 text-white whitespace-nowrap">{fmtUsd(trade.price)}</td>
                    <td className="py-2 pr-3 md:pr-4 text-gray-300 hidden sm:table-cell">{trade.amount.toFixed(6)}</td>
                    <td className={`py-2 pr-3 md:pr-4 whitespace-nowrap ${
                      isClose
                        ? (trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        : 'text-gray-500'
                    }`}>
                      {isClose
                        ? `${(trade.pnl ?? 0) >= 0 ? '+' : ''}${fmtUsd(trade.pnl ?? 0)}`
                        : '-'}
                    </td>
                    <td className={`py-2 pr-3 md:pr-4 whitespace-nowrap ${
                      isClose
                        ? (trade.pnlPercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        : 'text-gray-500'
                    }`}>
                      {isClose
                        ? `${(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%`
                        : '-'}
                    </td>
                    <td className="py-2 pr-3 md:pr-4 text-gray-400 hidden sm:table-cell">
                      {trade.fee ? fmtUsd(trade.fee) : '-'}
                    </td>
                    {isFutures && (
                      <td className={`py-2 pr-3 md:pr-4 hidden sm:table-cell ${
                        trade.fundingIncome != null && trade.fundingIncome !== 0
                          ? trade.fundingIncome >= 0 ? 'text-green-400' : 'text-red-400'
                          : 'text-gray-600'
                      }`}>
                        {trade.fundingIncome != null && trade.fundingIncome !== 0
                          ? `${trade.fundingIncome >= 0 ? '+' : ''}${fmtUsd(trade.fundingIncome)}`
                          : isClose ? '$0.00' : '-'}
                      </td>
                    )}
                    <td className="py-2 pr-3 md:pr-4 text-gray-300 hidden sm:table-cell whitespace-nowrap">{fmtUsd(trade.balanceAfter)}</td>
                    <td className="py-2 text-gray-400 whitespace-nowrap text-[10px] md:text-xs">
                      {new Date(trade.timestamp).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {trades.length > 200 && (
            <p className="text-sm text-gray-500 mt-3 text-center">
              Showing first 200 of {trades.length} trades
            </p>
          )}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">
          No trades yet{selectedAssetLabel ? ` for ${selectedAssetLabel}` : ''}
        </p>
      )}
    </section>
  );
}
