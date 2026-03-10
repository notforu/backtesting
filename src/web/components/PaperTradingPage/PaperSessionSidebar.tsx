/**
 * PaperSessionSidebar — session list with status badges and session creation button.
 */

import { Spinner } from '../Spinner/Spinner';
import { SessionCard } from '../PaperTradingPanel/PaperTradingPanel';
import type { PaperSession } from '../../types';

interface PaperSessionSidebarProps {
  sessions: PaperSession[] | undefined;
  isLoading: boolean;
  error: Error | null;
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  onCreateSession: () => void;
}

export function PaperSessionSidebar({
  sessions,
  isLoading,
  error,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
}: PaperSessionSidebarProps) {
  return (
    <aside className="w-80 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Sessions</h2>
          <button
            onClick={onCreateSession}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Session
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" className="text-gray-400" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
            Failed to load sessions
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sessions && sessions.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-sm">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            No sessions yet. Create one to start paper trading.
          </div>
        )}

        {/* Session cards */}
        {sessions && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={session.id === selectedSessionId}
                onSelect={() =>
                  onSelectSession(session.id === selectedSessionId ? null : session.id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
