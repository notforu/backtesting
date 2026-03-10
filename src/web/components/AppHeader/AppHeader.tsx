/**
 * Application header with navigation, status, and auth controls.
 */

import type { BacktestResult } from '../../types';

interface AppHeaderProps {
  activePage: 'backtesting' | 'paper-trading';
  onNavigate: (page: 'backtesting' | 'paper-trading') => void;
  currentResult: BacktestResult | null;
  onShowParams: () => void;
  onShowExplorer: () => void;
  onShowLogin: () => void;
  isAuthenticated: boolean;
  username?: string;
  onLogout: () => void;
  hasParams: boolean;
}

export function AppHeader({
  activePage,
  onNavigate,
  currentResult,
  onShowParams,
  onShowExplorer,
  onShowLogin,
  isAuthenticated,
  username,
  onLogout,
  hasParams,
}: AppHeaderProps) {
  return (
    <header className="border-b border-gray-700 px-4 py-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <svg
              className="w-8 h-8 text-primary-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
              />
            </svg>
            <h1 className="text-xl font-bold text-white">Backtesting Platform</h1>
          </div>

          {/* Page navigation */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => onNavigate('backtesting')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activePage === 'backtesting'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Backtesting
            </button>
            <button
              onClick={() => onNavigate('paper-trading')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activePage === 'paper-trading'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Paper Trading
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* Status indicator + actions (only show in backtesting mode) */}
          {activePage === 'backtesting' && (
            <div className="flex items-center gap-4 text-sm">
              {currentResult && (
                <span className="text-gray-400">
                  Last run:{' '}
                  <span className="text-white">{currentResult.config.strategyName}</span>
                  {' '}on{' '}
                  <span className="text-white">{currentResult.config.symbol}</span>
                </span>
              )}
              {currentResult && hasParams && (
                <button
                  onClick={onShowParams}
                  className="px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  Params
                </button>
              )}
              <button
                onClick={onShowExplorer}
                className="px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  />
                </svg>
                Explore Runs
              </button>
            </div>
          )}

          {/* User info / login */}
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">{username}</span>
              <button
                onClick={onLogout}
                className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded transition-colors"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={onShowLogin}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
            >
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
