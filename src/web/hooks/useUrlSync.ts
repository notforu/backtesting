/**
 * Bidirectional URL <-> Zustand state synchronization using the History API.
 *
 * URL structure:
 *   /                         → paper-trading page, no specific session
 *   /paper-trading            → paper-trading page, no specific session
 *   /paper-trading/:sessionId → paper-trading with specific session selected
 *   /backtesting              → backtesting page, no run loaded
 *   /backtesting/:runId       → backtesting page with specific run loaded
 *   /configs                  → configurations page
 *   /configs/:configId        → configurations page with specific config selected
 */

import { useEffect, useRef } from 'react';
import { usePaperTradingStore } from '../stores/paperTradingStore';
import { useBacktestStore } from '../stores/backtestStore';
import { useConfigurationStore } from '../stores/configurationStore';
import type { ActivePage } from '../stores/paperTradingStore';

// ============================================================================
// Helpers
// ============================================================================

interface ParsedPath {
  page: ActivePage;
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

  if (segments[0] === 'configs') {
    return { page: 'configurations', resourceId: segments[1] ?? null };
  }

  // Default: / → paper-trading
  return { page: 'paper-trading', resourceId: null };
}

function buildPathname(
  page: ActivePage,
  sessionId: string | null,
  backtestId: string | null,
  configId: string | null,
): string {
  if (page === 'paper-trading') {
    if (sessionId) return `/paper-trading/${sessionId}`;
    // Default page — use the clean root URL
    return '/';
  }

  if (page === 'configurations') {
    if (configId) return `/configs/${configId}`;
    return '/configs';
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
  const setSelectedConfigId = useConfigurationStore((s) => s.setSelectedConfigId);

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
    } else if (page === 'configurations') {
      setSelectedConfigId(resourceId);
    } else {
      setSelectedBacktestId(resourceId);
    }

    // Record the current URL as already-synced so the state-change effect
    // below does not immediately push a duplicate entry.
    const canonicalPath = buildPathname(
      page,
      page === 'paper-trading' ? resourceId : null,
      page === 'backtesting' ? resourceId : null,
      page === 'configurations' ? resourceId : null,
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
    // Subscribe to changes in all relevant stores.
    const unsubPaperTrading = usePaperTradingStore.subscribe((state) => {
      if (isFromPopState.current) return;

      const { activePage, selectedSessionId } = state;
      const { selectedBacktestId } = useBacktestStore.getState();
      const { selectedConfigId } = useConfigurationStore.getState();

      const newPath = buildPathname(activePage, selectedSessionId, selectedBacktestId, selectedConfigId);

      if (newPath !== lastPushedUrl.current) {
        lastPushedUrl.current = newPath;
        window.history.pushState(null, '', newPath);
      }
    });

    const unsubBacktest = useBacktestStore.subscribe((state) => {
      if (isFromPopState.current) return;

      const { selectedBacktestId } = state;
      const { activePage, selectedSessionId } = usePaperTradingStore.getState();
      const { selectedConfigId } = useConfigurationStore.getState();

      const newPath = buildPathname(activePage, selectedSessionId, selectedBacktestId, selectedConfigId);

      if (newPath !== lastPushedUrl.current) {
        lastPushedUrl.current = newPath;
        window.history.pushState(null, '', newPath);
      }
    });

    const unsubConfig = useConfigurationStore.subscribe((state) => {
      if (isFromPopState.current) return;

      const { selectedConfigId } = state;
      const { activePage, selectedSessionId } = usePaperTradingStore.getState();
      const { selectedBacktestId } = useBacktestStore.getState();

      const newPath = buildPathname(activePage, selectedSessionId, selectedBacktestId, selectedConfigId);

      if (newPath !== lastPushedUrl.current) {
        lastPushedUrl.current = newPath;
        window.history.pushState(null, '', newPath);
      }
    });

    return () => {
      unsubPaperTrading();
      unsubBacktest();
      unsubConfig();
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
        setSelectedBacktestId(null);
        setSelectedConfigId(null);
      } else if (page === 'configurations') {
        setSelectedConfigId(resourceId);
        setSelectedSession(null);
        setSelectedBacktestId(null);
      } else {
        setSelectedBacktestId(resourceId);
        setSelectedSession(null);
        setSelectedConfigId(null);
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
  }, [setActivePage, setSelectedBacktestId, setSelectedSession, setSelectedConfigId]);
}
