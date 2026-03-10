/**
 * Full-page Paper Trading view.
 * Layout mirrors the backtesting page: left sidebar (session list) + main area (detail).
 */

import { useEffect } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import { usePaperSessions } from '../../hooks/usePaperTrading';
import { CreatePaperSessionModal } from '../PaperTradingPanel/CreatePaperSessionModal';
import { PaperSessionSidebar } from './PaperSessionSidebar';
import { PaperSessionDetail } from './PaperSessionDetail';

export function PaperTradingPage() {
  const { selectedSessionId, isCreateModalOpen, setSelectedSession, setCreateModalOpen } =
    usePaperTradingStore();
  const { data: sessions, isLoading, error } = usePaperSessions();

  // Auto-select first session when none is selected
  useEffect(() => {
    if (!selectedSessionId && !isLoading && sessions && sessions.length > 0) {
      setSelectedSession(sessions[0].id);
    }
  }, [selectedSessionId, isLoading, sessions, setSelectedSession]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <PaperSessionSidebar
        sessions={sessions}
        isLoading={isLoading}
        error={error}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSession}
        onCreateSession={() => setCreateModalOpen(true)}
      />

      {/* Main area */}
      <main className="flex-1 overflow-y-auto">
        {selectedSessionId ? (
          <PaperSessionDetail sessionId={selectedSessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-lg">Select a session to view details</p>
              <p className="text-sm mt-1">Or create a new paper trading session</p>
            </div>
          </div>
        )}
      </main>

      {/* Create modal */}
      {isCreateModalOpen && (
        <CreatePaperSessionModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={(id) => {
            setSelectedSession(id);
            setCreateModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
