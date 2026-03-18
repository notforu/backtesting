/**
 * Full-page Paper Trading view.
 * Layout mirrors the backtesting page: left sidebar (session list) + main area (detail).
 *
 * Mobile (<md): master-detail pattern — show sidebar OR detail, never both.
 * Desktop (>=md): side-by-side layout unchanged.
 */

import { useEffect, useState } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import { usePaperSessions } from '../../hooks/usePaperTrading';
import { CreatePaperSessionModal } from '../PaperTradingPanel/CreatePaperSessionModal';
import { PaperSessionSidebar } from './PaperSessionSidebar';
import { PaperSessionDetail } from './PaperSessionDetail';
import { KillSwitchPanel } from './KillSwitchPanel';

export function PaperTradingPage() {
  const { selectedSessionId, isCreateModalOpen, setSelectedSession, setCreateModalOpen } =
    usePaperTradingStore();
  const { data: sessions, isLoading, error } = usePaperSessions();

  // Mobile master-detail: true = show session list, false = show session detail
  const [showSidebar, setShowSidebar] = useState(true);

  // Auto-select first session when none is selected
  useEffect(() => {
    if (!selectedSessionId && !isLoading && sessions && sessions.length > 0) {
      setSelectedSession(sessions[0].id);
    }
  }, [selectedSessionId, isLoading, sessions, setSelectedSession]);

  const handleSelectSession = (id: string | null) => {
    setSelectedSession(id);
    // On mobile, navigate to detail view when a session is selected
    if (id !== null) {
      setShowSidebar(false);
    }
  };

  const handleBackToList = () => {
    setShowSidebar(true);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Kill switch settings panel — always visible at top of Trading page */}
      <div className="px-4 pt-4 pb-2 border-b border-gray-700 shrink-0">
        <KillSwitchPanel />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — always visible on md+ */}
        <aside className="hidden md:flex md:flex-col w-80 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
          <PaperSessionSidebar
            sessions={sessions}
            isLoading={isLoading}
            error={error}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSession}
            onCreateSession={() => setCreateModalOpen(true)}
          />
        </aside>

        {/* Mobile: show sidebar OR detail (master-detail pattern) */}
        <div className="flex md:hidden flex-1 flex-col overflow-hidden">
          {showSidebar ? (
            /* Mobile session list */
            <div className="flex-1 overflow-y-auto">
              <PaperSessionSidebar
                sessions={sessions}
                isLoading={isLoading}
                error={error}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                onCreateSession={() => setCreateModalOpen(true)}
              />
            </div>
          ) : (
            /* Mobile session detail with back button */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
                <button
                  onClick={handleBackToList}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Sessions
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {selectedSessionId ? (
                  <PaperSessionDetail sessionId={selectedSessionId} />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 p-8">
                    <p className="text-sm text-center">Select a session from the list</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Desktop main area — always visible on md+ */}
        <main className="hidden md:flex md:flex-1 overflow-y-auto flex-col">
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
                <p className="text-sm mt-1">Or create a new trading session</p>
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
              setShowSidebar(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
