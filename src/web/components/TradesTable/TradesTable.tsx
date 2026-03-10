/**
 * TradesTable component.
 * Displays a table of backtest trades with PnL coloring and funding info.
 */

import { getTradeActionLabel, getTradeActionColor, isCloseTrade } from '../../types';
import type { Trade, PerformanceMetrics } from '../../types';

interface TradesTableProps {
  trades: Trade[];
  metrics: PerformanceMetrics;
  /** When true, shows an "Asset" column and the asset name suffix filter */
  showAssetColumn?: boolean;
  /** Optional label shown next to the trade count heading */
  assetLabel?: string;
}

export function TradesTable({
  trades,
  metrics,
  showAssetColumn = false,
  assetLabel,
}: TradesTableProps) {
  const isFutures = metrics.totalFundingIncome !== undefined;
  const displayedTrades = trades;

  return (
    <>
      <h2 className="text-lg font-semibold text-white mb-4">
        Trades ({displayedTrades.length}
        {assetLabel && ` - ${assetLabel}`}
        )
      </h2>

      {/* PnL Clarity Banner - shown only in futures mode when funding income data is available */}
      {isFutures && !showAssetColumn && (
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-gray-400">Trading P&amp;L: </span>
            <span
              className={`font-semibold ${(metrics.tradingPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {(metrics.tradingPnl ?? 0) >= 0 ? '+' : ''}$
              {(metrics.tradingPnl ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="text-gray-600 hidden sm:block">|</div>
          <div>
            <span className="text-gray-400">Funding Income: </span>
            <span
              className={`font-semibold ${(metrics.totalFundingIncome ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {(metrics.totalFundingIncome ?? 0) >= 0 ? '+' : ''}$
              {(metrics.totalFundingIncome ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="text-gray-600 hidden sm:block">|</div>
          <div>
            <span className="text-gray-400">Total Return: </span>
            <span
              className={`font-semibold ${metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {metrics.totalReturn >= 0 ? '+' : ''}$
              {metrics.totalReturn.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="pb-2 pr-4">#</th>
              {showAssetColumn && <th className="pb-2 pr-4">Asset</th>}
              <th className="pb-2 pr-4">Action</th>
              <th className="pb-2 pr-4">Price</th>
              <th className="pb-2 pr-4">Amount</th>
              <th className="pb-2 pr-4">P&L</th>
              <th className="pb-2 pr-4">P&L %</th>
              <th className="pb-2 pr-4">Cost</th>
              {isFutures && (
                <>
                  <th className="pb-2 pr-4">Funding</th>
                  <th className="pb-2 pr-4">FR Rate</th>
                </>
              )}
              <th className="pb-2 pr-4">Balance</th>
              <th className="pb-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {displayedTrades.slice(0, 100).map((trade, index) => {
              const hasClosePnl = isCloseTrade(trade);
              return (
                <tr
                  key={trade.id}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  <td className="py-2 pr-4 text-gray-500">{index + 1}</td>
                  {showAssetColumn && (
                    <td className="py-2 pr-4 text-gray-400 text-xs">
                      {trade.symbol?.replace('/USDT:USDT', '') ?? '-'}
                    </td>
                  )}
                  <td className="py-2 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getTradeActionColor(trade.action)}`}
                    >
                      {getTradeActionLabel(trade.action)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-white">
                    ${trade.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2 pr-4 text-gray-300">{trade.amount.toFixed(6)}</td>
                  <td
                    className={`py-2 pr-4 ${
                      hasClosePnl
                        ? (trade.pnl ?? 0) >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                        : 'text-gray-500'
                    }`}
                  >
                    {hasClosePnl
                      ? `${(trade.pnl ?? 0) >= 0 ? '+' : ''}$${(trade.pnl ?? 0).toFixed(2)}`
                      : '-'}
                  </td>
                  <td
                    className={`py-2 pr-4 ${
                      hasClosePnl
                        ? (trade.pnlPercent ?? 0) >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                        : 'text-gray-500'
                    }`}
                  >
                    {hasClosePnl
                      ? `${(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%`
                      : '-'}
                  </td>
                  <td className="py-2 pr-4 text-gray-400">
                    {trade.fee || trade.slippage
                      ? `$${((trade.fee ?? 0) + (trade.slippage ?? 0)).toFixed(2)}`
                      : '-'}
                  </td>
                  {isFutures && (
                    <>
                      <td
                        className={`py-2 pr-4 ${
                          trade.fundingIncome == null
                            ? 'text-gray-600'
                            : trade.fundingIncome >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}
                      >
                        {trade.fundingIncome != null
                          ? `${trade.fundingIncome >= 0 ? '+' : ''}$${trade.fundingIncome.toFixed(2)}`
                          : '-'}
                      </td>
                      <td
                        className={`py-2 pr-4 font-mono text-xs ${
                          trade.fundingRate == null
                            ? 'text-gray-600'
                            : trade.fundingRate >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}
                      >
                        {trade.fundingRate != null
                          ? `${trade.fundingRate >= 0 ? '+' : ''}${(trade.fundingRate * 100).toFixed(4)}%`
                          : '-'}
                      </td>
                    </>
                  )}
                  <td className="py-2 pr-4 text-gray-300">
                    ${trade.balanceAfter.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2 text-gray-400">
                    {new Date(trade.timestamp).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayedTrades.length > 100 && (
          <p className="text-sm text-gray-500 mt-3 text-center">
            Showing first 100 of {displayedTrades.length} trades
          </p>
        )}
      </div>
    </>
  );
}
