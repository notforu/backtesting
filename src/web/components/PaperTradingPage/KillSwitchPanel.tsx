/**
 * KillSwitchPanel — platform-level kill switch settings.
 *
 * Displays toggles for Paper Trading and Live Trading kill switches.
 * Settings are persisted in the database and survive restarts.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getKillSwitchSettings, updatePtKillSwitch, updateLtKillSwitch } from '../../api/client';
import type { KillSwitchConfig } from '../../types';

// ============================================================================
// Query key
// ============================================================================

const KILL_SWITCH_KEY = ['kill-switch-settings'] as const;

// ============================================================================
// Sub-component: a single kill switch row
// ============================================================================

interface KillSwitchRowProps {
  label: string;
  config: KillSwitchConfig;
  isSaving: boolean;
  onToggle: (enabled: boolean) => void;
  onDdChange: (ddPercent: number) => void;
}

function KillSwitchRow({ label, config, isSaving, onToggle, onDdChange }: KillSwitchRowProps) {
  const [localDd, setLocalDd] = useState(String(config.ddPercent));

  // Sync local DD input when server value changes
  useEffect(() => {
    setLocalDd(String(config.ddPercent));
  }, [config.ddPercent]);

  function handleDdBlur() {
    const num = parseFloat(localDd);
    if (!isNaN(num) && num >= 1 && num <= 99) {
      onDdChange(num);
    } else {
      // Reset to current server value
      setLocalDd(String(config.ddPercent));
    }
  }

  function handleDdKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }

  return (
    <div className="flex items-center gap-4 py-2">
      {/* Label */}
      <span className="w-36 text-sm font-medium text-gray-200">{label}</span>

      {/* Toggle */}
      <button
        type="button"
        onClick={() => onToggle(!config.enabled)}
        disabled={isSaving}
        aria-pressed={config.enabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 ${
          config.enabled ? 'bg-green-500' : 'bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            config.enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>

      {/* Status text */}
      <span
        className={`w-16 text-xs font-semibold ${config.enabled ? 'text-green-400' : 'text-red-400'}`}
      >
        {config.enabled ? 'Enabled' : 'Disabled'}
      </span>

      {/* DD% input */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400">Max DD:</span>
        <input
          type="number"
          min={1}
          max={99}
          step={1}
          value={localDd}
          onChange={(e) => setLocalDd(e.target.value)}
          onBlur={handleDdBlur}
          onKeyDown={handleDdKeyDown}
          disabled={isSaving}
          className="w-14 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-center text-sm text-gray-100 focus:border-blue-400 focus:outline-none disabled:opacity-50"
        />
        <span className="text-xs text-gray-400">%</span>
      </div>

      {/* Saving indicator */}
      {isSaving && <span className="text-xs text-gray-400 italic">saving...</span>}
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function KillSwitchPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: KILL_SWITCH_KEY,
    queryFn: getKillSwitchSettings,
    staleTime: 60_000,
  });

  const ptMutation = useMutation({
    mutationFn: updatePtKillSwitch,
    onSuccess: (updated) => {
      queryClient.setQueryData(KILL_SWITCH_KEY, (old: typeof data) =>
        old ? { ...old, pt: updated } : old,
      );
    },
  });

  const ltMutation = useMutation({
    mutationFn: updateLtKillSwitch,
    onSuccess: (updated) => {
      queryClient.setQueryData(KILL_SWITCH_KEY, (old: typeof data) =>
        old ? { ...old, lt: updated } : old,
      );
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <p className="text-sm text-gray-400">Loading kill switch settings...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-700 bg-gray-800/50 p-4">
        <p className="text-sm text-red-400">Failed to load kill switch settings.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Kill Switch Settings
      </h3>

      <KillSwitchRow
        label="Paper Trading"
        config={data.pt}
        isSaving={ptMutation.isPending}
        onToggle={(enabled) => ptMutation.mutate({ enabled, ddPercent: data.pt.ddPercent })}
        onDdChange={(ddPercent) => ptMutation.mutate({ enabled: data.pt.enabled, ddPercent })}
      />

      <KillSwitchRow
        label="Live Trading"
        config={data.lt}
        isSaving={ltMutation.isPending}
        onToggle={(enabled) => ltMutation.mutate({ enabled, ddPercent: data.lt.ddPercent })}
        onDdChange={(ddPercent) => ltMutation.mutate({ enabled: data.lt.enabled, ddPercent })}
      />

      <p className="mt-3 text-xs text-gray-500">
        When enabled, trading halts automatically if drawdown exceeds the configured threshold.
      </p>
    </div>
  );
}
