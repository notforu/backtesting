/**
 * API Client for the backtesting platform.
 * Provides typed functions for all API endpoints.
 */

import type {
  BacktestResult,
  PaginatedHistory,
  Candle,
  CandleRequest,
  RunBacktestRequest,
  RunPairsBacktestRequest,
  AggregateBacktestResult,
  PairsBacktestResult,
  StrategyDetails,
  StrategyInfo,
  ApiError,
  OptimizationRequest,
  OptimizationResult,
  ScanRequest,
  ScanResultRow,
  ScanSummary,
  ActivePolymarketMarket,
  AggregationConfig,
  CreateAggregationRequest,
  UpdateAggregationRequest,
  RunAggregationRequest,
  PaperSession,
  PaperSessionDetail,
  PaperTradesResponse,
  PaperEquitySnapshot,
  PaperTradingEvent,
  CreatePaperSessionRequest,
  PaperSessionEventsResponse,
} from '../types';

const API_BASE = '/api';

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const headers: HeadersInit = { ...options.headers };
  if (options.body) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
    let details: unknown;

    try {
      const errorData: ApiError = await response.json();
      errorMessage = errorData.message || errorMessage;
      details = errorData;
    } catch {
      // Response was not JSON, use default message
    }

    throw new ApiClientError(errorMessage, response.status, details);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ============================================================================
// Backtest Endpoints
// ============================================================================

/**
 * Run a new backtest with the given configuration
 */
