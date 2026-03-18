/**
 * ConfigPaperTab — shows paper trading sessions linked to a strategy config.
 */

import { useConfigPaperSessions } from '../../hooks/useConfigurations.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { ConfigPaperSessionSummary } from '../../api/client.js';

interface ConfigPaperTabProps {
  configId: string;
}

type SessionStatus = 'running' | 'paused' | 'stopped' | 'error';

const STATUS_STYLES: Record<SessionStatus, { color: string; background: string; label: string }> = {
  running: { color: '#4ade80', background: 'rgba(74,222,128,0.12)', label: 'Running' },
  paused: { color: '#facc15', background: 'rgba(250,204,21,0.12)', label: 'Paused' },
  stopped: { color: '#888', background: 'rgba(136,136,136,0.12)', label: 'Stopped' },
  error: { color: '#f87171', background: 'rgba(248,113,113,0.12)', label: 'Error' },
};

interface SessionCardProps {
  session: ConfigPaperSessionSummary;
  onView: (id: string) => void;
}

function SessionCard({ session, onView }: SessionCardProps) {
  const statusStyle = STATUS_STYLES[session.status] ?? STATUS_STYLES.stopped;
  const returnPct = session.initialCapital > 0
    ? ((session.currentEquity - session.initialCapital) / session.initialCapital) * 100
    : 0;
  const returnPositive = returnPct >= 0;
  const returnColor = returnPositive ? '#4caf50' : '#f44336';
  const createdDate = new Date(session.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });

  return (
    <div
      style={{
        border: '1px solid #333',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 10,
        background: '#1e1e1e',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>
            {session.name}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            Created {createdDate}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 9px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            color: statusStyle.color,
            background: statusStyle.background,
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          {statusStyle.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Equity
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
            ${session.currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Return
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: returnColor }}>
            {returnPositive ? '+' : ''}{returnPct.toFixed(2)}%
          </span>
        </div>
      </div>

      <button
        onClick={() => onView(session.id)}
        style={{
          padding: '6px 12px',
          background: '#252525',
          border: '1px solid #444',
          borderRadius: 6,
          color: '#aaa',
          fontSize: 12,
          cursor: 'pointer',
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#2e3a4e';
          (e.currentTarget as HTMLButtonElement).style.color = '#e0e0e0';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#4a7aa8';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#252525';
          (e.currentTarget as HTMLButtonElement).style.color = '#aaa';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
        }}
      >
        View Session
      </button>
    </div>
  );
}

export function ConfigPaperTab({ configId }: ConfigPaperTabProps) {
  const { data: sessions, isLoading } = useConfigPaperSessions(configId);
  const setSelectedSession = usePaperTradingStore((s) => s.setSelectedSession);
  const setActivePage = usePaperTradingStore((s) => s.setActivePage);

  const handleView = (sessionId: string) => {
    setSelectedSession(sessionId);
    setActivePage('paper-trading');
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <Spinner size="lg" className="text-gray-400" />
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          color: '#555',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 10 }}>&#9679;</div>
        <div style={{ fontSize: 13 }}>No trading sessions yet</div>
      </div>
    );
  }

  return (
    <div>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onView={handleView}
        />
      ))}
    </div>
  );
}
