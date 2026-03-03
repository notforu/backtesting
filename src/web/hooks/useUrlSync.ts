/**
 * Bidirectional URL <-> Zustand state synchronization using the History API.
 *
 * URL structure:
 *   /                         → paper-trading page, no specific session
 *   /paper-trading            → paper-trading page, no specific session
 *   /paper-trading/:sessionId → paper-trading with specific session selected
 *   /backtesting              → backtesting page, no run loaded
 *   /backtesting/:runId       → backtesting page with specific run loaded
 */

import { useEffect, useRef } from 'react';
import { usePaperTradingStore } from '../stores/paperTradingStore';
import { useBacktestStore } from '../stores/backtestStore';

// ============================================================================
// Helpers
// ============================================================================

interface ParsedPath {
  page: 'backtesting' | 'paper-trading';
  resourceId: string | null;
}

function parsePathname(pathname: string): ParsedPath {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'backtesting') {
    return { page: 'backtesting', resourceId: segments[1] ?? null };
  }

  if (segments[0] === 'paper-trading') {
    return { page: 'paper-trading', resourceId: segments[1] ?? null };
  }

  // Default: / → paper-trading
  return { page: 'paper-trading', resourceId: null };
}

function buildPathname(
  page: 'backtesting' | 'paper-trading',
  sessionId: string | null,
  backtestId: string | null,
): string {
  if (page === 'paper-trading') {
    if (sessionId) return `/paper-trading/${sessionId}`;
    // Default page — use the clean root URL
    return '/';
  }

  if (backtestId) return `/backtesting/${backtestId}`;
  return '/backtesting';
}

// ============================================================================
// Hook
// ============================================================================

export function useUrlSync(): void {
  const setActivePage = usePaperTradingStore((s) => s.setActivePage);
  const setSelectedSession = usePaperTradingStore((s) => s.setSelectedSession);
  const setSelectedBacktestId = useBacktestStore((s) => s.setSelectedBacktestId);

  // Ref to avoid pushing a history entry while we are already handling a
  // popstate event (back/forward navigation).
  const isFromPopState = useRef(false);

  // Ref to track the last URL we pushed so we skip redundant pushState calls
  // (especially important on initial mount where state + URL are already in sync).
  const lastPushedUrl = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // 1. On mount: URL → State
  // -------------------------------------------------------------------------
  useEffect(() => {
    const { page, resourceId } = parsePathname(window.location.pathname);

    // Apply page
    setActivePage(page);

    // Apply resource id
    if (page === 'paper-trading') {
      setSelectedSession(resourceId);
    } else {
      setSelectedBacktestId(resourceId);
    }

    // Record the current URL as already-synced so the state-change effect
    // below does not immediately push a duplicate entry.
    const canonicalPath = buildPathname(
      page,
      page === 'paper-trading' ? resourceId : null,
      page === 'backtesting' ? resourceId : null,
    );
    lastPushedUrl.current = canonicalPath;

    // Normalise the URL in place (e.g. /paper-trading → /) without adding a
    // history entry.
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(null, '', canonicalPath);
    }
    // Intentionally run only once on mount — deps array is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // 2. On state change: State → URL
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Subscribe to changes in both stores using Zustand's getState() for the
    // actual values (avoids stale-closure issues with selectors at this level).
    const unsubPaperTrading = usePaperTradingStore.subscribe((state) => {
      if (isFromPopState.current) return;

      const { activePage, selectedSessionId } = state;
      const { selectedBacktestId } = useBacktestStore.getState();

      const newPath = buildPathname(activePage, selectedSessionId, selectedBacktestId);

      if (newPath !== lastPushedUrl.current) {
        lastPushedUrl.current = newPath;
        window.history.pushState(null, '', newPath);
      }
    });

    const unsubBacktest = useBacktestStore.subscribe((state) => {
      if (isFromPopState.current) return;

      const { selectedBacktestId } = state;
      const { activePage, selectedSessionId } = usePaperTradingStore.getState();

      const newPath = buildPathname(activePage, selectedSessionId, selectedBacktestId);

      if (newPath !== lastPushedUrl.current) {
        lastPushedUrl.current = newPath;
        window.history.pushState(null, '', newPath);
      }
    });

    return () => {
      unsubPaperTrading();
      unsubBacktest();
    };
  }, []);

  // -------------------------------------------------------------------------
  // 3. On browser back/forward: popstate → State
  // -------------------------------------------------------------------------
  useEffect(() => {
    function handlePopState() {
      isFromPopState.current = true;

      const { page, resourceId } = parsePathname(window.location.pathname);

      setActivePage(page);

      if (page === 'paper-trading') {
        setSelectedSession(resourceId);
        // Clear any stale backtest selection when navigating to paper-trading
        setSelectedBacktestId(null);
      } else {
        setSelectedBacktestId(resourceId);
        // Clear any stale session selection when navigating to backtesting
        setSelectedSession(null);
      }

      // Track the new URL to prevent the state-change subscribers from pushing
      // a duplicate entry on top of the popstate navigation.
      lastPushedUrl.current = window.location.pathname;

      // Reset the flag after all microtasks have run so that the Zustand
      // subscriber callbacks triggered by the state setters above see it
      // correctly.
      setTimeout(() => {
        isFromPopState.current = false;
      }, 0);
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [setActivePage, setSelectedBacktestId, setSelectedSession]);
}
