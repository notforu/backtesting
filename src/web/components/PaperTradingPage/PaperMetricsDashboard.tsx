/**
 * PaperMetricsDashboard — performance metrics display and event log for a paper session.
 */

import { Dashboard } from '../Dashboard';
import type { PerformanceMetrics } from '../../types';

// ============================================================================
// EventTypeBadge — color-coded pill for event type
// ============================================================================

function EventTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    trade_opened: 'bg-green-900/50 text-green-400',
    trade_closed: 'bg-blue-900/50 text-blue-400',
    funding_payment: 'bg-purple-900/50 text-purple-400',
    error: 'bg-red-900/50 text-red-400',
    retry: 'bg-yellow-900/50 text-yellow-400',
    status_change: 'bg-indigo-900/50 text-indigo-400',
  };
  const labels: Record<string, string> = {
    trade_opened: 'Open',
    trade_closed: 'Close',
    funding_payment: 'Funding',
    error: 'Error',
    retry: 'Retry',
    status_change: 'Status',
  };

  const style = styles[type] ?? 'bg-gray-700 text-gray-400';
  const label = labels[type] ?? type;

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${style}`}>
      {label}
    </span>
  );
}

// ============================================================================
// SessionEvent type (local, matching the API shape)
// ============================================================================

interface SessionEventRecord {
  id: number;
  createdAt: number;
  type: string;
  message: string;
}

interface EventsData {
  events: SessionEventRecord[];
  total: number;
}

// ============================================================================
// PaperMetricsDashboard
// ============================================================================

interface PaperMetricsDashboardProps {
  metrics: PerformanceMetrics | null;
  eventsData: EventsData | undefined;
}

export function PaperMetricsDashboard({ metrics, eventsData }: PaperMetricsDashboardProps) {
  return (
    <>
      {/* Dashboard metrics */}
      <section>
        <Dashboard metrics={metrics} />
      </section>

      {/* Event Log */}
      {eventsData && eventsData.events.length > 0 && (
        <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">
            Event Log ({eventsData.total})
          </h3>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {eventsData.events.map((evt) => (
              <div
                key={evt.id}
                className="flex items-start gap-2 text-xs py-1 border-b border-gray-700/30 last:border-0"
              >
                <span className="text-gray-500 shrink-0 w-[140px]">
                  {new Date(evt.createdAt).toLocaleString()}
                </span>
                <EventTypeBadge type={evt.type} />
                <span className="text-gray-300">{evt.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
