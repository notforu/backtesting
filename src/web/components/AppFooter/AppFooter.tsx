/**
 * Application footer showing version and run status.
 */

import type { BacktestResult } from '../../types';
import type { ActivePage } from '../../stores/paperTradingStore.js';

interface AppFooterProps {
  activePage: ActivePage;
  currentResult: BacktestResult | null;
}

export function AppFooter({ activePage, currentResult }: AppFooterProps) {
  return (
    <footer className="border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex-shrink-0">
      <div className="flex items-center justify-between">
        <span>Backtesting Platform v1.0.0</span>
        <span>
          {activePage === 'backtesting' && currentResult && (
            <>
              Backtest completed in {currentResult.duration}ms |{' '}
              {currentResult.trades.length} trades
            </>
          )}
          {activePage === 'paper-trading' && 'Trading Mode'}
          {activePage === 'configurations' && 'Configurations'}
        </span>
      </div>
    </footer>
  );
}
