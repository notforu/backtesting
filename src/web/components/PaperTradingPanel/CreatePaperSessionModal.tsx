/**
 * Modal for creating a new paper trading session.
 * Requires selecting a saved aggregation config.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAggregations } from '../../api/client';
import { useCreatePaperSession } from '../../hooks/usePaperTrading';

interface CreatePaperSessionModalProps {
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
}

export function CreatePaperSessionModal({ onClose, onCreated }: CreatePaperSessionModalProps) {
  const { data: aggregations, isLoading: loadingAggregations } = useQuery({
    queryKey: ['aggregations'],
    queryFn: getAggregations,
  });

  const createMutation = useCreatePaperSession();

  const [name, setName] = useState('');
  const [aggregationConfigId, setAggregationConfigId] = useState('');
  const [initialCapital, setInitialCapital] = useState<number>(10000);

  // When aggregation selection changes, set default capital from its config
  useEffect(() => {
    if (!aggregationConfigId || !aggregations) return;
    const agg = aggregations.find((a) => a.id === aggregationConfigId);
    if (agg) {
      setInitialCapital(agg.initialCapital);
    }
  }, [aggregationConfigId, aggregations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !aggregationConfigId) return;

    try {
      const session = await createMutation.mutateAsync({
        name: name.trim(),
        aggregationConfigId,
        initialCapital,
      });
      onCreated?.(session.id);
      onClose();
    } catch {
      // Error shown below via createMutation.error
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const inputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">New Paper Trading Session</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Session Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Session Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ATOM 4h Live Test"
              className={inputClass}
              required
            />
          </div>

          {/* Aggregation Config */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Aggregation Config</label>
            {loadingAggregations ? (
              <div className="text-sm text-gray-500">Loading configs...</div>
            ) : (
              <select
                value={aggregationConfigId}
                onChange={(e) => setAggregationConfigId(e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select a config...</option>
                {aggregations?.map((agg) => (
                  <option key={agg.id} value={agg.id}>
                    {agg.name} — {agg.subStrategies.length} strategy{agg.subStrategies.length !== 1 ? 'ies' : 'y'}, ${agg.initialCapital.toLocaleString()}
                  </option>
                ))}
              </select>
            )}
            {aggregations?.length === 0 && (
              <p className="text-xs text-amber-400 mt-1">
                No aggregation configs found. Create one in the Aggregations tab first.
              </p>
            )}
          </div>

          {/* Initial Capital */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              min={1}
              step={1000}
              className={inputClass}
            />
          </div>

          {/* Error */}
          {createMutation.isError && (
            <div className="bg-red-900/50 border border-red-700 rounded p-2 text-sm text-red-300">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create session'}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !aggregationConfigId || createMutation.isPending}
              className="flex-1 py-2 rounded bg-primary-600 hover:bg-primary-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreatePaperSessionModal;
