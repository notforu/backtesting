/**
 * ImportConfigModal — drag-and-drop JSON config importer.
 * Validates a config file (dry run), shows preview, then optionally re-runs all configs.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { importConfigs, type ImportConfigPreviewItem, type ImportConfigResultItem } from '../../api/client';

// ============================================================================
// Types
// ============================================================================

interface ImportConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatNum(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '-';
  return val.toFixed(decimals);
}

function formatReturn(val: number | null | undefined): string {
  if (val == null) return '-';
  const prefix = val >= 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

// ============================================================================
// ImportConfigModal
// ============================================================================

export function ImportConfigModal({ isOpen, onClose }: ImportConfigModalProps) {
  const [fileData, setFileData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportConfigPreviewItem[] | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ImportConfigResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const reset = useCallback(() => {
    setFileData(null);
    setFileName('');
    setPreview(null);
    setResults(null);
    setError(null);
    setIsValidating(false);
    setIsRunning(false);
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Only .json files are supported.');
      return;
    }

    setError(null);
    setPreview(null);
    setResults(null);

    let data: unknown;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      setError('Failed to parse file. Make sure it is a valid JSON file.');
      return;
    }

    setFileData(data);
    setFileName(file.name);

    // Validate (dry run)
    setIsValidating(true);
    try {
      const result = await importConfigs(data, false);
      setPreview(result.configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleRunAll = useCallback(async () => {
    if (!fileData) return;
    setIsRunning(true);
    setError(null);
    try {
      const result = await importConfigs(fileData, true);
      setResults(result.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsRunning(false);
    }
  }, [fileData]);

  if (!isOpen) return null;

  const successCount = results?.filter(r => r.status === 'success').length ?? 0;
  const errorCount = results?.filter(r => r.status === 'error').length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">Import Configs</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
          {/* File drop zone */}
          {!preview && !isValidating && !results && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer ${
                isDragging
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-gray-600 hover:border-gray-500 bg-gray-800/40'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                className="w-12 h-12 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <div className="text-center">
                <p className="text-gray-300 font-medium">Drop a config JSON file here</p>
                <p className="text-gray-500 text-sm mt-1">or click to browse</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>
          )}

          {/* Validating spinner */}
          {isValidating && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-400">
              <svg className="animate-spin h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-sm">Validating {fileName}...</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Preview table */}
          {preview && !results && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-300 font-medium">{fileName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {preview.length} config{preview.length !== 1 ? 's' : ''} found — ready to re-run
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Choose different file
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800 border-b border-gray-700">
                    <tr className="text-left text-gray-400">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Strategy</th>
                      <th className="py-2 px-3">Symbol(s)</th>
                      <th className="py-2 px-3">TF</th>
                      <th className="py-2 px-3">Orig. Return</th>
                      <th className="py-2 px-3">Orig. Sharpe</th>
                      <th className="py-2 px-3">Orig. Max DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(item => (
                      <tr
                        key={item.index}
                        className="border-b border-gray-700/50 hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="py-2 px-3 text-gray-500">{item.index + 1}</td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            item.type === 'aggregation'
                              ? 'bg-purple-900/50 text-purple-400'
                              : 'bg-gray-700 text-gray-300'
                          }`}>
                            {item.type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-200 font-medium">{item.strategy}</td>
                        <td className="py-2 px-3 text-gray-300 font-mono max-w-[140px] truncate" title={item.symbols}>
                          {item.symbols}
                        </td>
                        <td className="py-2 px-3 text-gray-400">{item.timeframe || '-'}</td>
                        <td className={`py-2 px-3 font-medium ${
                          item.originalMetrics
                            ? item.originalMetrics.totalReturnPercent >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                            : 'text-gray-600'
                        }`}>
                          {item.originalMetrics ? formatReturn(item.originalMetrics.totalReturnPercent) : '-'}
                        </td>
                        <td className={`py-2 px-3 ${
                          item.originalMetrics
                            ? item.originalMetrics.sharpeRatio >= 1
                              ? 'text-green-400'
                              : item.originalMetrics.sharpeRatio >= 0
                              ? 'text-gray-300'
                              : 'text-red-400'
                            : 'text-gray-600'
                        }`}>
                          {item.originalMetrics ? formatNum(item.originalMetrics.sharpeRatio) : '-'}
                        </td>
                        <td className="py-2 px-3 text-gray-300">
                          {item.originalMetrics
                            ? `${formatNum(item.originalMetrics.maxDrawdownPercent, 1)}%`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results table */}
          {results && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-300 font-medium">Import Complete</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="text-green-400">{successCount} succeeded</span>
                    {errorCount > 0 && (
                      <span className="text-red-400 ml-2">{errorCount} failed</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Import another file
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800 border-b border-gray-700">
                    <tr className="text-left text-gray-400">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Strategy</th>
                      <th className="py-2 px-3">Symbol(s)</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Run ID / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(item => (
                      <tr
                        key={item.index}
                        className="border-b border-gray-700/50 hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="py-2 px-3 text-gray-500">{item.index + 1}</td>
                        <td className="py-2 px-3 text-gray-200 font-medium">{item.strategy}</td>
                        <td className="py-2 px-3 text-gray-300 font-mono max-w-[140px] truncate" title={item.symbols}>
                          {item.symbols}
                        </td>
                        <td className="py-2 px-3">
                          {item.status === 'success' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/50 text-green-400">
                              success
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/50 text-red-400">
                              error
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-[10px] truncate max-w-[200px]" title={item.runId ?? item.error}>
                          {item.status === 'success' ? (
                            <span className="text-gray-500">{item.runId}</span>
                          ) : (
                            <span className="text-red-400">{item.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Close
          </button>

          {preview && !results && (
            <button
              onClick={handleRunAll}
              disabled={isRunning}
              className="px-4 py-2 bg-primary-700 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {isRunning && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {isRunning
                ? 'Running...'
                : `Run All (${preview.length} config${preview.length !== 1 ? 's' : ''})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportConfigModal;
