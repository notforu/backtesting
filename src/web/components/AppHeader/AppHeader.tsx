/**
 * Application header with navigation, status, and auth controls.
 * Responsive: hamburger menu on mobile (< md), horizontal layout on desktop.
 */

import { useState, useEffect, useRef } from 'react';
import type { BacktestResult } from '../../types';
import type { ActivePage } from '../../stores/paperTradingStore.js';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore.js';

interface AppHeaderProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  currentResult: BacktestResult | null;
  onShowParams: () => void;
  onShowExplorer: () => void;
  onShowLogin: () => void;
  isAuthenticated: boolean;
  username?: string;
  onLogout: () => void;
  hasParams: boolean;
}

const NAV_ITEMS: { label: string; page: ActivePage }[] = [
  { label: 'Backtesting', page: 'backtesting' },
  { label: 'Configurations', page: 'configurations' },
  { label: 'Trading', page: 'paper-trading' },
];

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
  const openRunBacktestModal = useRunBacktestModalStore((s) => s.open);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleNavigate(page: ActivePage) {
    onNavigate(page);
    setMenuOpen(false);
  }

  return (
    <header className="border-b border-gray-700 px-4 py-3 flex-shrink-0 relative" ref={menuRef}>
      <div className="flex items-center justify-between">
        {/* Left side: logo + desktop nav */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <svg
              className="w-8 h-8 text-primary-400 flex-shrink-0"
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
            {/* Title: hide subtitle text on mobile, show on desktop */}
            <h1 className="text-xl font-bold text-white hidden md:block">Backtesting Platform</h1>
            <h1 className="text-base font-bold text-white md:hidden">BT Platform</h1>
          </div>

          {/* Desktop page navigation — hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1" data-testid="desktop-nav">
            {NAV_ITEMS.map(({ label, page }) => (
              <button
                key={page}
                data-page={page}
                onClick={() => onNavigate(page)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  activePage === page
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 md:gap-4">
          {/* Action buttons (backtesting page) — hidden on mobile, shown on desktop */}
          {activePage === 'backtesting' && (
            <div className="hidden md:flex items-center gap-4 text-sm">
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
              <button
                onClick={() => openRunBacktestModal()}
                className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Backtest
              </button>
            </div>
          )}

          {/* User info / login — always visible */}
          {isAuthenticated ? (
            <div className="hidden md:flex items-center gap-3">
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
              className="hidden md:inline-flex px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
            >
              Login
            </button>
          )}

          {/* Hamburger button — visible only on mobile */}
          <button
            className="flex md:hidden items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? (
              /* X icon */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              /* Hamburger icon */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          data-testid="mobile-menu"
          className="md:hidden absolute top-full left-0 right-0 z-50 bg-gray-800 border-b border-gray-700 shadow-lg"
        >
          {/* Navigation items */}
          <nav className="flex flex-col px-4 py-2 gap-1">
            {NAV_ITEMS.map(({ label, page }) => (
              <button
                key={page}
                onClick={() => handleNavigate(page)}
                className={`w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  activePage === page
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Divider */}
          <div className="border-t border-gray-700 mx-4" />

          {/* Auth section */}
          <div className="px-4 py-3 flex items-center justify-between">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-gray-400">{username}</span>
                <button
                  onClick={() => { onLogout(); setMenuOpen(false); }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => { onShowLogin(); setMenuOpen(false); }}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
              >
                Login
              </button>
            )}
          </div>

          {/* Backtesting action buttons in mobile menu */}
          {activePage === 'backtesting' && (
            <>
              <div className="border-t border-gray-700 mx-4" />
              <div className="px-4 py-3 flex flex-col gap-2">
                {currentResult && hasParams && (
                  <button
                    onClick={() => { onShowParams(); setMenuOpen(false); }}
                    className="w-full px-3 py-2.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg transition-colors flex items-center gap-2"
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
                  onClick={() => { onShowExplorer(); setMenuOpen(false); }}
                  className="w-full px-3 py-2.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg transition-colors flex items-center gap-2"
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
                <button
                  onClick={() => { openRunBacktestModal(); setMenuOpen(false); }}
                  className="w-full px-3 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Backtest
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}