export async function runBacktest(
  config: RunBacktestRequest
): Promise<BacktestResult> {
  return apiFetch<BacktestResult>('/backtest/run', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/**
 * Run a pairs trading backtest
 */
export async function runPairsBacktest(
  config: RunPairsBacktestRequest
): Promise<PairsBacktestResult> {
  return apiFetch<PairsBacktestResult>('/backtest/pairs/run', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/**
 * Get a specific backtest result by ID
 */
export async function getBacktest(id: string): Promise<BacktestResult> {
  return apiFetch<BacktestResult>(`/backtest/${encodeURIComponent(id)}`);
}

/**
 * Filter and sort parameters for backtest history queries
 */
export interface HistoryParams {
  limit?: number;
  offset?: number;
  strategy?: string;
  symbol?: string;
  timeframe?: string;
  exchange?: string;
  mode?: string;
  fromDate?: number;
  toDate?: number;
  minSharpe?: number;
  maxSharpe?: number;
  minReturn?: number;
  maxReturn?: number;
  sortBy?: 'runAt' | 'sharpeRatio' | 'totalReturnPercent' | 'maxDrawdownPercent' | 'winRate' | 'totalTrades';
  sortDir?: 'asc' | 'desc';
  runType?: 'strategies' | 'aggregations';
}

/**
 * Get list of past backtest runs with pagination, filtering, and sorting
 */
export async function getHistory(params?: HistoryParams): Promise<PaginatedHistory> {
  const queryParams = new URLSearchParams();
  if (params?.limit !== undefined) queryParams.append('limit', String(params.limit));
  if (params?.offset !== undefined) queryParams.append('offset', String(params.offset));
  if (params?.strategy) queryParams.append('strategy', params.strategy);
  if (params?.symbol) queryParams.append('symbol', params.symbol);
  if (params?.timeframe) queryParams.append('timeframe', params.timeframe);
  if (params?.exchange) queryParams.append('exchange', params.exchange);
  if (params?.mode) queryParams.append('mode', params.mode);
  if (params?.fromDate !== undefined) queryParams.append('fromDate', String(params.fromDate));
  if (params?.toDate !== undefined) queryParams.append('toDate', String(params.toDate));
  if (params?.minSharpe !== undefined) queryParams.append('minSharpe', String(params.minSharpe));
  if (params?.maxSharpe !== undefined) queryParams.append('maxSharpe', String(params.maxSharpe));
  if (params?.minReturn !== undefined) queryParams.append('minReturn', String(params.minReturn));
  if (params?.maxReturn !== undefined) queryParams.append('maxReturn', String(params.maxReturn));
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
  if (params?.sortDir) queryParams.append('sortDir', params.sortDir);
  if (params?.runType) queryParams.append('runType', params.runType);
  const queryString = queryParams.toString();
  return apiFetch<PaginatedHistory>(`/backtest/history${queryString ? `?${queryString}` : ''}`);
}

/**
 * Get backtest runs grouped by symbol
 */
export interface BacktestGroup {
  symbol: string;
  count: number;
  bestSharpe: number;
  bestReturn: number;
  timeframes: string[];
}

export async function getHistoryGroups(params?: {
  strategy?: string;
  timeframe?: string;
  mode?: string;
  minSharpe?: number;
  runType?: 'strategies' | 'aggregations';
}): Promise<{ groups: BacktestGroup[] }> {
  const queryParams = new URLSearchParams();
  if (params?.strategy) queryParams.append('strategy', params.strategy);
  if (params?.timeframe) queryParams.append('timeframe', params.timeframe);
  if (params?.mode) queryParams.append('mode', params.mode);
  if (params?.minSharpe !== undefined) queryParams.append('minSharpe', String(params.minSharpe));
  if (params?.runType) queryParams.append('runType', params.runType);
  const qs = queryParams.toString();
  return apiFetch<{ groups: BacktestGroup[] }>(`/backtest/history/groups${qs ? `?${qs}` : ''}`);
}

/**
 * Delete a backtest result
 */
export async function deleteBacktest(id: string): Promise<void> {
  return apiFetch<void>(`/backtest/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Delete all backtest history
 */
export async function deleteAllHistory(): Promise<{ message: string; count: number }> {
  return apiFetch<{ message: string; count: number }>('/backtest/history', {
    method: 'DELETE',
  });
}

// ============================================================================
// Strategy Endpoints
// ============================================================================

/**
 * Get list of all available strategies
 */
export async function getStrategies(): Promise<StrategyInfo[]> {
  return apiFetch<StrategyInfo[]>('/strategies');
}

/**
 * Get detailed information about a specific strategy
 */
export async function getStrategy(name: string): Promise<StrategyDetails> {
  return apiFetch<StrategyDetails>(`/strategies/${encodeURIComponent(name)}`);
}

// ============================================================================
// Data Endpoints
// ============================================================================

/**
 * Fetch candle data for charting
 */
export async function getCandles(params: CandleRequest): Promise<Candle[]> {
  const queryParams = new URLSearchParams({
    exchange: params.exchange,
    symbol: params.symbol,
    timeframe: params.timeframe,
    start: params.startDate,
    end: params.endDate,
  });

  const response = await apiFetch<{ candles: Candle[]; source: string; count: number }>(`/candles?${queryParams.toString()}`);
  return response.candles;
}

/**
 * Get available trading symbols for an exchange
 */
export async function getSymbols(exchange: string): Promise<string[]> {
  return apiFetch<string[]>(
    `/symbols?exchange=${encodeURIComponent(exchange)}`
  );
}

/**
 * Get list of supported exchanges
 */
export async function getExchanges(): Promise<string[]> {
  return apiFetch<string[]>('/exchanges');
}

// ============================================================================
// Optimization Endpoints
// ============================================================================

/**
 * Progress update callback for optimization
 */
export interface OptimizationProgressCallback {
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  onComplete?: (result: OptimizationResult & { duration: number }) => void;
  onError?: (error: string) => void;
}

/**
 * Run parameter optimization for a strategy with SSE progress updates
 */
export async function runOptimization(
  config: OptimizationRequest,
  callbacks?: OptimizationProgressCallback
): Promise<OptimizationResult> {
  const url = `${API_BASE}/optimize`;

  return new Promise((resolve, reject) => {
    // Use IIFE to handle async operations
    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });

        if (!response.ok) {
          throw new ApiClientError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status
          );
        }

        if (!response.body) {
          throw new ApiClientError('Response body is null', 500);
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete messages (SSE format: "data: {...}\n\n")
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.substring(6); // Remove "data: " prefix
            try {
              const data = JSON.parse(dataStr);

              switch (data.type) {
                case 'start':
                  // Optimization started
                  break;

                case 'progress':
                  // Progress update
                  if (callbacks?.onProgress) {
                    callbacks.onProgress({
                      current: data.current,
                      total: data.total,
                      percent: data.percent,
                    });
                  }
                  break;

                case 'complete':
                  // Optimization complete
                  if (callbacks?.onComplete) {
                    callbacks.onComplete(data.result);
                  }
                  resolve(data.result);
                  return;

                case 'error': {
                  // Error occurred
                  const errorMessage = data.error || 'Unknown error occurred';
                  if (callbacks?.onError) {
                    callbacks.onError(errorMessage);
                  }
                  reject(new ApiClientError(errorMessage, 500, data.details));
                  return;
                }

                default:
                  console.warn('Unknown SSE event type:', data.type);
              }
            } catch (err) {
              console.error('Error parsing SSE data:', err);
            }
          }
        }
      } catch (err) {
        console.error('Error during optimization:', err);
        if (err instanceof ApiClientError) {
          reject(err);
        } else if (err instanceof Error) {
          reject(new ApiClientError(err.message, 500));
        } else {
          reject(new ApiClientError('Unknown error occurred', 500));
        }
      }
    })();
  });
}

/**
 * Get all optimization runs for a strategy, symbol, and timeframe
 * Returns an array of results sorted by most recent first
 */
export async function getOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult[]> {
  return apiFetch<OptimizationResult[]>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`
  );
}

/**
 * Get the most recent optimization run for a strategy, symbol, and timeframe
 */
export async function getLatestOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult> {
  return apiFetch<OptimizationResult>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}/latest`
  );
}

/**
 * Get all saved optimization results
 */
export async function getAllOptimizations(): Promise<OptimizationResult[]> {
  return apiFetch<OptimizationResult[]>('/optimize/all');
}

/**
 * Delete all optimization runs for a strategy, symbol, and timeframe
 */
export async function deleteOptimization(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<void> {
  return apiFetch<void>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Delete a specific optimization run by ID
 */
export async function deleteOptimizationById(id: string): Promise<void> {
  return apiFetch<void>(
    `/optimize/id/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
}

// ============================================================================
// Polymarket Endpoints
// ============================================================================

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  clobTokenIds: string;
  endDate: string;
  category: string;
  active: boolean;
  closed: boolean;
  liquidity: string;
  volume?: string;
  volumeNum?: number;
  image?: string;
}

/**
 * Search Polymarket markets with filters
 */
export async function searchPolymarketMarkets(params: {
  search?: string;
  category?: string;
  active?: string;
  closed?: string;
  limit?: number;
}): Promise<PolymarketMarket[]> {
  const queryParams = new URLSearchParams();
  if (params.search) queryParams.append('search', params.search);
  if (params.category) queryParams.append('category', params.category);
  if (params.active) queryParams.append('active', params.active);
  if (params.closed) queryParams.append('closed', params.closed);
  queryParams.append('limit', String(params.limit || 20));

  return apiFetch<PolymarketMarket[]>(`/polymarket/markets?${queryParams}`);
}

/**
 * Get available Polymarket categories
 */
export async function getPolymarketCategories(): Promise<string[]> {
  return apiFetch<string[]>('/polymarket/categories');
}

/**
 * Get active Polymarket markets for scanner prefill
 */
export async function getActivePolymarketMarkets(): Promise<ActivePolymarketMarket[]> {
  return apiFetch<ActivePolymarketMarket[]>('/polymarket/markets/active');
}

// ============================================================================
// Scanner Endpoints
// ============================================================================

export interface ScanCallbacks {
  onProgress?: (progress: { current: number; total: number }) => void;
  onResult?: (result: ScanResultRow) => void;
  onDone?: (summary: ScanSummary) => void;
  onError?: (error: string) => void;
}

/**
 * Run multi-market scan with SSE streaming
 * Similar pattern to runOptimization - uses fetch + ReadableStream
 */
export async function runScan(
  config: ScanRequest,
  callbacks?: ScanCallbacks
): Promise<void> {
  const url = `${API_BASE}/backtest/scan`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new ApiClientError(
      `Scan request failed: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  if (!response.body) {
    throw new ApiClientError('Response body is null', 500);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const dataStr = line.substring(6);
      try {
        const data = JSON.parse(dataStr);

        switch (data.type) {
          case 'progress':
            callbacks?.onProgress?.({ current: data.current, total: data.total });
            break;

          case 'result':
            if (data.status === 'complete') {
              callbacks?.onResult?.({
                symbol: data.symbol,
                metrics: data.metrics,
                tradesCount: data.tradesCount,
                status: 'complete',
              });
            } else if (data.status === 'error') {
              callbacks?.onResult?.({
                symbol: data.symbol,
                metrics: { totalReturnPercent: 0, sharpeRatio: 0, maxDrawdownPercent: 0, winRate: 0, profitFactor: 0 },
                tradesCount: 0,
                status: 'error',
                error: data.error,
              });
            }
            break;

          case 'done':
            callbacks?.onDone?.(data.summary);
            break;

          case 'error':
            callbacks?.onError?.(data.error);
            break;
        }
      } catch (err) {
        console.error('Error parsing scan SSE data:', err);
      }
    }
  }
}

// ============================================================================
// Funding Rate Endpoints
// ============================================================================

/**
 * Fetch funding rate data for a given exchange/symbol/date range
 */
export async function getFundingRates(params: {
  exchange: string;
  symbol: string;
  start: number;
  end: number;
}): Promise<{ rates: Array<{ timestamp: number; fundingRate: number; markPrice?: number }> }> {
  const queryParams = new URLSearchParams({
    exchange: params.exchange,
    symbol: params.symbol,
    start: String(params.start),
    end: String(params.end),
  });
  return apiFetch<{ rates: Array<{ timestamp: number; fundingRate: number; markPrice?: number }> }>(
    `/funding-rates?${queryParams.toString()}`
  );
}

// ============================================================================
// Aggregation Endpoints
// ============================================================================

/**
 * Get all saved aggregation configs
 */
export async function getAggregations(): Promise<AggregationConfig[]> {
  return apiFetch<AggregationConfig[]>('/aggregations');
}

/**
 * Create a new aggregation config
 */
export async function createAggregation(config: CreateAggregationRequest): Promise<AggregationConfig> {
  return apiFetch<AggregationConfig>('/aggregations', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/**
 * Get a single aggregation config by ID
 */
export async function getAggregation(id: string): Promise<AggregationConfig> {
  return apiFetch<AggregationConfig>(`/aggregations/${encodeURIComponent(id)}`);
}

/**
 * Update an existing aggregation config
 */
export async function updateAggregation(id: string, updates: UpdateAggregationRequest): Promise<AggregationConfig> {
  return apiFetch<AggregationConfig>(`/aggregations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * Delete an aggregation config
 */
export async function deleteAggregation(id: string): Promise<void> {
  return apiFetch<void>(`/aggregations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Run an aggregation backtest
 */
export async function runAggregation(id: string, request: RunAggregationRequest): Promise<AggregateBacktestResult> {
  return apiFetch<AggregateBacktestResult>(`/aggregations/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Run an ad-hoc aggregation backtest with an inline config (no saved aggregation ID needed)
 */
export async function runAdhocAggregation(config: {
  subStrategies: Array<{
    strategyName: string;
    symbol: string;
    timeframe: string;
    params: Record<string, unknown>;
    exchange: string;
  }>;
  allocationMode: string;
  maxPositions: number;
  initialCapital: number;
  startDate: number;
  endDate: number;
  exchange: string;
  mode?: string;
}): Promise<AggregateBacktestResult> {
  return apiFetch<AggregateBacktestResult>('/backtest/aggregate/run', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// ============================================================================
// Config Export / Import Endpoints
// ============================================================================

/**
 * Export configs for selected run IDs. Returns a Blob for file download.
 */
export async function exportConfigs(runIds: string[]): Promise<Blob> {
  const url = `${API_BASE}/configs/export`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runIds }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Export failed' }));
    throw new ApiClientError((err as { message?: string }).message || 'Export failed', response.status);
  }
  return response.blob();
}

/**
 * Import preview response item.
 */
export interface ImportConfigPreviewItem {
  index: number;
  type: string;
  strategy: string;
  symbols: string;
  timeframe: string;
  originalMetrics?: {
    sharpeRatio: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
  };
}

/**
 * Result item returned after running imported configs.
 */
export interface ImportConfigResultItem {
  index: number;
  strategy: string;
  symbols: string;
  status: 'success' | 'error';
  runId?: string;
  error?: string;
}

/**
 * Import configs file. When rerun=false, returns validation/preview summary.
 * When rerun=true, runs all configs and returns results.
 */
export async function importConfigs(
  file: unknown,
  rerun: boolean
): Promise<{ configs: ImportConfigPreviewItem[]; results?: ImportConfigResultItem[] }> {
  return apiFetch<{ configs: ImportConfigPreviewItem[]; results?: ImportConfigResultItem[] }>('/configs/import', {
    method: 'POST',
    body: JSON.stringify({ file, rerun }),
  });
}

// ============================================================================
// Health Check
// ============================================================================

interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Check if the API server is running
 */
export async function healthCheck(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}

// ============================================================================
// Paper Trading Endpoints
// ============================================================================

export async function createPaperSession(data: CreatePaperSessionRequest): Promise<PaperSessionDetail> {
  return apiFetch<PaperSessionDetail>('/paper-trading/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listPaperSessions(): Promise<PaperSession[]> {
  return apiFetch<PaperSession[]>('/paper-trading/sessions');
}

export async function getPaperSession(id: string): Promise<PaperSessionDetail> {
  return apiFetch<PaperSessionDetail>(`/paper-trading/sessions/${id}`);
}

export async function deletePaperSession(id: string): Promise<void> {
  await apiFetch<void>(`/paper-trading/sessions/${id}`, { method: 'DELETE' });
}

export async function startPaperSession(id: string): Promise<void> {
  await apiFetch<void>(`/paper-trading/sessions/${id}/start`, { method: 'POST' });
}

export async function pausePaperSession(id: string): Promise<void> {
  await apiFetch<void>(`/paper-trading/sessions/${id}/pause`, { method: 'POST' });
}

export async function resumePaperSession(id: string): Promise<void> {
  await apiFetch<void>(`/paper-trading/sessions/${id}/resume`, { method: 'POST' });
}

export async function stopPaperSession(id: string): Promise<void> {
  await apiFetch<void>(`/paper-trading/sessions/${id}/stop`, { method: 'POST' });
}

export async function getPaperTrades(id: string, limit = 50, offset = 0): Promise<PaperTradesResponse> {
  return apiFetch<PaperTradesResponse>(`/paper-trading/sessions/${id}/trades?limit=${limit}&offset=${offset}`);
}

export async function getPaperEquity(id: string): Promise<PaperEquitySnapshot[]> {
  return apiFetch<PaperEquitySnapshot[]>(`/paper-trading/sessions/${id}/equity`);
}

export async function forcePaperTick(id: string): Promise<unknown> {
  return apiFetch<unknown>(`/paper-trading/sessions/${id}/tick`, { method: 'POST' });
}

export async function getPaperSessionEvents(id: string, limit = 100, offset = 0): Promise<PaperSessionEventsResponse> {
  return apiFetch<PaperSessionEventsResponse>(`/paper-trading/sessions/${id}/events?limit=${limit}&offset=${offset}`);
}

/**
 * Subscribe to SSE stream for a paper trading session.
 * Returns an unsubscribe function.
 */
export function subscribePaperSession(
  sessionId: string,
  onEvent: (event: PaperTradingEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  const url = `${API_BASE}/paper-trading/sessions/${sessionId}/stream`;
  let abortController: AbortController | null = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, { signal: abortController?.signal });
      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.substring(6)) as PaperTradingEvent;
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return () => {
    abortController?.abort();
    abortController = null;
  };
}
